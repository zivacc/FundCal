import { advanceSpring, createSpring } from './glass-spring.js';
export { advanceSpring, createSpring };

// The element is an empty, absolutely positioned rim. Its text-bearing siblings never scale.
export function createGlassMotion(element, { liftOnPress = false, rim } = {}) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const centerX = createSpring(0), centerY = createSpring(0);
  const width = createSpring(0), height = createSpring(0), pressure = createSpring(0);
  const axes = [centerX, centerY, width, height, pressure];
  let positioned = false;
  let frame = 0;
  let previousTime = 0;
  let lightX = null, lightY = null;

  function paint(seconds = 0, snapContour = false) {
    // Limit the trailing edge even when the user skips across many rows or tabs.
    const stretchX = Math.min(Math.abs(centerX.velocity) * .012, width.value * .22, 18);
    const stretchY = Math.min(Math.abs(centerY.velocity) * .012, height.value * .22, 12);
    const pressWidth = liftOnPress ? Math.min(14, width.value * .14) : -Math.min(4, width.value * .05);
    const pressHeight = liftOnPress ? Math.min(10, height.value * .23) : -Math.min(3, height.value * .09);
    const w = Math.max(1, width.value + stretchX - Math.min(2, stretchY * .22) + pressure.value * pressWidth);
    const h = Math.max(1, height.value + stretchY - Math.min(2.5, stretchX * .22) + pressure.value * pressHeight);
    const x = centerX.value - w / 2 - Math.sign(centerX.velocity) * stretchX * .2;
    const y = centerY.value - h / 2 - Math.sign(centerY.velocity) * stretchY * .2;
    element.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${w / width.goal}, ${h / height.goal})`;
    if (!rim) return false;
    const relative = (value, start, size) => value == null || reducedMotion.matches ? null :
      Math.max(-1, Math.min(1, (value - start) / size * 2 - 1));
    return rim.paint(width.goal, height.goal, seconds, {
      velocityX: centerX.velocity, velocityY: centerY.velocity, pressure: pressure.value,
      pointerX: relative(lightX, x, w), pointerY: relative(lightY, y, h),
    }, snapContour);
  }

  function snap() {
    cancelAnimationFrame(frame);
    frame = 0;
    for (const axis of axes) {
      axis.value = axis.goal;
      axis.velocity = 0;
    }
    paint(0, true);
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
    for (const axis of axes) advanceSpring(axis, elapsed, .025, liftOnPress ? .77 : 1);
    const movingEdge = paint(elapsed);
    if (movingEdge || axes.some(axis => axis.value !== axis.goal || axis.velocity !== 0)) {
      frame = requestAnimationFrame(tick);
    }
  }

  function start() {
    if (frame) return;
    previousTime = performance.now();
    frame = requestAnimationFrame(tick);
  }

  function moveTo(rect, { immediate = false, pointerX = null, pointerY = null } = {}) {
    if (rect.width <= 0 || rect.height <= 0) return;
    const lightChanged = lightX !== pointerX || lightY !== pointerY;
    lightX = pointerX;
    lightY = pointerY;
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
    } else if (changed || lightChanged) {
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

  function setPointer(x, y) {
    if (!positioned || reducedMotion.matches || (x === lightX && y === lightY)) return;
    lightX = x;
    lightY = y;
    start();
  }

  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    positioned = false;
    pressure.goal = 0;
    lightX = lightY = null;
    rim?.reset();
  }

  return { moveTo, setPressed, setPointer, reset };
}
