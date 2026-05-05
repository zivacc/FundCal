/**
 * NAV 数据 IndexedDB 缓存层 + 增量拉取算法（纯函数 + IDB 包装）。
 *
 * 缓存粒度：`(code, interval)`，存为时间升序、按日期去重的 points 数组。
 * 数据形态：`{ date: 'YYYYMMDD', unit: number|null, adj: number|null }`。
 *
 * 设计取舍：
 * - 把所有"算缺口 / 合并 / 切片"的逻辑分离为 export 的纯函数，方便 node --test 验证。
 * - IDB 部分薄到极致，只做 get/put/openDb；测试时由调用方注入 cachedRange 即可。
 *
 * 名词约定：
 * - "range"        ：请求 / 缓存覆盖的日期区间 `{ start, end }`，YYYYMMDD 字符串
 * - "gap"          ：请求范围里缓存未覆盖的子区间，需要回服务器拉
 * - "merge"        ：把新 points 与 existing 按日期合并、新值覆盖旧值
 *
 * 注意：当 IndexedDB 不可用（SSR / 隐身模式 / 旧浏览器）时，所有 IDB 函数返回降级值
 *      （null / void），让上层请求穿透到 API。
 */

import { parseYYYYMMDD } from '../domain/nav-stats.js';

/* =====================================================================
 *                    Pure helpers (无 IDB 依赖，可单测)
 * ===================================================================== */

/**
 * 把 YYYYMMDD 转 YYYYMMDD，前后偏移 N 天。失败时返回原值。
 * @param {string} yyyymmdd
 * @param {number} deltaDays
 * @returns {string}
 */
