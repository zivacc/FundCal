import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deckPose, clampDeckIndex } from './deck-layout.js';
test('gallery center is largest; nearby cards recede, rotate and move symmetrically', () => {
  const center = deckPose(0, 330, 999), right = deckPose(1, 330, 999), back = deckPose(2, 330, 999), left = deckPose(-1, 330, 999);
  assert.equal(center.scale, 1); assert.equal(center.z, 0); assert.equal(center.x, 0);
  assert.ok(center.scale > right.scale && right.scale > back.scale);
  assert.ok(center.z > right.z && right.z > back.z);
  assert.equal(left.x, -right.x); assert.equal(left.angle, -right.angle);
  assert.equal(deckPose(3, 330, 999).opacity, 0);
  assert.ok(deckPose(1, 240, 320).x < right.x);
});
test('gallery supports empty/single lists and clamps drag endpoints', () => {
  assert.equal(clampDeckIndex(20, 0), 0);
  assert.equal(clampDeckIndex(1, 1), 0);
  assert.equal(clampDeckIndex(-1, 6), 0);
  assert.equal(clampDeckIndex(9, 6), 5);
  assert.equal(clampDeckIndex(1.4, 6), 1.4);
});
