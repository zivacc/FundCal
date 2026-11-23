import { reducedGlassTransparency } from './glass-refraction.js';

const tables = '.table, .cached-funds-table, .fund-detail-table, .fc-table, .id-table, .fd-table, .nav-stats-table, .nav-range-stats-table';
const pointerLens = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
let pointer = null;
let activeRow = null;
let frame = 0;

function clearRow() {
  activeRow?.classList.remove('has-table-lens');
  activeRow?.style.removeProperty('--table-lens-x');
  activeRow = null;
}

function clearLens() {
  pointer = null;
  cancelAnimationFrame(frame);
  frame = 0;
  clearRow();
}

function updateLens() {
  frame = 0;
  if (!pointer) return;
  const { x, y } = pointer;
  // Recheck the cell under a stationary cursor when the table or page scrolls.
  const row = document.elementFromPoint(x, y)?.closest('tbody > tr');
  if (!row?.closest(tables) || row.cells.length < 2
      || row.matches('.cached-fund-row-placeholder, .fc-section')
      || document.body.classList.contains('basket-dragging')) {
    clearRow();
    return;
  }
  if (activeRow !== row) {
    clearRow();
    activeRow = row;
  }
  row.style.setProperty('--table-lens-x', `${x - row.getBoundingClientRect().left}px`);
  row.classList.add('has-table-lens');
}

function scheduleLens() {
  if (pointer && !frame) frame = requestAnimationFrame(updateLens);
}

document.addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse' || !pointerLens.matches || reducedGlassTransparency.matches) return;
  pointer = { x: event.clientX, y: event.clientY };
  if (activeRow || event.target.closest(tables)) scheduleLens();
}, { passive: true });

document.addEventListener('pointerout', event => {
  if (!event.relatedTarget) clearLens();
});
document.addEventListener('scroll', scheduleLens, { capture: true, passive: true });
window.addEventListener('blur', clearLens);
window.addEventListener('fundcal-route-ready', clearLens);
pointerLens.addEventListener('change', clearLens);
reducedGlassTransparency.addEventListener('change', clearLens);
