import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGlassField, glassApertureInset, glassLightDirection, glassLightMatrices } from './glass-optics.js';

const zoom = 1.16, width = 120, height = 48, outset = 5;
const lens = createGlassField(width, height, 24, 8, 18, outset, zoom);
const pixelAt = (x, y) => 4 * ((y + outset) * lens.width + x + outset);

function sourceAt(x, y) {
  const p = pixelAt(x, y);
  return [x, y].map((coord, channel) => coord + .5 + (lens.refraction[p + channel] / 255 - .5) * lens.range);
}

test('inverse sampling gives the requested magnification and no dispersion throughout the clear center', () => {
  const [a] = sourceAt(39, 24);
  const [b] = sourceAt(79, 24);
  assert.ok(Math.abs((b - a) - 40 / zoom) < lens.range / 255);
  for (const point of [[39, 24], [79, 24], [59, 12]]) {
    const p = pixelAt(...point);
    assert.deepEqual([...lens.dispersion.slice(p, p + 2)], [128, 128]);
    assert.equal(lens.refraction[p + 2], 0);
  }
});

test('the rounded caps bend passing content, the flat bevel samples a centered label just once', () => {
  const [capX] = sourceAt(3, 24);
  const centerOnly = width / 2 + (3.5 - width / 2) / zoom;
  assert.ok(capX > centerOnly + 3, 'ray turns inward near the cap');
  const flatBevel = lens.refraction[pixelAt(59, 3) + 2];
  assert.ok(flatBevel > 0 && flatBevel < lens.refraction[pixelAt(3, 24) + 2] / 4);
  for (let y = 1; y < height; y += 1) {
    assert.ok(sourceAt(59, y)[1] >= sourceAt(59, y - 1)[1], 'flat bevel has no fold');
  }
});

test('a narrow high-density dock shoulder bends successive samples continuously', () => {
  const width = 44, radius = 22;
  const dock = createGlassField(width, width, radius, 5, 14, 0, zoom, 2);
  assert.equal(dock.width, width * 2);
  let previous = null;
  for (let column = 0; column < dock.width / 2; column += 1) {
    const outputX = (column + .5) / 2;
    const p = 4 * (dock.width / 2 * dock.width + column);
    const source = outputX + (dock.refraction[p] / 255 - .5) * dock.range;
    if (previous !== null) assert.ok(Math.abs(source - previous) < .7, 'no jumps between adjacent display pixels');
    previous = source;
  }
});

test('dispersion is confined to the inner shoulder and the padded texture stays neutral', () => {
  const size = 44, radius = size / 2;
  for (const density of [1, 2]) {
    const field = createGlassField(size, size, radius, 5, 14, outset, zoom, density);
    let peak = 0, atDepth = 0;
    for (let row = 0; row < field.height; row++) {
      for (let column = 0; column < field.width; column++) {
        const x = (column + .5) / density - outset - radius;
        const y = (row + .5) / density - outset - radius;
        const depth = radius - Math.hypot(x, y);
        const p = 4 * (row * field.width + column);
        const split = Math.hypot(field.dispersion[p] - 128, field.dispersion[p + 1] - 128);
        if (depth <= glassApertureInset || depth >= 8) assert.equal(split, 0);
        if (split > peak) { peak = split; atDepth = depth; }
      }
    }
    assert.ok(peak > 64 && atDepth > 4 && atDepth < 6, 'lit content splits inside the bevel');
  }
});

test('the light steers the chromatic shoulders and stays lit at the center of the control', () => {
  const direction = glassLightDirection(0, 0);
  assert.ok(direction.x < 0 && direction.y < 0);
  const [r, g] = [direction.x / 2 + .5, direction.y / 2 + .5];
  const matrix = glassLightMatrices(0, 0, lens.range).color;
  const projected = (r, g) => [matrix[0] * r + matrix[1] * g + matrix[4] - .5,
    matrix[5] * r + matrix[6] * g + matrix[9] - .5];
  assert.ok(Math.hypot(...projected(r, g)) > .49);
  assert.ok(Math.hypot(...projected(1 - g, r)) < .001, 'tangential edge remains neutral');
  const left = glassLightMatrices(-.9, 0, lens.range), right = glassLightMatrices(.9, 0, lens.range);
  assert.ok(left.bend[2] < 0 && right.bend[2] > 0);
  assert.notDeepEqual(left.color, right.color);
});

test('ring-only optics still sample card and table centers in place, with bounded texture size', () => {
  const ring = createGlassField(900, 40, 12, 5, 10, 5, 1);
  assert.equal(ring.width, 256);
  assert.equal(ring.range, 10);
  assert.equal(ring.dispersion, null);
  const p = 4 * (Math.floor(ring.height / 2) * ring.width + Math.floor(ring.width / 2));
  assert.deepEqual([...ring.refraction.slice(p, p + 4)], [128, 128, 0, 255]);
});
