import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFundRelations, resolveFundMaster } from './fund-relations-api.js';
import { clearIdbCache } from './idb-cache.js';

test('relationship caches are partitioned by API base; master lookup remains independently retryable', async t => {
  const prior = globalThis.window;
  globalThis.window = { location: { hostname: 'localhost' }, FUND_FEE_API_BASE: 'https://first.example/api/fund' };
  t.after(() => { if (prior === undefined) delete globalThis.window; else globalThis.window = prior; });
  await clearIdbCache();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => { calls.push(url); return Response.json({ url }); });
  const first = await fetchFundRelations('110020');
  assert.deepEqual(await fetchFundRelations('110020'), first);
  globalThis.window.FUND_FEE_API_BASE = 'https://second.example/api/fund/';
  const second = await fetchFundRelations('110020');
  assert.notEqual(first.url, second.url);
  assert.equal(calls.length, 2);
  await resolveFundMaster('110020');
  await resolveFundMaster('110020');
  assert.deepEqual(calls.slice(2), [
    'https://second.example/api/fund/110020/related?resolveMaster=1',
    'https://second.example/api/fund/110020/related?resolveMaster=1',
  ]);
});
