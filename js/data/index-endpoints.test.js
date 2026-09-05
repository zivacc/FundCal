import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFeederIndexFromAPI } from './fund-api.js';
import { fetchIndexSearchIndexFromAPI } from './nav-api.js';
import { clearIdbCache } from './idb-cache.js';

function mockGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  });
}

for (const [hostname, override, expected] of [
  ['localhost', null, 'http://localhost:3457/api/nav/index-search-index'],
  ['fund.example', null, '/api/nav/index-search-index'],
  ['fund.example', 'https://custom.example/api/fund/', 'https://custom.example/api/nav/index-search-index'],
  ['fund.github.io', null, 'data/allfund/index-search-index.json'],
]) {
  test(`index search resolves ${override || hostname}`, async t => {
    mockGlobal(t, 'window', { location: { hostname }, FUND_FEE_API_BASE: override });
    await clearIdbCache();
    const calls = [];
    const data = [{ code: 'HSI.HI', kind: 'index' }];
    t.mock.method(globalThis, 'fetch', async url => { calls.push(url); return Response.json(data); });
    assert.deepEqual(await fetchIndexSearchIndexFromAPI(), data);
    assert.deepEqual(await fetchIndexSearchIndexFromAPI(), data);
    assert.deepEqual(calls, [expected]);
  });
}

test('index API failure falls back to the static index', async t => {
  mockGlobal(t, 'window', { location: { hostname: 'fund.example' } });
  await clearIdbCache();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url);
    return url.startsWith('/api/') ? new Response(null, { status: 503 }) : Response.json([{ code: 'HSI.HI' }]);
  });
  assert.deepEqual(await fetchIndexSearchIndexFromAPI(), [{ code: 'HSI.HI' }]);
  assert.deepEqual(calls, ['/api/nav/index-search-index', 'data/allfund/index-search-index.json']);
});

test('feeder index loads the static resource directly and caches it', async t => {
  mockGlobal(t, 'window', { location: { hostname: 'localhost' } });
  await clearIdbCache();
  const calls = [];
  const data = { feederByMasterKey: { test: ['000001'] }, codeToFeeder: { '000001': 'test' } };
  t.mock.method(globalThis, 'fetch', async url => { calls.push(url); return Response.json(data); });
  assert.deepEqual(await fetchFeederIndexFromAPI(), data);
  assert.deepEqual(await fetchFeederIndexFromAPI(), data);
  assert.deepEqual(calls, ['data/allfund/feeder-index.json']);
});
