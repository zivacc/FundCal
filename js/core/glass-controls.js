import { bindGlassChoices } from './glass-choices.js';
import { createGlassMotion } from './glass-motion.js';
import { attachGlassRim, rimOutset } from './glass-rim.js';
import { applyGlassRefraction, reducedGlassTransparency, removeGlassRefraction } from './glass-refraction.js';

const groups = [
  ['.fund-stats-toggle', '.fund-stats-toggle-btn', { activeAttribute: 'aria-selected' }],
  ['#index-page-period-wrap', '.index-page-period-btn', { activeClass: 'index-page-period-btn-active' }],
  ['#fd-nav-period-group', '.fd-nav-period-btn', { activeClass: 'fd-nav-period-btn-active' }],
  ['#id-periods', 'button[data-period]', { activeAttribute: 'aria-pressed' }],
];
const choiceItems = new WeakSet();
function bindPageChoices() {
  const page = document.querySelector('.page.active');
  for (const [selector, itemSelector, selection] of groups) {
    const group = page?.querySelector(selector);
    if (!group || group.classList.contains('glass-control-choices')) continue;
    const lens = document.createElement('span');
    lens.hidden = true;
    lens.className = 'glass-hover-frame control-choice-lens';
    lens.setAttribute('aria-hidden', 'true');
    group.classList.add('glass-control-choices');
    group.append(lens);
    for (const item of group.querySelectorAll(itemSelector)) choiceItems.add(item);
    bindGlassChoices(group, lens, { itemSelector, ...selection, optics: { rim: 6, scale: 13 } });
  }
}

// One edge surface follows the deepest actionable target. It lives in the same
// scrolling and stacking context as that target, including controls inside dialogs.
const controls = [
  'button', '.btn', 'select', 'textarea', 'input', '.toggle-btn', '[role="button"]', '[role="option"]',
  'summary', 'th[data-sort-key]',
  '.page-header-link', '.index-picker-index-item', '.index-picker-fund-item', '.chart-fund-list-item',
].join(',');
const excluded = [
  ':disabled', '[aria-disabled="true"]', '.fund-drag-handle', '.nav-period-btn', '.nav-toggle-btn', '.nav-fs-tab',
  '.deck-card-open', '[data-basket-drop]', '#basket-drop-target', '#basket-fund-choices button',
  'input[type="hidden"]', 'input[type="file"]', 'input[type="range"]', 'input[type="radio"]', 'input[type="checkbox"]',
].join(',');
const hoverPointer = matchMedia('(any-hover: hover)');
const rim = document.createElement('span');
rim.className = 'glass-hover-frame control-edge-lens';
rim.setAttribute('aria-hidden', 'true');
rim.inert = true;
const rimWidth = 7;
const motion = createGlassMotion(rim, { rim: attachGlassRim(rim, { strength: .65, rim: rimWidth }) });
const resize = new ResizeObserver(schedule);
const changes = new MutationObserver(schedule);
let active = null, mount = null, pointer = null, pressed = null, frame = 0;

function releaseSurface() {
  if (!active) return;
  resize.disconnect();
  changes.disconnect();
  motion.reset();
  removeGlassRefraction(rim);
  rim.remove();
  active.classList.remove('has-control-edge');
  mount.classList.remove('glass-control-anchor');
  active = mount = null;
}

// Keep decorations out of button text, card children and native inputs. A local
// scrolling container clips the sibling just as it clips the real control.
function anchorFor(item) {
  const position = getComputedStyle(item).position;
  if (position !== 'fixed') {
    const offsetParent = item.offsetParent;
    for (let node = item.parentElement; node && node !== document.body; node = node.parentElement) {
      // A static cell may be reported as offsetParent without establishing an
      // absolute containing block. Mount table controls in their scroll host.
      if (node.matches('td, th, tr, thead, tbody, tfoot, table')) continue;
      const style = getComputedStyle(node);
      if (node === offsetParent || style.position !== 'static') return node;
      if (position !== 'absolute' && (style.overflowX !== 'visible' || style.overflowY !== 'visible')) {
        if (style.position === 'static') node.classList.add('glass-control-anchor');
        return node;
      }
    }
  }
  return document.body;
}

