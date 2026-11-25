import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGlassContour } from './glass-contour.js';

function segments(path) {
  return [...path.matchAll(/C([^CZ]+)/g)].map(match => match[1].split(' ').map(Number));
}

function sampleOutline(path) {
  const curves = segments(path);
  let [x, y] = curves.at(-1).slice(-2);
  const points = [[x, y]];
  for (const [ax, ay, bx, by, ex, ey] of curves) {
    for (let i = 1; i <= 32; i++) {
      const t = i / 32, s = 1 - t;
      points.push([s ** 3 * x + 3 * s * s * t * ax + 3 * s * t * t * bx + t ** 3 * ex,
        s ** 3 * y + 3 * s * s * t * ay + 3 * s * t * t * by + t ** 3 * ey]);
    }
    x = ex;
    y = ey;
  }
  return points;
}

// Measure rendered cross sections independently of the number and order of Bézier knots.
function thicknessAt(points, x) {
  const crossings = [];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    if ((ax <= x) !== (bx <= x)) crossings.push(ay + (by - ay) * (x - ax) / (bx - ax));
  }
  assert.equal(crossings.length, 2);
  return Math.abs(crossings[0] - crossings[1]);
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

test('resting rims follow CSS corners on cards, rows, long pills and near-capsules', () => {
  const contour = createGlassContour();
  for (const [width, height, radius] of [
    [330, 420, 20], [900, 35, 8], [44, 44, Infinity], [210, 26, 999], [326, 31, Infinity],
    [326, 31, 15], [31, 326, 15], [26, 210, 999],
  ]) {
    for (const inset of [0, 1.7, 6]) {
      const path = contour.path(width, height, radius, inset);
      checkTangents(path);
      assert.ok(path.endsWith('Z'));
      const corners = Math.max(0, Math.min(radius, width / 2, height / 2) - inset);
      let deviation = 0;
      for (const [px, py] of sampleOutline(path)) {
        const dx = Math.abs(px - width / 2) - (width / 2 - inset - corners);
        const dy = Math.abs(py - height / 2) - (height / 2 - inset - corners);
        const distance = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - corners;
        deviation = Math.max(deviation, Math.abs(distance));
      }
      assert.ok(deviation < 1, `${width}×${height} r=${radius} inset=${inset} deviates by ${deviation}px`);
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
    const points = sampleOutline(outline());
    return thicknessAt(points, 85 * .78) - thicknessAt(points, 85 * .22);
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

test('a tall pill bows under pressure and follows vertical motion', () => {
  const contour = createGlassContour();
  const path = () => contour.path(26, 210);
  const crossSections = () => sampleOutline(path()).map(([x, y]) => [y, x]);
  const resting = crossSections();
  for (let i = 0; i < 20; i++) contour.step(1 / 60, { pressure: 1 });
  assert.ok(thicknessAt(crossSections(), 105) > thicknessAt(resting, 105) + .4);
  for (let i = 0; i < 20; i++) contour.step(1 / 60, { velocityY: 900, pointerY: .8 });
  const moving = crossSections();
  assert.ok(thicknessAt(moving, 160) > thicknessAt(moving, 50) + 4);
  checkTangents(path());
});
