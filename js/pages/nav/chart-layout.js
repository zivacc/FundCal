/** Shared plot geometry: every panel and the navigator share the same time pixels. */
export function chartLayout(width, height, subplotCount) {
  const left = width < 600 ? 64 : 76;
  const right = 32; // Leave room for the final YYYY-MM tick at either viewport size.
  const top = 54, bottom = 82, gap = 40;
  const available = Math.max(120, height - top - bottom - gap * subplotCount);
  const subHeight = subplotCount ? Math.min(120, available * 0.28 / subplotCount) : 0;
  const mainHeight = available - subHeight * subplotCount;
  const grids = [{ left, right, top, height: mainHeight, containLabel: false }];
  for (let i = 0; i < subplotCount; i++) {
    grids.push({ left, right, top: top + mainHeight + gap + i * (subHeight + gap), height: subHeight, containLabel: false });
  }
  return { grids, left, right, fontSize: width < 600 ? 11 : 12 };
}

/** Round linear ticks in displayed units (returns are stored as ratios). */
export function niceAxisBounds(min, max, mode = 'nav', splits = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return {};
  const toDisplay = v => mode === 'pct' ? (v - 1) * 100 : v;
  const fromDisplay = v => mode === 'pct' ? v / 100 + 1 : v;
  const lo = toDisplay(min), hi = toDisplay(max);
  const rough = Math.max(hi - lo, Math.abs(hi) * 0.01, 0.0001) / splits;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find(n => n * magnitude >= rough) || 10) * magnitude;
  const lower = Math.max(mode === 'pct' ? -100 : -Infinity, Math.floor(lo / step) * step);
  // Keep the upper endpoint on the same tick lattice after clipping at -100%.
  const upper = lower + Math.max(1, Math.ceil((hi - lower) / step)) * step;
  return { min: fromDisplay(lower), max: fromDisplay(upper), interval: mode === 'pct' ? step / 100 : step };
}
