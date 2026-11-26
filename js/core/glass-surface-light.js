// The workbench already steers its own 3D light. Other surfaces paint a
// reflection into the existing CSS border, even when the content scrolls.
const surfaces = [
  '.card', '.glass-panel', '.modal', '.modal-json-pre', '.fund-import-result-item',
  '.chart-container', '.chart-crosshair-info', '.chart-main-right', '.stage-return-chart-container',
  '.calc-days-row', '.cf-sidebar', '.list-basket-pool', '#fund-basket-panel',
  '.fund-stats-summary-card', '.fund-stats-card', '.fund-stats-detail-card', '.fd-empty', '.fd-card', '.fd-raw-body',
  '.index-picker-index-card', '.index-picker-index-list', '.index-picker-fund-list', '.index-page-search-hero',
  '.index-page-panel', '.ix-hero', '.id-empty', '.id-card', '.id-turnover-grid article', '.id-weight-summary div',
  '.fc-toolbar', '.fc-empty', '.nav-controls', '.nav-chart-wrap', '.nav-chart-header', '.nav-range-stats-panel',
  '.nav-baseline-panel', '.nav-range-control-panel', '.nav-fs-panel', '.table-container',
  '.modal-json-table', '.segments-table', '.cached-funds-table-wrap', '.fund-detail-table-wrap',
  '.fc-table-wrap', '.id-table-wrap', '.fd-table-wrap', '.nav-stats-table-wrap', '.nav-range-stats-table-wrap',
].join(',');

function trackSurfaceLight() {
  const enabled = matchMedia('(any-hover: hover) and (prefers-reduced-motion: no-preference) and (forced-colors: none)');
  const reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
  let lit = [], point, frame = 0;

  function update(next) {
    for (const node of lit) {
      if (!next.includes(node)) {
        node.classList.remove('surface-lit');
        node.style.removeProperty('--surface-light-at');
      }
    }
    for (const node of next) {
      if (!lit.includes(node)) node.classList.add('surface-lit');
    }
    lit = next;
  }
  function paint() {
    frame = 0;
    const hit = document.elementFromPoint(point.x, point.y);
    const next = [];
    for (let node = hit?.closest(surfaces); node; node = node.parentElement?.closest(surfaces)) next.push(node);
    const bounds = next.map(node => node.getBoundingClientRect());
    update(next);
    next.forEach((node, i) => {
      const rect = bounds[i];
      const x = (point.x - rect.left) / rect.width * 100;
      const y = (point.y - rect.top) / rect.height * 100;
      node.style.setProperty('--surface-light-at', `${x.toFixed(1)}% ${y.toFixed(1)}%`);
    });
  }
  function clear() {
    cancelAnimationFrame(frame);
    frame = 0;
    point = null;
    update([]);
  }
  function schedule() {
    if (point && !frame) frame = requestAnimationFrame(paint);
  }
  document.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || !enabled.matches || reducedTransparency.matches) {
      if (point) clear();
      return;
    }
    point = { x: event.clientX, y: event.clientY };
    schedule();
  }, { passive: true });
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) clear(); });
  document.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('blur', clear);
  window.addEventListener('fundcal-route-ready', clear);
  enabled.addEventListener('change', clear);
  reducedTransparency.addEventListener('change', clear);
}
trackSurfaceLight();
