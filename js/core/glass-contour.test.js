import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGlassContour } from './glass-contour.js';

function segments(path) {
  return [...path.matchAll(/C([^CZ]+)/g)].map(match => match[1].split(' ').map(Number));
}

function checkTangents(path) {
  const curves = segments(path);
  for (let i = 0; i < curves.length; i++) {
    const [, , inX, inY, x, y] = curves[i];
    const [outX, outY] = curves[(i + 1) % curves.length];
    const a = Math.atan2(y - inY, x - inX), b = Math.atan2(outY - y, outX - x);
    assert.ok(Math.cos(a - b) > .9998, 'incoming and outgoing tangents agree at the knot');
  }
}

test('a smooth closed rim follows its real footprint, including large cards and wide rows', () => {
  const contour = createGlassContour(), inset = 1.7;
  for (const [width, height, radius] of [[330, 420, 24], [900, 35, 8], [44, 44, Infinity]]) {
    const path = contour.path(width, height, radius, inset);
    checkTangents(path);
    assert.ok(path.endsWith('Z'));
    const corners = Math.min(radius, width / 2, height / 2) - inset;
    const curves = segments(path);
    let [x, y] = curves.at(-1).slice(-2);
    for (const [ax, ay, bx, by, ex, ey] of curves) {
      for (const t of [0, .25, .5, .75, 1]) {
        const s = 1 - t;
        const px = s ** 3 * x + 3 * s * s * t * ax + 3 * s * t * t * bx + t ** 3 * ex;
        const py = s ** 3 * y + 3 * s * s * t * ay + 3 * s * t * t * by + t ** 3 * ey;
        const dx = Math.abs(px - width / 2) - (width / 2 - inset - corners);
        const dy = Math.abs(py - height / 2) - (height / 2 - inset - corners);
        const distance = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - corners;
        assert.ok(Math.abs(distance) < 1.1, 'resting curve tracks the rounded rectangle');
      }
      x = ex;
      y = ey;
    }
  }
  assert.equal(contour.path(0, 20), '');
  assert.ok(segments(contour.path(3, 4, 2, 5)).flat().every(Number.isFinite));
});

test('shoulders deform separately, retain momentum on reversal and settle to their rest shape', () => {
  const contour = createGlassContour();
  const outline = () => contour.path(85, 36);
  const idle = outline();
  const rightward = { velocityX: 1000, pointerX: .8, pressure: .8 };
  const leftward = { velocityX: -1000, pointerX: -.8, pressure: .8 };
  function asymmetry() {
    // Compare thickness across two symmetric shoulders. A rigid scale would keep them identical.
    const y = segments(outline()).map(curve => curve[5]);
    return (y[9] - y[1]) - (y[13] - y[21]);
  }
  for (let i = 0; i < 20; i++) contour.step(1 / 60, rightward);
  assert.ok(asymmetry() > 6);
  contour.step(1 / 60, leftward);
  assert.ok(asymmetry() > 4, 'the leading shoulder does not flip instantly');
  for (let i = 0; i < 9; i++) contour.step(1 / 60, leftward);
  assert.ok(asymmetry() < -6);
  checkTangents(outline());
  let rebound = false;
  for (let i = 0; i < 90; i++) {
    contour.step(1 / 60);
    if (asymmetry() > .5) rebound = true;
  }
  assert.ok(rebound, 'the shoulder passes gently through its rest position on release');
  assert.equal(contour.step(1 / 60), false);
  assert.equal(outline(), idle);
  contour.step(.1, rightward);
  contour.reset();
  assert.equal(outline(), idle);
});
