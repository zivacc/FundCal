/** Keep the opposite endpoint fixed; crossing swaps the active endpoint's role. */
export function resizeRangeBoundary(start, end, edge, target, count) {
  if (count < 2 || ![start, end, target].every(Number.isFinite)) return null;
  const last = count - 1;
  const sIx = Math.max(0, Math.min(last - 1, Math.round(start)));
  const eIx = Math.max(sIx + 1, Math.min(last, Math.round(end)));
  const value = Math.max(0, Math.min(last, Math.round(target)));
  if (edge === 'start') return value > eIx
    ? { sIx: eIx, eIx: value, activeEdge: 'end' }
    : { sIx: Math.min(eIx - 1, value), eIx, activeEdge: 'start' };
  if (edge === 'end') return value < sIx
    ? { sIx: value, eIx: sIx, activeEdge: 'start' }
    : { sIx, eIx: Math.max(sIx + 1, value), activeEdge: 'end' };
  return null;
}
