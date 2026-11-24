import { nearestChoice, pulledChoiceRect } from './glass-choice-layout.js';
import { createGlassMotion } from './glass-motion.js';
import { applyGlassRefraction, reducedGlassTransparency, removeGlassRefraction } from './glass-refraction.js';

const hoverPointer = matchMedia('(any-hover: hover)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

export function bindGlassChoices(group, lens, { itemSelector, activeClass, activeAttribute, optics, scrollSelection = false }) {
  const items = [...group.querySelectorAll(itemSelector)];
  const motion = createGlassMotion(lens, { liftOnPress: true });
  let selected = null, pointer = null, gesture = null, releasedAt = null;
  let frame = 0, snapToLayout = false, revealSelected = false, ignoreClick = false;

  function measure() {
    const origin = group.getBoundingClientRect();
    if (!origin.width || !origin.height) return null;
    const scaleX = origin.width / group.offsetWidth, scaleY = origin.height / group.offsetHeight;
    const local = (clientX, clientY) => ({
      x: (clientX - origin.left) / scaleX - group.clientLeft + group.scrollLeft,
      y: (clientY - origin.top) / scaleY - group.clientTop + group.scrollTop,
    });
    const choices = [];
    for (const item of items) {
      const bounds = item.getBoundingClientRect();
      if (bounds.width && bounds.height && !item.disabled) {
        choices.push({ item, ...local(bounds.left, bounds.top), width: bounds.width / scaleX, height: bounds.height / scaleY });
      }
    }
    return { choices, local };
  }

  function hitChoice(layout, client) {
    const hit = document.elementFromPoint(client.x, client.y);
    const item = hit?.closest(itemSelector);
    if (item) return layout.choices.find(choice => choice.item === item);
    // Bridge the small gap between choices, leaving dates, labels and the fold button alone.
    if (hit === group) return nearestChoice(layout.choices, layout.local(client.x, client.y), 8);
  }

  function position() {
    frame = 0;
    const layout = measure();
    let anchor, point;
    if (layout) {
      if (pointer) {
        point = layout.local(pointer.x, pointer.y);
        anchor = hitChoice(layout, pointer);
        if (gesture?.dragging && !anchor) anchor = nearestChoice(layout.choices, point);
      }
      if (!anchor) {
        point = null;
        const target = gesture?.item ?? group.querySelector(`${itemSelector}:focus-visible`) ?? selected;
        anchor = layout.choices.find(choice => choice.item === target);
      }
    }
    if (!anchor) {
      lens.hidden = true;
      motion.reset();
      removeGlassRefraction(lens);
      if (!layout) pointer = null;
      return;
    }
    const pulled = point && !reducedMotion.matches && (!gesture || gesture.canScrub);
    const rect = pulled ? pulledChoiceRect(anchor, layout.choices, point, !!gesture) : anchor;
    lens.hidden = false;
    motion.moveTo(rect, { immediate: snapToLayout, pointerX: point?.x });
    snapToLayout = false;
    motion.setPressed(!!gesture);
    lens.classList.add('is-positioned');
    // The displacement map belongs to the real button, independent of pointer position and spring scale.
    applyGlassRefraction(lens, anchor.width, anchor.height, optics);
    if (scrollSelection && revealSelected && anchor.item === selected && !gesture) {
      revealSelected = false;
      const right = anchor.x + anchor.width + 3;
      if (anchor.x < group.scrollLeft + 3) group.scrollLeft = anchor.x - 3;
      else if (right > group.scrollLeft + group.clientWidth) group.scrollLeft = right - group.clientWidth;
    }
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(position);
  }

  function syncSelection() {
    const next = items.find(item => activeAttribute ? item.getAttribute(activeAttribute) === 'true' : item.classList.contains(activeClass));
    if (selected !== next) revealSelected = true;
    selected = next;
    if (!activeAttribute) {
      for (const item of items) {
        if (item.matches('button')) item.setAttribute('aria-pressed', String(item === selected));
      }
    }
    schedule();
  }

  function trackHover(event) {
    if (gesture || !hoverPointer.matches || event.pointerType === 'touch') return;
    if (releasedAt?.x === event.clientX && releasedAt.y === event.clientY) return;
    releasedAt = null;
    pointer = { x: event.clientX, y: event.clientY };
    schedule();
  }
  function clearPointer() {
    pointer = releasedAt = null;
    schedule();
  }
  // Layout and focus changes can dispatch pointerover under a stationary mouse.
  // Only actual movement takes the rim back from the keyboard.
  group.addEventListener('pointermove', trackHover, { passive: true });
  group.addEventListener('pointerleave', () => { if (!gesture) clearPointer(); });
  group.addEventListener('focusin', event => {
    if (event.target.matches(':focus-visible') && !gesture) clearPointer();
    else schedule();
  });
  group.addEventListener('focusout', schedule);
  group.addEventListener('keydown', () => {
    if (gesture) return;
    releasedAt = pointer ?? releasedAt;
    pointer = null;
    schedule();
  });

  function drag(event) {
    if (event.pointerId !== gesture.id || !gesture.canScrub) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (!gesture.dragging && Math.hypot(pointer.x - gesture.x, pointer.y - gesture.y) >= 5) {
      gesture.dragging = true;
      gesture.item.setPointerCapture(event.pointerId);
    }
    schedule();
  }

  function finish(event) {
    if (!gesture || (event.pointerId != null && event.pointerId !== gesture.id)) return;
    const { dragging, item, id, listeners } = gesture;
    gesture = null;
    listeners.abort();
    if (item.hasPointerCapture(id)) item.releasePointerCapture(id);
    releasedAt = event.type === 'pointerup' ? { x: event.clientX, y: event.clientY } : null;
    pointer = null;
    motion.setPressed(false);
    schedule();
    // A scrub is one activation at release. Ordinary taps, links and modified clicks stay native.
    if (!dragging && releasedAt) return;
    ignoreClick = true;
    if (dragging && releasedAt) {
      const layout = measure();
      const destination = layout && hitChoice(layout, releasedAt)?.item;
      if (destination) {
        destination.focus({ preventScroll: true });
        destination.click();
      }
    }
  }

  group.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    ignoreClick = false;
    if (gesture || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const item = event.target.closest(itemSelector);
    if (!item || item.disabled) return;
    const listeners = new AbortController();
    const options = { signal: listeners.signal, capture: true };
    const canScrub = event.pointerType !== 'touch' || group.classList.contains('glass-can-scrub');
    gesture = { item, id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false, canScrub, listeners };
    pointer = { x: event.clientX, y: event.clientY };
    window.addEventListener('pointermove', drag, { ...options, passive: true });
    window.addEventListener('pointerup', finish, options);
    window.addEventListener('pointercancel', finish, options);
    item.addEventListener('lostpointercapture', lost => { if (lost.target === item) finish(lost); }, options);
    window.addEventListener('keydown', key => { if (key.key === 'Escape') finish(key); }, options);
    schedule();
  });
  group.addEventListener('dragstart', event => { if (gesture) event.preventDefault(); });
  group.addEventListener('click', event => {
    if (!ignoreClick || event.detail === 0) return;
    ignoreClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener('blur', event => { finish(event); clearPointer(); });
  hoverPointer.addEventListener('change', clearPointer);
  reducedMotion.addEventListener('change', schedule);
  reducedGlassTransparency.addEventListener('change', schedule);

  const selection = new MutationObserver(syncSelection);
  for (const item of items) selection.observe(item, { attributes: true, attributeFilter: [activeAttribute ?? 'class'] });
  // Measure the buttons, not scrollWidth, which includes the temporarily stretched rim.
  function updateLayout() {
    const fits = !scrollSelection || items.every(item => item.offsetLeft + item.offsetWidth <= group.clientWidth + 1);
    group.classList.toggle('glass-can-scrub', fits);
    snapToLayout = true;
    revealSelected = true;
    schedule();
  }
  new ResizeObserver(updateLayout).observe(group);
  document.addEventListener('scroll', event => {
    if (!pointer || (event.target !== document && event.target !== group && !event.target.contains?.(group))) return;
    snapToLayout = true;
    schedule();
  }, { capture: true, passive: true });
  updateLayout();
  syncSelection();
}
