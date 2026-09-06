import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resizeRangeBoundary as resize } from './range-selection.js';
test('each boundary moves independently and snaps to data points', () => {
  assert.deepEqual(resize(10, 60, 'start', 20.8, 100), { sIx: 21, eIx: 60, activeEdge: 'start' });
  assert.deepEqual(resize(10, 60, 'end', 80.2, 100), { sIx: 10, eIx: 80, activeEdge: 'end' });
});
test('crossing either endpoint keeps the opposite anchor and changes active role', () => {
  assert.deepEqual(resize(10, 60, 'start', 90, 100), { sIx: 60, eIx: 90, activeEdge: 'end' });
  assert.deepEqual(resize(10, 60, 'end', 0, 100), { sIx: 0, eIx: 10, activeEdge: 'start' });
  let range = { sIx: 30, eIx: 60, activeEdge: 'end' };
  for (const target of [40, 30, 20, 0, 25, 30, 50, 99]) {
    range = resize(range.sIx, range.eIx, range.activeEdge, target, 100);
    assert.equal(range.activeEdge === 'end' ? range.sIx : range.eIx, 30);
    assert.ok(range.eIx > range.sIx);
  }
});
test('history limits and coincident endpoints retain a nonempty interval', () => {
  assert.deepEqual(resize(10, 60, 'start', -20, 100), { sIx: 0, eIx: 60, activeEdge: 'start' });
  assert.deepEqual(resize(10, 60, 'end', 500, 100), { sIx: 10, eIx: 99, activeEdge: 'end' });
  assert.deepEqual(resize(10, 60, 'start', 60, 100), { sIx: 59, eIx: 60, activeEdge: 'start' });
  assert.deepEqual(resize(10, 60, 'end', 10, 100), { sIx: 10, eIx: 11, activeEdge: 'end' });
  assert.equal(resize(0, 0, 'end', 1, 1), null);
  assert.equal(resize(0, 10, 'end', NaN, 20), null);
});
