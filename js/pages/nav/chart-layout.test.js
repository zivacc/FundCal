import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartLayout, niceAxisBounds } from './chart-layout.js';
test('narrow and wide layouts align all panels and reserve navigator space', () => {
  for (const width of [320, 575, 1200]) for (const n of [0, 1, 2]) {
    const { grids, left, right } = chartLayout(width, 500, n);
    for (const [i, grid] of grids.entries()) {
      assert.equal(grid.left, left); assert.equal(grid.right, right);
      assert.ok(grid.height > 0);
      assert.ok(grid.top + grid.height <= 418);
      if (i) assert.ok(grid.top >= grids[i - 1].top + grids[i - 1].height + 39);
    }
  }
});
test('percentage ticks use round display values and include the data', () => {
  const b = niceAxisBounds(0.151, 14.114, 'pct');
  assert.ok(b.min <= 0.151 && b.max >= 14.114);
  assert.equal(b.interval * 100, 500);
  assert.equal((b.max - b.min) % b.interval, 0);
  assert.deepEqual(niceAxisBounds(undefined, undefined), {});
});
