import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchComparisonFund } from './fund-comparison.js';

test('comparison keeps current data when historical data fails; a missing fee stays null', async t => {
  t.mock.method(globalThis, 'fetch', async url => String(url).endsWith('/fee')
    ? Response.json({ code: '991001', name: '测试基金', annualFee: null }) : new Response('', { status: 503 }));
  const entry = await fetchComparisonFund('991001');
  assert.equal(entry.raw.annualFee, null);
  assert.equal(entry.history, null);
  assert.deepEqual(entry.errors, ['晨星历史暂不可用']);
});

test('comparison rejects another code in a response, tries its static shard, and preserves historical data', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    urls.push(url);
    if (String(url).endsWith('/morningstar')) return Response.json({ periods: [] });
    return Response.json({ code: '991099', annualFee: 0 });
  });
  const entry = await fetchComparisonFund('991002');
  assert.equal(entry.raw, null);
  assert.deepEqual(entry.history, { periods: [] });
  assert.ok(urls.includes('data/allfund/funds/991002.json'));
  assert.deepEqual(entry.errors, ['基础资料暂不可用']);
});

test('comparison identifies static fallback and refresh revalidates both sources', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (String(url).endsWith('/fee')) return new Response('', { status: 503 });
    if (String(url).endsWith('/morningstar')) return Response.json({ periods: [] });
    return Response.json({ code: '991003', annualFee: 0 });
  });
  const entry = await fetchComparisonFund('991003', { refresh: true });
  assert.equal(entry.source, 'static');
  assert.ok(entry.warnings.length);
  assert.ok(calls.every(call => call.options.cache === 'no-cache'));
});
