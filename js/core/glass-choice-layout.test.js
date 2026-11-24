import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nearestChoice, pulledChoiceRect } from './glass-choice-layout.js';

const first = { x: 4, y: 3, width: 48, height: 36 };
const wide = { x: 58, y: 3, width: 103, height: 36 };
const wrapped = { x: 4, y: 46, width: 103, height: 36 };
const choices = [first, wide, wrapped];
const center = rect => rect.x + rect.width / 2;

test('unequal buttons share one continuous lens path across their gap', () => {
  for (const held of [true, false]) {
    const point = { x: 55, y: 21 };
    const fromLeft = pulledChoiceRect(first, choices, point, held);
    const fromRight = pulledChoiceRect(wide, choices, point, held);
    assert.ok(Math.abs(center(fromLeft) - center(fromRight)) < 1e-9);
    assert.ok(center(first) < center(fromLeft) && center(fromLeft) < center(wide));
    assert.deepEqual(pulledChoiceRect(wide, choices, { x: center(wide), y: 21 }, held), wide);
  }
  assert.equal(nearestChoice(choices, { x: 51, y: 20 }, 8), first);
  assert.equal(nearestChoice(choices, { x: 57, y: 20 }, 8), wide);
  assert.equal(nearestChoice(choices, { x: 180, y: 100 }, 8), null);
});

test('wrapped controls use their own row and resist a pull beyond its ends', () => {
  const pointer = { x: 140, y: 64 };
  for (const held of [true, false]) {
    const pulled = pulledChoiceRect(wrapped, choices, pointer, held);
    assert.deepEqual(pulled, pulledChoiceRect(wrapped, [wrapped], pointer, held));
    assert.ok(center(pulled) > center(wrapped) && center(pulled) < center(wrapped) + 19);
  }
});