function targetAt(element) {
  const item = element?.closest?.('.toggle-btn-input')?.closest('.toggle-btn') ?? element?.closest?.(controls);
  if (!item || item.matches(excluded) || choiceItems.has(item) || item.closest('.top-rail-tabs')) return null;
  return item;
}

function paint() {
  frame = 0;
  const item = pointer && !document.body.classList.contains('basket-dragging')
    ? targetAt(document.elementFromPoint(pointer.x, pointer.y)) : null;
  if (!item || (pointer.touch && pressed !== item)) { releaseSurface(); return; }
  const changed = active !== item;
  if (changed || rim.parentElement !== mount) {
    releaseSurface();
    active = item;
    mount = anchorFor(item);
    rim.style.position = mount === document.body ? 'fixed' : 'absolute';
    rim.style.zIndex = String(Math.max(2, (parseInt(getComputedStyle(item).zIndex, 10) || 0) + 1));
    active.classList.add('has-control-edge');
    mount.insertBefore(rim, mount.lastElementChild);
    resize.observe(active);
    resize.observe(mount);
    changes.observe(item.parentElement, { childList: true });
    changes.observe(item, { attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'hidden', 'inert'] });
  }
  const box = active.getBoundingClientRect();
  const host = mount === document.body
    ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : mount.getBoundingClientRect();
  if (!host.width || !host.height || box.width < 8 || box.height < 8) { releaseSurface(); return; }
  const sx = mount === document.body ? 1 : mount.offsetWidth / host.width;
  const sy = mount === document.body ? 1 : mount.offsetHeight / host.height;
  const left = mount.scrollLeft - mount.clientLeft, top = mount.scrollTop - mount.clientTop;
  const width = box.width * sx, height = box.height * sy;
  const cssRadius = getComputedStyle(active).borderTopLeftRadius;
  const radius = Math.min(width / 2, height / 2, parseFloat(cssRadius) *
    (cssRadius.endsWith('%') ? Math.min(width, height) / 100 : 1));
  rim.style.borderRadius = `${radius}px`;
  applyGlassRefraction(rim, width, height, { radius, rim: rimWidth, scale: 12, outset: rimOutset, edgeOnly: true });
  motion.moveTo({ x: (box.left - host.left) * sx + left, y: (box.top - host.top) * sy + top, width, height },
    { immediate: changed, radius, pointerX: (pointer.x - host.left) * sx + left, pointerY: (pointer.y - host.top) * sy + top });
  motion.setPressed(pressed === active);
}

function schedule() {
  if (pointer && !frame) frame = requestAnimationFrame(paint);
}
function clear() {
  pointer = pressed = null;
  cancelAnimationFrame(frame);
  frame = 0;
  releaseSurface();
}
function track(event) {
  if (!event.isPrimary || (event.pointerType === 'touch' ? !pressed : !hoverPointer.matches && !pressed)) return;
  if (!targetAt(event.target) && !pressed) {
    if (pointer) clear();
    return;
  }
  pointer = { x: event.clientX, y: event.clientY, touch: event.pointerType === 'touch' };
  schedule();
}

document.addEventListener('pointerover', track, { passive: true });
document.addEventListener('pointermove', track, { passive: true });
document.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  pressed = targetAt(event.target);
  track(event);
}, { capture: true, passive: true });
window.addEventListener('pointerup', event => {
  if (!event.isPrimary) return;
  pressed = null;
  if (event.pointerType === 'touch') clear(); else track(event);
}, { capture: true, passive: true });
window.addEventListener('pointercancel', clear);
document.addEventListener('pointerout', event => { if (!event.relatedTarget) clear(); });
document.addEventListener('keydown', clear);
document.addEventListener('scroll', schedule, { passive: true, capture: true });
window.addEventListener('resize', schedule);
window.addEventListener('blur', clear);
window.addEventListener('fundcal-route-ready', () => { clear(); bindPageChoices(); });
reducedGlassTransparency.addEventListener('change', schedule);
bindPageChoices();
