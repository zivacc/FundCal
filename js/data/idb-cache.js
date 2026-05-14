/**
 * IndexedDB JSON 缓存层（带 ETag 条件请求）
 *
 * 用途：把大 JSON（如 search-index.json ~3MB）做跨页/跨会话持久缓存，
 * 配合后端 ETag (W/"xxxx") 走 If-None-Match → 304 短路，
 * 命中时仅需 ~200B 网络往返即可复用本地副本。
 *
 * 公共 API：
 *   cachedJsonFetch(url, opts) → Promise<{ data, source }>
 *     opts:
 *       key:        缓存 key（默认用 url）
 *       freshMs:    多久内视为新鲜，跳过网络（默认 5 分钟）
 *       maxAgeMs:   多久后即便有 If-None-Match 也强制忽略缓存（默认 7 天）
 *       fallback:   网络失败且无缓存时的兜底（返回 Promise）
 *     source: 'memory' | 'idb-fresh' | 'idb-revalidated' | 'network' | 'fallback'
 *
 *   clearIdbCache() / clearIdbCache(key)
 *
 * 设计：
 *   - DB: fundcal-cache  Version 1  Store: kv (keyPath: 'key')
 *   - record: { key, body, etag, savedAt }
 *   - body 保存为已 parse 的 JS 对象（IndexedDB structured clone，比 JSON.parse 快很多）
 *   - 同进程内额外维护 memory map，避免重复 open IDB / 重复 await
 */

const DB_NAME = 'fundcal-cache';
const DB_VERSION = 1;
const STORE = 'kv';

const memCache = new Map();         // key → { data, etag, savedAt }
const inflight = new Map();         // key → Promise，防并发重复请求

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

async function idbGet(key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = tx(db, 'readonly').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function idbPut(record) {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const req = tx(db, 'readwrite').put(record);
      req.onsuccess = () => resolve();
      req.onerror   = () => resolve();
    } catch { resolve(); }
  });
}

async function idbDelete(key) {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const req = tx(db, 'readwrite').delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = () => resolve();
    } catch { resolve(); }
  });
}

/**
 * @param {string} url
 * @param {{ key?: string, freshMs?: number, maxAgeMs?: number, fallback?: () => Promise<any> }} [opts]
 * @returns {Promise<{ data: any, source: string }>}
 */
export async function cachedJsonFetch(url, opts = {}) {
  const {
    key = url,
    freshMs = 5 * 60 * 1000,                    // 5 分钟内零网络
    maxAgeMs = 7 * 24 * 60 * 60 * 1000,         // 7 天上限
    fallback = null,
  } = opts;

  // ── L1：内存 ──
  const mem = memCache.get(key);
  const now = Date.now();
  if (mem && now - mem.savedAt < freshMs) {
    return { data: mem.data, source: 'memory' };
  }

  // ── 并发去重 ──
  if (inflight.has(key)) return inflight.get(key);

  const work = (async () => {
    // ── L2：IndexedDB ──
    const rec = await idbGet(key);
    if (rec && now - rec.savedAt < freshMs) {
      memCache.set(key, rec);
      return { data: rec.body, source: 'idb-fresh' };
    }

    // ── L3：网络（条件请求） ──
    const headers = {};
    if (rec && rec.etag && now - rec.savedAt < maxAgeMs) {
      headers['If-None-Match'] = rec.etag;
    }
    try {
      const res = await fetch(url, { headers });
      if (res.status === 304 && rec) {
        const updated = { ...rec, savedAt: now };
        memCache.set(key, updated);
        idbPut(updated); // 不阻塞
        return { data: rec.body, source: 'idb-revalidated' };
      }
      if (res.ok) {
        const body = await res.json();
        const etag = res.headers.get('ETag') || '';
        const record = { key, body, etag, savedAt: now };
        memCache.set(key, record);
        idbPut(record); // 不阻塞
        return { data: body, source: 'network' };
      }
      // 4xx/5xx 但有旧缓存仍可用
      if (rec) {
        memCache.set(key, rec);
        return { data: rec.body, source: 'idb-stale' };
      }
    } catch {
      // 网络失败：用旧缓存兜底
      if (rec) {
        memCache.set(key, rec);
        return { data: rec.body, source: 'idb-offline' };
      }
    }

    // ── L4：fallback（如静态 JSON 路径） ──
    if (typeof fallback === 'function') {
      const data = await fallback();
      if (data != null) {
        const record = { key, body: data, etag: '', savedAt: now };
        memCache.set(key, record);
        idbPut(record);
        return { data, source: 'fallback' };
      }
    }
    return { data: null, source: 'empty' };
  })();

  inflight.set(key, work);
  try { return await work; }
  finally { inflight.delete(key); }
}

export async function clearIdbCache(key) {
  if (key) {
    memCache.delete(key);
    await idbDelete(key);
  } else {
    memCache.clear();
    const db = await openDb();
    if (!db) return;
    await new Promise((resolve) => {
      try {
        const req = tx(db, 'readwrite').clear();
        req.onsuccess = () => resolve();
        req.onerror   = () => resolve();
      } catch { resolve(); }
    });
  }
}
