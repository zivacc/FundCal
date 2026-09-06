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

test('short landscape keeps two subplots above the navigator', () => {
  for (const height of [240, 320, 390]) {
    const { grids } = chartLayout(844, height, 2);
    for (const [i, grid] of grids.entries()) {
      assert.ok(grid.height > 0);
      assert.ok(grid.top + grid.height <= height - 82 + 1e-9);
      if (i) assert.ok(grid.top >= grids[i - 1].top + grids[i - 1].height + 24 - 1e-9);
    }
  }
});

test('phone dock leaves extra space without shifting shared time axes', () => {
  for (const n of [0, 1, 2]) {
    const normal = chartLayout(320, 640, n);
    const full = chartLayout(320, 640, n, { bottomInset: 56 });
    for (const [i, grid] of full.grids.entries()) {
      assert.equal(grid.left, normal.grids[i].left);
      assert.equal(grid.right, normal.grids[i].right);
      assert.ok(grid.height > 0);
      assert.ok(grid.top + grid.height <= 640 - 82 - 56 + 1e-9);
    }
    const end = ({ grids }) => grids.at(-1).top + grids.at(-1).height;
    assert.ok(Math.abs(end(normal) - end(full) - 56) < 1e-9);
  }
});

test('fullscreen leaves room for chart controls at the top in portrait and landscape', () => {
  for (const height of [320, 390, 640, 960]) {
    const { grids } = chartLayout(568, height, 2, { topInset: height < 420 ? 76 : 56, bottomInset: 56 });
    assert.equal(grids[0].top, 110);
    for (const grid of grids) {
      assert.ok(grid.height > 0);
      assert.ok(grid.top + grid.height <= height - 138 + 1e-9);
    }
  }
});
