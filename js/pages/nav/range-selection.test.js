import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resizeRangeBoundary as resize } from './range-selection.js';
test('each boundary moves independently and snaps to data points', () => {
  assert.deepEqual(resize(10, 60, 'start', 20.8, 100), { sIx: 21, eIx: 60 });
  assert.deepEqual(resize(10, 60, 'end', 80.2, 100), { sIx: 10, eIx: 80 });
});
test('boundaries clamp at history limits and cannot cross each other', () => {
  assert.deepEqual(resize(10, 60, 'start', -20, 100), { sIx: 0, eIx: 60 });
  assert.deepEqual(resize(10, 60, 'end', 500, 100), { sIx: 10, eIx: 99 });
  assert.deepEqual(resize(10, 60, 'start', 90, 100), { sIx: 59, eIx: 60 });
  assert.deepEqual(resize(10, 60, 'end', 0, 100), { sIx: 10, eIx: 11 });
  assert.equal(resize(0, 0, 'end', 1, 1), null);
});
