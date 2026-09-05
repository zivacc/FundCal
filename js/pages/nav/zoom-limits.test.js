import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_ZOOM_DATA_POINTS, getMinZoomValueSpan, clampZoomIndices } from './zoom-limits.js';

test('short presets and date inputs expand to the same 100-point window as the chart', () => {
  assert.deepEqual(clampZoomIndices(480, 499, 500), { start: 400, end: 499 });
  assert.deepEqual(clampZoomIndices(0, 20, 500), { start: 0, end: 99 });
  assert.deepEqual(clampZoomIndices(5, 8, 30), { start: 0, end: 29 });
});

test('category zoom keeps at least 100 visible data points', () => {
  assert.equal(MIN_ZOOM_DATA_POINTS, 100);
  assert.equal(getMinZoomValueSpan(500), 99);
  assert.equal(getMinZoomValueSpan(100), 99);
});

test('category zoom keeps the full range when fewer than 100 points exist', () => {
  assert.equal(getMinZoomValueSpan(80), 79);
  assert.equal(getMinZoomValueSpan(1), 0);
  assert.equal(getMinZoomValueSpan(0), 0);
});