export function shiftYYYYMMDD(yyyymmdd, deltaDays) {
  const d = parseYYYYMMDD(yyyymmdd);
  if (Number.isNaN(d.getTime())) return yyyymmdd;
  d.setUTCDate(d.getUTCDate() + deltaDays);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

/**
 * 合并已有 points 与新 points：日期升序、同日去重（incoming 覆盖 existing）。
 *
 * @param {Array<{date:string, unit?:number|null, adj?:number|null}>} existing
 * @param {Array<{date:string, unit?:number|null, adj?:number|null}>} incoming
 * @returns {Array<{date:string, unit?:number|null, adj?:number|null}>}
 */
export function mergePoints(existing, incoming) {
  /** @type {Map<string, any>} */
  const map = new Map();
  for (const p of existing || []) {
    if (p && p.date) map.set(p.date, p);
  }
  for (const p of incoming || []) {
    if (p && p.date) map.set(p.date, p); // 新值覆盖
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 计算请求范围在缓存范围之外的"缺口"（需要回服务器拉的子区间）。
 *
 * 三种情形：
 *   1. 缓存为空 → 整个请求是缺口
 *   2. 缓存与请求不相交 → 整个请求是缺口
 *   3. 缓存与请求相交 → 缺口可能为 0/1/2 个：
 *        - 请求左端点早于缓存 → 前置缺口 [reqStart, cacheStart-1]
 *        - 请求右端点晚于缓存 → 后置缺口 [cacheEnd+1, reqEnd]
 *
 * @param {{start:string,end:string}|null} cachedRange  null 表示无缓存
 * @param {{start:string,end:string}} requestedRange
 * @returns {Array<{start:string,end:string}>}
 */
export function computeMissingRanges(cachedRange, requestedRange) {
  const { start: rs, end: re } = requestedRange;
  if (!cachedRange) return [{ start: rs, end: re }];
  const { start: cs, end: ce } = cachedRange;
  // 不相交：整个请求都是缺口
  if (rs > ce || re < cs) return [{ start: rs, end: re }];

  const gaps = [];
  if (rs < cs) gaps.push({ start: rs, end: shiftYYYYMMDD(cs, -1) });
  if (re > ce) gaps.push({ start: shiftYYYYMMDD(ce, +1), end: re });
  return gaps;
}

/**
 * 取 points 中落在 [start, end] 闭区间的子集；保持原顺序。
 * @param {Array<{date:string}>} points
 * @param {string} start  YYYYMMDD
 * @param {string} end    YYYYMMDD
 * @returns {Array<{date:string}>}
 */
export function subsetByRange(points, start, end) {
  if (!points) return [];
  return points.filter(p => p && p.date >= start && p.date <= end);
}

/**
 * 从 points 数组提取覆盖范围（min/max date）。空数组返回 null。
 * @param {Array<{date:string}>} points
 * @returns {{start:string, end:string}|null}
 */
export function rangeOfPoints(points) {
  if (!points || points.length === 0) return null;
  // 已知 mergePoints 输出按 date 升序；防御性再扫一次
  let minD = points[0].date;
  let maxD = points[0].date;
  for (const p of points) {
    if (p.date < minD) minD = p.date;
    if (p.date > maxD) maxD = p.date;
  }
  return { start: minD, end: maxD };
}

/* =====================================================================
 *                          IndexedDB 包装
 * ===================================================================== */

const DB_NAME = 'fundcal-nav';
const STORE = 'series';
const DB_VERSION = 1;

let _dbPromise = null;

/**
 * 检测当前环境是否可用 IndexedDB（浏览器 + 非隐身模式）。
 * @returns {boolean}
 */
function hasIDB() {
  return typeof globalThis !== 'undefined'
    && typeof globalThis.indexedDB !== 'undefined';
}

/**
 * 打开 / 升级数据库。失败（被 block / 浏览器拒绝）时返回 null。
 * @returns {Promise<IDBDatabase|null>}
 */
function openDb() {
  if (!hasIDB()) return Promise.resolve(null);
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return _dbPromise;
}

/**
 * 缓存键：`${code}:${interval}`。
 * @param {string} code
 * @param {string} interval
 * @returns {string}
 */
function makeKey(code, interval) {
  return `${code}:${interval}`;
}

/**
 * @typedef {Object} CachedSeries
 * @property {string} key            `${code}:${interval}`
 * @property {string} code
 * @property {string} interval
 * @property {string} name
 * @property {Array<{date:string, unit?:number|null, adj?:number|null}>} points
 * @property {number} updatedAt      ms 时间戳
 */

/**
 * 读缓存。无 IDB / 无记录返回 null。
 * @param {string} code
 * @param {string} interval
 * @returns {Promise<CachedSeries|null>}
 */
export async function getCachedSeries(code, interval) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    let tx;
    try { tx = db.transaction(STORE, 'readonly'); }
    catch { resolve(null); return; }
    const req = tx.objectStore(STORE).get(makeKey(code, interval));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

/**
 * 写整条缓存。无 IDB 时静默 noop。
 * @param {CachedSeries} entry
 */
export async function putCachedSeries(entry) {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    let tx;
    try { tx = db.transaction(STORE, 'readwrite'); }
    catch { resolve(); return; }
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

/**
 * 高层：把新 points 合并进缓存（读 → mergePoints → 写）。
 * @param {string} code
 * @param {string} interval
 * @param {string} name
 * @param {Array<{date:string, unit?:number|null, adj?:number|null}>} newPoints
 * @returns {Promise<Array<{date:string, unit?:number|null, adj?:number|null}>>} 合并后的全部 points
 */
export async function mergeIntoCache(code, interval, name, newPoints) {
  const existing = await getCachedSeries(code, interval);
  const merged = mergePoints(existing?.points, newPoints);
  await putCachedSeries({
    key: makeKey(code, interval),
    code,
    interval,
    name: name || existing?.name || code,
    points: merged,
    updatedAt: Date.now(),
  });
  return merged;
}

/**
 * 清空全部缓存（开发 / 调试用）。
 */
export async function clearCache() {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    let tx;
    try { tx = db.transaction(STORE, 'readwrite'); }
    catch { resolve(); return; }
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
