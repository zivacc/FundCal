// A critically damped spring preserves velocity when the pointer changes direction.
// Its closed-form step takes elapsed seconds and behaves the same on 60 and 120 Hz displays.
const frequency = 29;

export function createSpring(value) {
  return { value, goal: value, velocity: 0 };
}

export function advanceSpring(axis, seconds, tolerance = .025) {
  const offset = axis.value - axis.goal;
  const impulse = axis.velocity + frequency * offset;
  const decay = Math.exp(-frequency * seconds);
  axis.value = axis.goal + (offset + impulse * seconds) * decay;
  axis.velocity = (axis.velocity - frequency * impulse * seconds) * decay;
  if (Math.abs(axis.value - axis.goal) < tolerance && Math.abs(axis.velocity) < tolerance * 26) {
    axis.value = axis.goal;
    axis.velocity = 0;
  }
}

// The element is an empty, absolutely positioned rim. Its text-bearing siblings never scale.
export function createGlassMotion(element) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const centerX = createSpring(0), centerY = createSpring(0);
  const width = createSpring(0), height = createSpring(0), pressure = createSpring(0);
  const axes = [centerX, centerY, width, height, pressure];
  let positioned = false;
  let frame = 0;
  let previousTime = 0;
  let highlight = null;

  function paint() {
    // Limit the trailing edge even when the user skips across many rows or tabs.
    const stretchX = Math.min(Math.abs(centerX.velocity) * .012, width.value * .22, 18);
    const stretchY = Math.min(Math.abs(centerY.velocity) * .012, height.value * .22, 12);
    const w = Math.max(1, width.value + stretchX - Math.min(2, stretchY * .22) - pressure.value * Math.min(4, width.value * .05));
    const h = Math.max(1, height.value + stretchY - Math.min(2.5, stretchX * .22) - pressure.value * Math.min(3, height.value * .09));
    const x = centerX.value - w / 2 - Math.sign(centerX.velocity) * stretchX * .2;
    const y = centerY.value - h / 2 - Math.sign(centerY.velocity) * stretchY * .2;
    element.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${w / width.goal}, ${h / height.goal})`;
  }

  function snap() {
    cancelAnimationFrame(frame);
    frame = 0;
    for (const axis of axes) {
      axis.value = axis.goal;
      axis.velocity = 0;
    }
    paint();
  }

  function tick(time) {
    frame = 0;
    if (reducedMotion.matches) {
      pressure.goal = 0;
      snap();
      return;
    }
    const elapsed = Math.max(0, time - previousTime) / 1000;
    previousTime = time;
    for (const axis of axes) advanceSpring(axis, elapsed);
    paint();
    if (axes.some(axis => axis.value !== axis.goal || axis.velocity !== 0)) {
      frame = requestAnimationFrame(tick);
    }
  }

  function start() {
    if (frame) return;
    previousTime = performance.now();
    frame = requestAnimationFrame(tick);
  }

  function moveTo(rect, { immediate = false } = {}) {
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    const changed = x !== centerX.goal || y !== centerY.goal || width.goal !== rect.width || height.goal !== rect.height;
    if (width.goal !== rect.width) element.style.width = `${rect.width}px`;
    if (height.goal !== rect.height) element.style.height = `${rect.height}px`;
    centerX.goal = x;
    centerY.goal = y;
    width.goal = rect.width;
    height.goal = rect.height;
    if (immediate || !positioned || reducedMotion.matches) {
      if (reducedMotion.matches) pressure.goal = 0;
      snap();
    } else if (changed) {
      paint(); // Compensate for the new layout size in the same frame.
      start();
    }
    positioned = true;
  }

  function setPressed(pressed) {
    if (!positioned || reducedMotion.matches || pressure.goal === Number(pressed)) return;
    pressure.goal = Number(pressed);
    if (pressed) pressure.velocity = Math.max(pressure.velocity, 22);
    start();
  }

  // Coordinates come from the last target measurement. Pointer travel within a row
  // only moves a hairline reflection and needs no new layout or displacement map.
  function highlightAt(clientX, bounds) {
    const next = bounds && clientX != null && !reducedMotion.matches
      ? Math.round(Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width)) * 100)
      : null;
    if (next === highlight) return;
    highlight = next;
    element.classList.toggle('has-glint', next !== null);
    if (next !== null) element.style.setProperty('--rim-glint-x', `${next}%`);
  }

  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    positioned = false;
    pressure.goal = 0;
    highlightAt(null);
  }

  return { moveTo, setPressed, highlightAt, reset };
}
