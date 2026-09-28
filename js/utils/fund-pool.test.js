import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePoolCodes, restrictFundPool } from './fund-pool.js';

test('fund pool distinguishes full universe, empty pool and invalid input', () => {
  assert.equal(normalizePoolCodes(undefined), null);
  assert.deepEqual(normalizePoolCodes(''), []);
  assert.deepEqual(normalizePoolCodes("bad,000300.SH,' OR 1=1"), []);
  assert.deepEqual(normalizePoolCodes('000001, 000002,000001'), ['000001', '000002']);
  assert.equal(normalizePoolCodes(Array.from({ length: 220 }, (_, i) => String(i).padStart(6, '0'))).length, 200);
});

test('static fallback restricts pool before search and pagination, including empty pool', () => {
  const rows = [{ code: '000001' }, { code: '000002' }];
  assert.equal(restrictFundPool(rows, null), rows);
  assert.deepEqual(restrictFundPool(rows, []), []);
  assert.deepEqual(restrictFundPool(rows, ['000002', '000002', '000003']), [rows[1]]);
});
