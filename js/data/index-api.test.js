import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchIndexDetail, fetchIndexDetailSearch } from './index-api.js';
import { clearIdbCache } from './idb-cache.js';

test('detail client preserves exact codes and forwards snapshot and abort signal', async t => {
  const originalWindow = globalThis.window, originalFetch = globalThis.fetch;
  globalThis.window = { location: { hostname: 'localhost' } };
  t.after(() => { globalThis.window = originalWindow; globalThis.fetch = originalFetch; });
  const controller = new AbortController();
  let called;
  globalThis.fetch = async (url, options) => { called = { url, options }; return { ok: true, json: async () => ({ index: { ts_code: 'h30590.CSI' } }) }; };
  assert.deepEqual(await fetchIndexDetail('h30590.CSI', { snapshot: 3, signal: controller.signal }), { index: { ts_code: 'h30590.CSI' } });
  assert.equal(called.url, 'http://localhost:3457/api/index/h30590.CSI?snapshot=3');
  assert.equal(called.options.signal, controller.signal);
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(fetchIndexDetail('UNKNOWN.SH'), /未找到该指数/);
  await assert.rejects(fetchIndexDetail('h30590.CSI', { snapshot: 999 }), /没有这份权重快照/);
});

test('detail search uses an independent shared cache key, not the NAV history pool', async t => {
  const originalWindow = globalThis.window, originalFetch = globalThis.fetch;
  globalThis.window = { location: { hostname: 'fund.example' } };
  t.after(() => { globalThis.window = originalWindow; globalThis.fetch = originalFetch; });
  await clearIdbCache('/api/index/detail-search-index');
  let calls = 0;
  globalThis.fetch = async url => { calls++; assert.equal(url, '/api/index/search-index'); return new Response(JSON.stringify([{ code: 'HSBT.HI' }]), { headers: { ETag: '"detail"' } }); };
  assert.deepEqual(await fetchIndexDetailSearch(), [{ code: 'HSBT.HI' }]);
  assert.deepEqual(await fetchIndexDetailSearch(), [{ code: 'HSBT.HI' }]);
  assert.equal(calls, 1);
});
