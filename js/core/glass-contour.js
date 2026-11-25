import { advanceSpring, createSpring } from './glass-spring.js';

// A circular arc plus two gently curved flanks. The saturated coordinates extend the
// shoulders of a wide/short control while keeping a continuous tangent around the rim.
const segmentCount = 24;
const angleStep = 2 * Math.PI / segmentCount;
function shoulder(t) { return t * Math.sqrt(10 / (1 + 9 * t * t)); }
function shoulderSlope(t) { return Math.sqrt(10) / (1 + 9 * t * t) ** 1.5; }
const circle = Array.from({ length: segmentCount }, (_, i) => {
  const angle = i * angleStep, x = Math.sin(angle), y = -Math.cos(angle);
  return { x, y, sx: shoulder(x), sy: shoulder(y),
    dx: -y, dy: x, dsx: -y * shoulderSlope(x), dsy: x * shoulderSlope(y) };
});

const round = value => Math.round(value * 100) / 100;
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

// Large cards and table rows have a specific corner radius. Bow each side by at
// most 0.75px at rest, then join it tangentially to the original circular corner.
function roundedRectKnots(halfW, halfH, r) {
  const knots = [];
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const w = quadrant % 2 ? halfH : halfW, h = quadrant % 2 ? halfW : halfH;
    const bowX = Math.min(.75, (w - r) / 4), bowY = Math.min(.75, (h - r) / 4);
    const runX = w - r - bowX, runY = h - r - bowY;
    const { dx: cos, dy: sin } = circle[quadrant * segmentCount / 4];
    const add = (x, y, dx, dy) => {
      const length = Math.hypot(dx, dy);
      knots.push({ x: cos * x - sin * y, y: sin * x + cos * y,
        dx: (cos * dx - sin * dy) / length, dy: (sin * dx + cos * dy) / length });
    };
    for (const t of [0, .5]) {
      add(runX * t, -h + bowY * t * t * (3 - 2 * t), runX, bowY * 6 * t * (1 - t));
    }
    for (const { x, y, dx, dy } of [circle[0], circle[2], circle[4]]) {
      add(runX + r * x, -runY + r * y, dx, dy);
    }
    for (const t of [0, .5]) {
      add(w - bowX * (1 - t) ** 2 * (1 + 2 * t), -runY * (1 - t), bowX * 6 * t * (1 - t), runY);
    }
  }
  return knots;
}

function baseKnots(halfW, halfH, r, capsule) {
  if (!capsule) {
    const knots = roundedRectKnots(halfW, halfH, Math.max(r, Math.min(.5, halfW / 2, halfH / 2)));
    for (let i = 0; i < knots.length; i++) {
      const a = knots[i], b = knots[(i + 1) % knots.length];
      a.handle = Math.hypot(b.x - a.x, b.y - a.y) / 3;
    }
    return knots;
  }
  return circle.map(arc => ({
    x: r * arc.x + (halfW - r) * arc.sx, y: r * arc.y + (halfH - r) * arc.sy,
    dx: r * arc.dx + (halfW - r) * arc.dsx, dy: r * arc.dy + (halfH - r) * arc.dsy,
    handle: angleStep / 3,
  }));
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
    const capsule = radius >= shortSide * .47;
    const knots = baseKnots(halfW, halfH, r, capsule).map(({ x, y, dx, dy, handle }) => {
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
    // Cubic Hermite segments in SVG coordinates; angleStep/3 converts an angular
    // derivative into a Bézier handle. The last segment shares the first tangent.
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
