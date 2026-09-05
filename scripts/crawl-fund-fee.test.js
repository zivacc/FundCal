import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFundFee } from './crawl-fund-fee.js';

test('blank/error pages are not saved as zero-fee funds', async t => {
  for (const body of ['', '<html>Service unavailable</html>']) {
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      return new Response(body, { status: 200 });
    });
    assert.equal(await fetchFundFee('080001'), null);
    assert.equal(await fetchFundFee('968001'), null);
    t.mock.restoreAll();
  }
});
