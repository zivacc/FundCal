import { createGlassMotion } from './glass-motion.js';
import { attachGlassRim, glassCornerRadius, rimOutset } from './glass-rim.js';
import { applyGlassRefraction, removeGlassRefraction, reducedGlassTransparency } from './glass-refraction.js';

const tables = '.table, .cached-funds-table, .fund-detail-table, .fc-table, .id-table, .fd-table, .nav-stats-table, .nav-range-stats-table';
const listRows = '.basket-fund-row, .fund-stats-detail-row';
const surfaces = `${tables}, ${listRows}`;
const rows = `tbody > tr, ${listRows}`;
const controls = 'button, .btn, a, input, select, textarea, label';
const hoverPointer = matchMedia('(any-hover: hover)');
const lens = document.createElement('span');
lens.className = 'glass-hover-frame glass-table-frame';
lens.setAttribute('aria-hidden', 'true');
const optics = { rim: 6, scale: 10, outset: rimOutset, edgeOnly: true };
const motion = createGlassMotion(lens, { rim: attachGlassRim(lens, { rim: optics.rim, strength: .48 }) });
const resize = new ResizeObserver(alignToLayout);
const mutations = new MutationObserver(alignToLayout);
let rowGroup = null;
let activeRow = null;
let pointer = null;
let pressedId = null;
let frame = 0;
let snapToLayout = false;
let hoverBounds = null;

function clearTarget() {
  activeRow?.classList.remove('has-table-lens');
  activeRow = null;
  hoverBounds = null;
  if (!rowGroup) return;
  resize.disconnect();
  mutations.disconnect();
  motion.reset();
  removeGlassRefraction(lens);
  lens.remove();
  rowGroup = null;
}

function clearLens() {
  pointer = null;
  pressedId = null;
  cancelAnimationFrame(frame);
  frame = 0;
  clearTarget();
}

function updateLens() {
  frame = 0;
  if (!pointer) return;
  const hit = document.elementFromPoint(pointer.x, pointer.y);
  const row = hit?.closest(rows);
  const table = row?.cells ? row.closest('table') : null;
  if (!row || (row.cells && (!table?.matches(tables) || row.cells.length < 2))
      || row.matches('.cached-fund-row-placeholder, .cached-funds-empty, .fc-section')
      || hit.closest(controls) || document.body.classList.contains('basket-dragging')) {
    clearTarget();
    return;
  }

  // Some comparison grids select funds by column. Outline the actual actionable cell there.
  const target = hit.closest('.fund-detail-fund-cell') ?? row;
  const host = (table ?? row).parentElement;
  const group = table ?? host;
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

  if (rowGroup !== group) {
    clearTarget();
    rowGroup = group;
    resize.observe(host);
    if (table) resize.observe(table);
    mutations.observe(group, { subtree: true, childList: true });
  }
  if (lens.parentElement !== host) host.append(lens);
  if (activeRow !== row) {
    activeRow?.classList.remove('has-table-lens');
    activeRow = row;
    row.classList.add('has-table-lens');
  }
  const top = host.scrollTop + (bounds.top - viewport.top) / scaleY - host.clientTop;
  const height = bounds.height / scaleY;
  hoverBounds = { x: viewport.left + host.clientLeft * scaleX, y: viewport.top + host.clientTop * scaleY,
    scaleX, scaleY, scrollLeft: host.scrollLeft, scrollTop: host.scrollTop };
  // Joined table cells use the shared row frame. Standalone list items own their outline.
  lens.style.borderRadius = table ? '' : getComputedStyle(target).borderTopLeftRadius;
  const radius = glassCornerRadius(lens, width, height);
  applyGlassRefraction(lens, width, height, { ...optics, radius });
  motion.moveTo({ x: host.scrollLeft + left, y: top, width, height }, { immediate: snapToLayout, radius,
    pointerX: (pointer.x - hoverBounds.x) / scaleX + host.scrollLeft,
    pointerY: (pointer.y - hoverBounds.y) / scaleY + host.scrollTop });
  snapToLayout = false;
  motion.setPressed(pressedId !== null);
}

function scheduleLens() {
  if (pointer && !frame) frame = requestAnimationFrame(updateLens);
}

function alignToLayout() {
  snapToLayout = true;
  scheduleLens();
}

document.addEventListener('pointermove', event => {
  if (event.pointerId !== pressedId && (event.pointerType === 'touch' || !hoverPointer.matches)) return;
  const previousTarget = pointer?.target;
  pointer = { x: event.clientX, y: event.clientY, target: event.target };
  if (hoverBounds && event.target === previousTarget) {
    const { x, y, scaleX, scaleY, scrollLeft, scrollTop } = hoverBounds;
    motion.setPointer((pointer.x - x) / scaleX + scrollLeft, (pointer.y - y) / scaleY + scrollTop);
  }
  if (event.target !== previousTarget && (rowGroup || event.target.closest(surfaces))) scheduleLens();
}, { passive: true });

document.addEventListener('pointerout', event => {
  if (!event.relatedTarget) clearLens();
});
document.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  if (!event.target.closest(rows)?.closest(surfaces) || event.target.closest(controls)) {
    if (event.pointerType === 'touch') clearLens();
    return;
  }
  pressedId = event.pointerId;
  pointer = { x: event.clientX, y: event.clientY, target: event.target };
  scheduleLens();
}, { passive: true });
document.addEventListener('pointerup', event => {
  if (event.pointerId !== pressedId) return;
  pressedId = null;
  if (event.pointerType === 'touch') clearLens();
  else {
    motion.setPressed(false);
    scheduleLens();
  }
}, { passive: true });
document.addEventListener('pointercancel', event => { if (event.pointerId === pressedId) clearLens(); });
document.addEventListener('scroll', alignToLayout, { capture: true, passive: true });
window.addEventListener('blur', clearLens);
window.addEventListener('fundcal-route-ready', clearLens);
hoverPointer.addEventListener('change', clearLens);
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', alignToLayout);
reducedGlassTransparency.addEventListener('change', scheduleLens);
