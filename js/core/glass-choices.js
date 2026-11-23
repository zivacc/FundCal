import { createGlassMotion } from './glass-motion.js';
import { applyGlassRefraction, reducedGlassTransparency, removeGlassRefraction } from './glass-refraction.js';

const hoverPointer = matchMedia('(any-hover: hover)');

// One outline per group. A pointer or keyboard preview never changes the selected item.
export function bindGlassChoices(group, lens, { itemSelector, activeClass, optics, scrollSelection = false }) {
  const items = [...group.querySelectorAll(itemSelector)];
  const motion = createGlassMotion(lens);
  let selected = null, hovered = null, pressed = null;
  let pointerId = null, pointerX = null, pointerY = null, hoverBounds = null;
  let frame = 0, layoutChanged = false, revealSelected = false;

  function position() {
    frame = 0;
    const target = pressed ?? hovered ?? group.querySelector(`${itemSelector}:focus-visible`) ?? selected;
    const bounds = target?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) {
      lens.hidden = true;
      hovered = pressed = hoverBounds = null;
      motion.reset();
      removeGlassRefraction(lens);
      return;
    }

    const origin = group.getBoundingClientRect();
    const scaleX = origin.width / group.offsetWidth;
    const scaleY = origin.height / group.offsetHeight;
    const rect = {
      x: (bounds.left - origin.left) / scaleX - group.clientLeft + group.scrollLeft,
      y: (bounds.top - origin.top) / scaleY - group.clientTop + group.scrollTop,
      width: bounds.width / scaleX, height: bounds.height / scaleY,
    };
    hoverBounds = target === hovered ? bounds : null;
    lens.hidden = false;
    motion.highlightAt(pointerX, hoverBounds);
    motion.moveTo(rect, { immediate: layoutChanged });
    layoutChanged = false;
    lens.classList.add('is-positioned');
    applyGlassRefraction(lens, rect.width, rect.height, optics);

    if (scrollSelection && revealSelected && target === selected) {
      revealSelected = false;
      const right = rect.x + rect.width + 3;
      if (rect.x < group.scrollLeft + 3) group.scrollLeft = rect.x - 3;
      else if (right > group.scrollLeft + group.clientWidth) group.scrollLeft = right - group.clientWidth;
    }
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(position);
  }

  function syncSelection() {
    const next = items.find(item => item.classList.contains(activeClass));
    if (selected !== next) revealSelected = true;
    selected = next;
    for (const item of items) {
      if (item.matches('button')) item.setAttribute('aria-pressed', String(item === selected));
    }
    schedule();
  }

  function setHover(item) {
    if (hovered === item) return;
    hovered = item;
    hoverBounds = null;
    schedule();
  }

  function followPointer(event) {
    if (!hoverPointer.matches || event.pointerType === 'touch') return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    setHover(event.target.closest(itemSelector));
    motion.highlightAt(pointerX, hoverBounds);
  }
  group.addEventListener('pointerover', followPointer);
  group.addEventListener('pointermove', followPointer, { passive: true });
  group.addEventListener('pointerleave', () => setHover(null));
  group.addEventListener('focusin', event => {
    if (event.target.matches(':focus-visible')) setHover(null);
    schedule();
  });
  group.addEventListener('focusout', schedule);

  group.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    if (event.pointerType === 'touch') setHover(null);
    pressed = event.target.closest(itemSelector);
    if (!pressed) return;
    pointerId = event.pointerId;
    motion.setPressed(true);
    schedule();
  });

  function release(event) {
    if (!pressed || (event.pointerId != null && event.pointerId !== pointerId)) return;
    pressed = null;
    pointerId = null;
    motion.setPressed(false);
    schedule();
  }
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  window.addEventListener('blur', event => { release(event); setHover(null); });

  const selection = new MutationObserver(syncSelection);
  for (const item of items) selection.observe(item, { attributes: true, attributeFilter: ['class'] });
  new ResizeObserver(() => {
    layoutChanged = true;
    revealSelected = true;
    schedule();
  }).observe(group);
  if (scrollSelection) group.addEventListener('scroll', () => {
    if (!hovered) return;
    const hit = document.elementFromPoint(pointerX, pointerY);
    setHover(group.contains(hit) ? hit.closest(itemSelector) : null);
    layoutChanged = true;
    schedule();
  }, { passive: true });
  hoverPointer.addEventListener('change', () => setHover(null));
  reducedGlassTransparency.addEventListener('change', schedule);
  syncSelection();
}
