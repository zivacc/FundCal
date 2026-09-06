import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchMorningstarHistory } from './morningstar-api.js';

test('Morningstar requests share in-flight/results and limit bulk requests to four', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let active = 0, max = 0, calls = 0;
  globalThis.fetch = async url => {
    calls++; active++; max = Math.max(max, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return { ok: true, json: async () => ({ code: url.match(/(\d{6})\/morningstar/)[1], periods: [] }) };
  };
  const first = fetchMorningstarHistory('800001');
  assert.equal(fetchMorningstarHistory('800001'), first);
  const results = await Promise.all([first, ...Array.from({ length: 7 }, (_, i) => fetchMorningstarHistory(String(800002 + i)))]);
  assert.equal(max, 4); assert.equal(calls, 8);
  assert.equal(await fetchMorningstarHistory('800001'), results[0]);
  assert.equal(calls, 8);
  await fetchMorningstarHistory('800001', { refresh: true });
  assert.equal(calls, 9);
});

test('Morningstar failures can retry and invalid codes do not request data', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: calls > 1, json: async () => ({ periods: [] }) }; };
  await assert.rejects(fetchMorningstarHistory('900001'), /无法加载/);
  assert.deepEqual(await fetchMorningstarHistory('900001'), { periods: [] });
  assert.equal(await fetchMorningstarHistory('000300.SH'), null);
  assert.equal(calls, 2);
});
