// Distances are in the rail's local CSS pixels, including its scrolled content.
export function nearestChoice(choices, point, reach = Infinity) {
  let nearest = null;
  let distance = reach * reach;
  for (const choice of choices) {
    const { x, y, width, height } = choice;
    const dx = Math.max(x - point.x, 0, point.x - x - width);
    const dy = Math.max(y - point.y, 0, point.y - y - height);
    const squared = dx * dx + dy * dy;
    if (squared <= distance) {
      distance = squared;
      nearest = choice;
    }
  }
  return nearest;
}

export function pulledChoiceRect(anchor, choices, point, held) {
  const { x, y, width, height } = anchor;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const dx = point.x - cx;
  // Only interpolate across adjacent buttons on the same visual line. Period controls wrap.
  let span = Infinity;
  for (const other of choices) {
    const distance = (other.x + other.width / 2 - cx) * Math.sign(dx);
    const overlapY = Math.min(y + height, other.y + other.height) - Math.max(y, other.y);
    const gap = distance - (width + other.width) / 2;
    if (distance > 0 && distance < span && overlapY > Math.min(height, other.height) / 2 && gap <= 16) span = distance;
  }
  let pull;
  if (Number.isFinite(span)) {
    const t = Math.min(1, Math.abs(dx) / span);
    const smooth = t * t * (3 - 2 * t);
    const magnet = held ? .24 : .76;
    pull = Math.sign(dx) * span * (t + (smooth - t) * magnet);
  } else {
    // At either end the rim yields under the pointer but stays attached to the rail.
    pull = Math.tanh(dx / (width / 2)) * Math.min(width * .25, held ? 18 : 10);
  }
  const lift = Math.tanh((point.y - cy) / (height / 2)) * (held ? 4 : 2.5);
  return { x: x + pull, y: y + lift, width, height };
}
