/** Resolve the displayed baseline without changing the saved manual date. Dates are ISO. */
export function resolveBaseline({ baseline, commonStart, viewStart, viewEnd }) {
  const original = baseline || commonStart || viewStart || null;
  const outsideView = original && ((viewStart && original < viewStart)
    || (viewEnd && original > viewEnd));
  return outsideView ? (viewStart || original) : original;
}
