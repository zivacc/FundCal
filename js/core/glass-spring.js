// Exact spring steps preserve velocity on reversal, independent of display refresh rate.
const frequency = 29;

export function createSpring(value) {
  return { value, goal: value, velocity: 0 };
}

export function advanceSpring(axis, seconds, tolerance = .025, damping = 1) {
  const offset = axis.value - axis.goal;
  const drag = frequency * damping;
  const decay = Math.exp(-drag * seconds);
  const omega = frequency * Math.sqrt(1 - damping * damping);
  const cos = Math.cos(omega * seconds);
  const sinOverOmega = omega ? Math.sin(omega * seconds) / omega : seconds;
  axis.value = axis.goal + decay * (offset * cos + (axis.velocity + drag * offset) * sinOverOmega);
  axis.velocity = decay * (axis.velocity * cos - (drag * axis.velocity + frequency * frequency * offset) * sinOverOmega);
  if (Math.abs(axis.value - axis.goal) < tolerance && Math.abs(axis.velocity) < tolerance * 26) {
    axis.value = axis.goal;
    axis.velocity = 0;
  }
}
