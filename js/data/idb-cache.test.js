import test from 'node:test';
import assert from 'node:assert/strict';

function mockGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  });
}

let instance = 0;
async function freshCache() {
  return import(`./idb-cache.js?test=${++instance}`);
}

// 模拟异步 IDB 请求；测试缓存层的可观察结果，不依赖浏览器环境。
function storedRecord(t, record) {
  const records = new Map([[record.key, record]]);
  function request(result) {
    const req = { result: structuredClone(result) };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  }
  const db = { transaction: () => ({ objectStore: () => ({
    get: key => request(records.get(key)),
    put: value => { records.set(value.key, structuredClone(value)); return request(value.key); },
  }) }) };
  mockGlobal(t, 'indexedDB', { open: () => {
    const req = { result: db };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  } });
}

test('network data remains available on a second memory read', async t => {
  mockGlobal(t, 'indexedDB', undefined);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json([{ code: '000001' }]));
  const { cachedJsonFetch } = await freshCache();
  const first = await cachedJsonFetch('/index');
  assert.equal(first.source, 'network');
  assert.deepEqual(await cachedJsonFetch('/index'), { data: first.data, source: 'memory' });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('fresh persisted data remains available after promotion to memory', async t => {
  const body = [{ code: '000002' }];
  storedRecord(t, { key: '/index', body, etag: 'v1', savedAt: Date.now() });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected network'); });
  const { cachedJsonFetch } = await freshCache();
  assert.deepEqual(await cachedJsonFetch('/index'), { data: body, source: 'idb-fresh' });
  assert.deepEqual(await cachedJsonFetch('/index'), { data: body, source: 'memory' });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('304 refresh retains persisted data for subsequent reads', async t => {
  const body = { total: 42 };
  storedRecord(t, { key: '/stats', body, etag: '"v1"', savedAt: Date.now() - 600_000 });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.headers['If-None-Match'], '"v1"');
    return new Response(null, { status: 304 });
  });
  const { cachedJsonFetch } = await freshCache();
  assert.deepEqual(await cachedJsonFetch('/stats'), { data: body, source: 'idb-revalidated' });
  assert.deepEqual(await cachedJsonFetch('/stats'), { data: body, source: 'memory' });
});

test('offline persisted data is returned without replacing it with empty data', async t => {
  const body = { total: 42 };
  storedRecord(t, { key: '/stats', body, etag: '', savedAt: Date.now() - 600_000 });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const { cachedJsonFetch } = await freshCache();
  assert.deepEqual(await cachedJsonFetch('/stats'), { data: body, source: 'idb-offline' });
});

test('fallback results are retained in memory', async t => {
  mockGlobal(t, 'indexedDB', undefined);
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }));
  const { cachedJsonFetch } = await freshCache();
  const data = { feederByMasterKey: { test: ['000001'] } };
  assert.deepEqual(await cachedJsonFetch('/feeder', { fallback: async () => data }), { data, source: 'fallback' });
  assert.deepEqual(await cachedJsonFetch('/feeder'), { data, source: 'memory' });
});

test('concurrent reads share one network request', async t => {
  mockGlobal(t, 'indexedDB', undefined);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json(['000001']));
  const { cachedJsonFetch } = await freshCache();
  const results = await Promise.all(Array.from({ length: 5 }, () => cachedJsonFetch('/index')));
  assert.equal(fetchMock.mock.callCount(), 1);
  for (const result of results) assert.deepEqual(result.data, ['000001']);
});
