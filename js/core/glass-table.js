import { createGlassMotion } from './glass-motion.js';
import { applyGlassRefraction, removeGlassRefraction, reducedGlassTransparency } from './glass-refraction.js';

const tables = '.table, .cached-funds-table, .fund-detail-table, .fc-table, .id-table, .fd-table, .nav-stats-table, .nav-range-stats-table';
const hoverPointer = matchMedia('(any-hover: hover)');
const lens = document.createElement('span');
lens.className = 'glass-hover-frame glass-table-frame';
lens.setAttribute('aria-hidden', 'true');
const motion = createGlassMotion(lens);
const resize = new ResizeObserver(alignToLayout);
const mutations = new MutationObserver(alignToLayout);
let table = null;
let activeRow = null;
let pointer = null;
let frame = 0;
let snapToLayout = false;
let hoverBounds = null;

function clearTarget() {
  activeRow?.classList.remove('has-table-lens');
  activeRow = null;
  hoverBounds = null;
  if (!table) return;
  resize.disconnect();
  mutations.disconnect();
  motion.reset();
  removeGlassRefraction(lens);
  lens.remove();
  table = null;
}

function clearLens() {
  pointer = null;
  cancelAnimationFrame(frame);
  frame = 0;
  clearTarget();
}

function updateLens() {
  frame = 0;
  if (!pointer) return;
  const hit = document.elementFromPoint(pointer.x, pointer.y);
  const row = hit?.closest('tbody > tr');
  const nextTable = row?.closest('table');
  if (!nextTable?.matches(tables) || row.cells.length < 2
      || row.matches('.cached-fund-row-placeholder, .cached-funds-empty, .fc-section')
      || hit.closest('button, .btn, input, select, textarea') || document.body.classList.contains('basket-dragging')) {
    clearTarget();
    return;
  }

  // Some comparison grids select funds by column. Outline the actual actionable cell there.
  const target = hit.closest('.fund-detail-fund-cell') ?? row;
  const host = nextTable.parentElement;
  const bounds = target.getBoundingClientRect();
  const viewport = host.getBoundingClientRect();
  const scaleX = viewport.width / host.offsetWidth;
  const scaleY = viewport.height / host.offsetHeight;
  const left = Math.max(0, (bounds.left - viewport.left) / scaleX - host.clientLeft);
  const right = Math.min(host.clientWidth, (bounds.right - viewport.left) / scaleX - host.clientLeft);
  const width = right - left;
  if (width < 1 || bounds.height < 1) {
    clearTarget();
    return;
  }

  if (table !== nextTable) {
    clearTarget();
    table = nextTable;
    host.append(lens);
    resize.observe(host);
    resize.observe(table);
    mutations.observe(table, { subtree: true, childList: true });
  }
  if (activeRow !== row) {
    activeRow?.classList.remove('has-table-lens');
    activeRow = row;
    row.classList.add('has-table-lens');
  }
  const top = host.scrollTop + (bounds.top - viewport.top) / scaleY - host.clientTop;
  const height = bounds.height / scaleY;
  motion.moveTo({ x: host.scrollLeft + left, y: top, width, height }, { immediate: snapToLayout });
  snapToLayout = false;
  hoverBounds = { left: viewport.left + (host.clientLeft + left) * scaleX, width: width * scaleX };
  motion.highlightAt(pointer.x, hoverBounds);
  applyGlassRefraction(lens, width, height, { radius: 8, rim: 5, scale: 10 });
}

function scheduleLens() {
  if (pointer && !frame) frame = requestAnimationFrame(updateLens);
}

function alignToLayout() {
  snapToLayout = true;
  scheduleLens();
}

document.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch' || !hoverPointer.matches) return;
  const previousTarget = pointer?.target;
  pointer = { x: event.clientX, y: event.clientY, target: event.target };
  if (hoverBounds && event.target === previousTarget) motion.highlightAt(pointer.x, hoverBounds);
  if (event.target !== previousTarget && (table || event.target.closest(tables))) scheduleLens();
}, { passive: true });

document.addEventListener('pointerout', event => {
  if (!event.relatedTarget) clearLens();
});
document.addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch') clearLens();
}, { passive: true });
document.addEventListener('scroll', alignToLayout, { capture: true, passive: true });
window.addEventListener('blur', clearLens);
window.addEventListener('fundcal-route-ready', clearLens);
hoverPointer.addEventListener('change', clearLens);
reducedGlassTransparency.addEventListener('change', scheduleLens);
