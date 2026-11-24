import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceSpring, createGlassMotion, createSpring } from './glass-motion.js';

test('switching direction follows the same path at different refresh rates', () => {
  function run(hz) {
    const axis = createSpring(0);
    for (const goal of [3, 1]) {
      axis.goal = goal;
      for (let n = 0; n < hz / 10; n++) advanceSpring(axis, 1 / hz, .0005);
    }
    return axis;
  }
  const at60 = run(60), at120 = run(120);
  assert.ok(Math.abs(at60.value - at120.value) < 1e-9);
  assert.ok(Math.abs(at60.velocity - at120.velocity) < 1e-9);
  advanceSpring(at60, 2, .0005);
  assert.deepEqual(at60, { value: 1, goal: 1, velocity: 0 });
});

test('the lifted lens rebounds and settles consistently at 60 and 120 Hz', () => {
  function sample(hz) {
    const axis = createSpring(0);
    axis.goal = 90;
    for (let i = 0; i < hz / 5; i++) advanceSpring(axis, 1 / hz, .025, .77);
    return axis;
  }
  const at60 = sample(60), at120 = sample(120);
  assert.ok(at60.value > 90 && at60.value < 93);
  assert.ok(Math.abs(at60.value - at120.value) < 1e-9);
  advanceSpring(at60, 1, .025, .77);
  assert.deepEqual(at60, { value: 90, goal: 90, velocity: 0 });
});

test('the moving rim keeps its velocity on reversal, settles exactly, and snaps on scroll or reduced motion', t => {
  let now = 0, pending = null;
  const preference = { matches: false };
  t.mock.method(performance, 'now', () => now);
  const browser = {
    matchMedia: () => preference,
    requestAnimationFrame: callback => { pending = callback; return 1; },
    cancelAnimationFrame: () => { pending = null; },
  };
  for (const [key, value] of Object.entries(browser)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }

  const element = { style: {} };
  const motion = createGlassMotion(element);
  const move = (x, options) => motion.moveTo({ x, y: 4, width: 100, height: 36 }, options);
  const rect = () => element.style.transform.match(/translate3d\(([^p]+)px,.*scale\(([^,]+)/).slice(1).map(Number);
  function step(ms) {
    now += ms;
    const tick = pending;
    pending = null;
    tick(now);
  }

  move(10);
  assert.deepEqual(rect(), [10, 1]);
  move(240);
  step(32);
  const [left, stretch] = rect();
  assert.ok(left > 10 && left < 240 && stretch > 1);
  move(0);
  assert.deepEqual(rect(), [left, stretch]);
  step(1);
  assert.ok(rect()[0] > left, 'reversal retains the incoming velocity');
  step(900);
  assert.deepEqual(rect(), [0, 1]);
  assert.equal(pending, null, 'idle rims schedule no frames');

  motion.setPressed(true);
  step(120);
  assert.ok(rect()[1] < 1);
  motion.setPressed(false);
  move(56, { immediate: true });
  assert.deepEqual(rect(), [56, 1]);
  assert.equal(pending, null);
  move(140);
  preference.matches = true;
  step(16);
  assert.deepEqual(rect(), [140, 1]);
  move(0);
  assert.deepEqual(rect(), [0, 1]);
  assert.equal(pending, null);
});
