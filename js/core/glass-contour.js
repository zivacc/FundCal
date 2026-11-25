import { advanceSpring, createSpring } from './glass-spring.js';

// Rotate one top-right quadrant clockwise to cover the full rim.
const rotations = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const arcStep = Math.PI / 6;
const arcHandle = 4 / 3 * Math.tan(arcStep / 4);
const corner = [0, 1, 2].map(i => [Math.sin(i * arcStep), Math.cos(i * arcStep)]);

const round = value => Math.round(value * 1000) / 1000;
const bounded = value => Math.max(-1, Math.min(1, value));

// The edge beside a pulled cap bows out, with a smaller hollow toward the opposite cap.
// Pulse bows the middle of each side under a press; the four shoulder springs retain
// their individual velocities as the pointer reverses or lifts.
function flank(t, sum, difference, pulse) {
  return (sum * .55 + pulse * .20) * (.5 - .65 * t * t) + difference * 1.65 * t * (1 - .8 * t * t);
}
function flankSlope(t, sum, difference, pulse) {
  return -1.3 * t * (sum * .55 + pulse * .20) + 1.65 * difference * (1 - 2.4 * t * t);
}

// Follow the CSS straight flanks and circular caps at rest. A split midway along
// each half-side lets the spring field bow long edges. Pills have no short flank
// and circles have no straight segments at all.
function roundedRectKnots(halfW, halfH, r) {
  const knots = [];
  for (const [cos, sin] of rotations) {
    const runX = (sin ? halfH : halfW) - r, runY = (sin ? halfW : halfH) - r;
    const add = (x, y, dx, dy, handle) => knots.push({
      x: cos * x - sin * y, y: sin * x + cos * y,
      dx: cos * dx - sin * dy, dy: sin * dx + cos * dy, handle,
    });
    if (runX > 0) {
      for (const t of [0, .5]) add(t * runX, -runY - r, 1, 0, runX / 6);
    }
    for (const [sx, cy] of corner) {
      add(runX + r * sx, -runY - r * cy, cy, sx, r * arcHandle);
    }
    if (runY > 0) {
      for (const t of [0, .5]) add(runX + r, (t - 1) * runY, 0, 1, runY / 6);
    }
  }
  return knots;
}

export function createGlassContour() {
  const left = createSpring(0), right = createSpring(0), top = createSpring(0), bottom = createSpring(0);
  const pulse = createSpring(0);
  const axes = [left, right, top, bottom, pulse];

  function step(seconds, { velocityX = 0, velocityY = 0, pointerX = 0, pointerY = 0, pressure = 0 } = {}) {
    const press = Math.max(0, Math.min(1, pressure));
    const grip = .46 + .45 * press;
    const driveX = bounded(Math.tanh(velocityX / 530) + bounded(pointerX) * grip);
    const driveY = bounded(Math.tanh(velocityY / 460) + bounded(pointerY) * grip);
    left.goal = Math.max(0, -driveX);
    right.goal = Math.max(0, driveX);
    top.goal = Math.max(0, -driveY);
    bottom.goal = Math.max(0, driveY);
    pulse.goal = press;
    for (const axis of axes) advanceSpring(axis, seconds * .78, .0015, .5);
    return axes.some(axis => axis.value !== axis.goal || axis.velocity !== 0);
  }

  function reset() {
    for (const axis of axes) axis.value = axis.goal = axis.velocity = 0;
  }

  function path(width, height, radius = Infinity, inset = 1) {
    if (!(width > 0 && height > 0)) return '';
    const shortSide = Math.min(width, height);
    const edge = Math.min(Math.max(0, inset), shortSide * .45);
    const halfW = width / 2 - edge, halfH = height / 2 - edge;
    const r = Math.max(0, Math.min(radius, shortSide / 2) - edge);
    const amplitude = Math.min(5, Math.min(halfW, halfH) * .30);
    const sumX = left.value + right.value, pullX = right.value - left.value;
    const sumY = top.value + bottom.value, pullY = bottom.value - top.value;
    // A subpixel corner keeps a continuous tangent even when an inset reaches a square corner.
    const cornerRadius = Math.max(r, Math.min(.5, halfW / 2, halfH / 2));
    const knots = roundedRectKnots(halfW, halfH, cornerRadius).map(({ x, y, dx, dy, handle }) => {
      const u = x / halfW, v = y / halfH, du = dx / halfW, dv = dy / halfH;
      const bowX = flank(v, sumY, pullY, pulse.value);
      const bowY = flank(u, sumX, pullX, pulse.value);
      const strainX = Math.tanh((u * bowX + pullX * (.26 + .54 * u * u)) / 1.18);
      const strainY = Math.tanh((v * bowY + pullY * (.26 + .54 * v * v)) / 1.18);
      // Differentiate the displaced coordinates as well as the base shape. Both
      // Bézier handles at each knot keep exactly the same tangent through a reversal.
      return {
        x: width / 2 + x + amplitude * 1.18 * strainX, y: height / 2 + y + amplitude * 1.18 * strainY,
        dx: dx + amplitude * (1 - strainX * strainX) * (du * (bowX + 1.08 * pullX * u) + u * dv * flankSlope(v, sumY, pullY, pulse.value)),
        dy: dy + amplitude * (1 - strainY * strainY) * (dv * (bowY + 1.08 * pullY * v) + v * du * flankSlope(u, sumX, pullX, pulse.value)),
        handle,
      };
    });
    // Adjacent cubic segments share the tangent of the displaced knot.
    let d = `M${round(knots[0].x)} ${round(knots[0].y)}`;
    for (let i = 0; i < knots.length; i++) {
      const a = knots[i], b = knots[(i + 1) % knots.length];
      const handle = a.handle;
      d += `C${round(a.x + a.dx * handle)} ${round(a.y + a.dy * handle)} ${round(b.x - b.dx * handle)} ${round(b.y - b.dy * handle)} ${round(b.x)} ${round(b.y)}`;
    }
    return d + 'Z';
  }

  return { path, step, reset };
}
