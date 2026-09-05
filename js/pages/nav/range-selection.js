/** Resize one endpoint without moving the other or allowing an empty/inverted range. */
export function resizeRangeBoundary(start, end, edge, target, count) {
  if (count < 2 || ![start, end, target].every(Number.isFinite)) return null;
  const last = count - 1;
  const sIx = Math.max(0, Math.min(last - 1, Math.round(start)));
  const eIx = Math.max(sIx + 1, Math.min(last, Math.round(end)));
  if (edge === 'start') return { sIx: Math.max(0, Math.min(eIx - 1, Math.round(target))), eIx };
  if (edge === 'end') return { sIx, eIx: Math.max(sIx + 1, Math.min(last, Math.round(target))) };
  return null;
}
