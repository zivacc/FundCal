import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFundListPageFromAPI } from './fund-api.js';

test('list HTTP contract includes explicit empty pool and preserves abort signal', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: new URL(url), options });
    return { ok: true, json: async () => ({ total: 0, rows: [] }) };
  });
  const signal = new AbortController().signal;
  await fetchFundListPageFromAPI({ poolCodes: [], signal });
  await fetchFundListPageFromAPI({ poolCodes: ['000001', '000002'], q: '京东', sort: 'morningstarTotalFee:desc' });
  await fetchFundListPageFromAPI();
  assert.equal(calls[0].url.searchParams.get('poolCodes'), '');
  assert.equal(calls[0].url.searchParams.get('page'), '1');
  assert.equal(calls[0].options.signal, signal);
  assert.equal(calls[1].url.searchParams.get('poolCodes'), '000001,000002');
  assert.equal(calls[1].url.searchParams.get('q'), '京东');
  assert.equal(calls[2].url.searchParams.has('poolCodes'), false);
});
