import { disposeCardImplicitFee } from './implicit-fee.js';
import { deckPose, deckFrontCount, clampDeckIndex } from './deck-layout.js';

export function setupCardDeck() {
  const rail = document.getElementById('fund-cards');
  const stage = document.getElementById('fund-card-stage');
  const count = stage.querySelector('.deck-count');
  const prev = stage.querySelector('[data-deck-prev]');
  const next = stage.querySelector('[data-deck-next]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let cards = [], position = 0, target = 0, frame = 0, gesture = null, suppressClick = false;
  let width = 0, cardWidth = 330, frontCount = 1, lastTime = 0;
  let lightFrame = 0, pointer = null;
  const maxIndex = () => Math.max(0, cards.length - frontCount);
  const clampPosition = value => clampDeckIndex(value, maxIndex() + 1);
  function paintLight() {
    lightFrame = 0;
    const bounds = stage.getBoundingClientRect();
    if (!bounds.width) return;
    const x = pointer && !reduced.matches ? Math.max(0, Math.min(1, (pointer.x - bounds.x) / bounds.width)) : .42;
    const y = pointer && !reduced.matches ? Math.max(0, Math.min(1, (pointer.y - bounds.y) / bounds.height)) : .12;
    // 所有反射都由同一个舞台光源投射，先读取位置，再批量写入样式。
    const surfaces = cards.filter(card => card.style.visibility !== 'hidden').map(card => ({ card, box: card.getBoundingClientRect() }));
    stage.style.setProperty('--light-x', `${x * 100}%`);
    stage.style.setProperty('--light-y', `${y * 100}%`);
    stage.style.setProperty('--light-angle', `${100 + (x - .5) * 55}deg`);
    stage.style.setProperty('--shadow-x', `${(.5 - x) * 26}px`);
    stage.style.setProperty('--shadow-y', `${22 + (.5 - y) * 12}px`);
    for (const { card, box } of surfaces) {
      card.style.setProperty('--reflection-x', `${(bounds.x + x * bounds.width - box.x) / Math.max(1, box.width) * 100}%`);
      card.style.setProperty('--reflection-y', `${(bounds.y + y * bounds.height - box.y) / Math.max(1, box.height) * 100}%`);
    }
  }
  function light() { if (!lightFrame) lightFrame = requestAnimationFrame(paintLight); }
  stage.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || reduced.matches) return;
    pointer = { x: event.clientX, y: event.clientY }; light();
  }, { passive: true });
  stage.addEventListener('pointerleave', () => { pointer = null; light(); });
  const resize = new ResizeObserver(measure);
  function measure() {
    width = rail.clientWidth;
    if (!width) return;
    cardWidth = cards[0]?.offsetWidth || 330;
    frontCount = deckFrontCount(width, cardWidth, cards.length);
    const focused = cards.findIndex(card => card.contains(document.activeElement));
    if (focused >= 0 && (focused < target || focused >= target + frontCount)) target = focused;
    target = clampPosition(target);
    position = clampPosition(position);
    rail.style.height = `${cards.length ? Math.max(...cards.map(card => card.offsetHeight)) + 94 : 96}px`;
    schedule();
  }
  function refresh() {
    const oldActive = cards[Math.round(target)];
    const current = [...rail.children];
    for (const old of cards) if (!current.includes(old)) { resize.unobserve(old); disposeCardImplicitFee(old); }
    cards = current;
    if (oldActive && cards.includes(oldActive)) target = cards.indexOf(oldActive);
    target = clampPosition(target);
    position = clampPosition(position);
    for (const card of cards) {
      if (!card.querySelector('.deck-card-open')) {
        const open = document.createElement('button');
        open.type = 'button'; open.className = 'deck-card-open';
        open.addEventListener('click', () => go(cards.indexOf(card)));
        card.append(open);
      }
      resize.observe(card);
    }
    stage.classList.toggle('is-empty', !cards.length);
    measure();
  }
  function draw(time) {
    frame = 0;
    const dt = Math.min(40, lastTime ? time - lastTime : 16); lastTime = time;
    if (reduced.matches || gesture?.dragging) position = target;
    else position += (target - position) * (1 - Math.exp(-dt / 85));
    if (Math.abs(target - position) < .002) position = target;
    const active = Math.round(target);
    cards.forEach((card, i) => {
      const pose = deckPose(i - position - (frontCount - 1) / 2, cardWidth, width, frontCount);
      card.style.transform = `translateX(-50%) translate3d(${pose.x}px, ${pose.y}px, ${pose.z}px) rotateY(${pose.angle}deg) scale(${pose.scale})`;
      card.style.opacity = pose.opacity;
      card.style.visibility = pose.opacity > 0 ? 'visible' : 'hidden';
      card.style.zIndex = String(1000 - Math.round(Math.abs(i - position) * 100));
      card.style.setProperty('--surface-light', pose.light);
      const front = i >= active && i < active + frontCount;
      card.classList.toggle('is-deck-active', front);
      const open = card.querySelector('.deck-card-open');
      open.hidden = front;
      open.setAttribute('aria-label', `展示 ${card.querySelector('.fund-name')?.value || `基金 ${i + 1}`}`);
      for (const child of card.children) if (child !== open) child.inert = !front;
    });
    count.textContent = cards.length ? `${active + 1}${frontCount > 1 ? `–${active + frontCount}` : ''} / ${cards.length}` : '0 / 0';
    rail.dataset.activeIndex = String(active);
    rail.dataset.frontCount = String(frontCount);
    prev.disabled = target <= 0;
    next.disabled = target >= maxIndex();
    light();
    if (position !== target) schedule(); else lastTime = 0;
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(draw); }
  function go(index) {
    target = clampPosition(index);
    const focus = document.activeElement;
    if (focus !== rail && rail.contains(focus) && !cards.slice(Math.round(target), Math.round(target) + frontCount).some(card => card.contains(focus))) focus.blur();
    schedule();
  }
  prev.addEventListener('click', () => go(Math.round(target) - 1));
  next.addEventListener('click', () => go(Math.round(target) + 1));
  rail.addEventListener('keydown', event => {
    if (event.target !== rail || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    go(event.key === 'Home' ? 0 : event.key === 'End' ? maxIndex() : Math.round(target) + (event.key === 'ArrowLeft' ? -1 : 1));
  });
  rail.addEventListener('wheel', event => {
    if (!maxIndex() || event.ctrlKey || event.target.closest('input,select,textarea') || document.body.classList.contains('basket-dragging')) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta || target <= 0 && delta < 0 || target >= maxIndex() && delta > 0) return;
    event.preventDefault();
    // 一次滚轮手势逐张翻入；触控板持续移动时同样保持连续空间插值。
    target = clampPosition(target + delta * (event.deltaMode === 1 ? 16 : 1) / 260);
    schedule(); clearTimeout(wheelTimer); wheelTimer = setTimeout(() => go(Math.round(target)), 140);
  }, { passive: false });
  let wheelTimer;
  rail.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !maxIndex() || document.body.classList.contains('basket-dragging')) return;
    if (event.target.closest('input,select,textarea,a,.fund-drag-handle,button:not(.deck-card-open)')) return;
    suppressClick = false;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, start: target, dragging: false };
  });
  rail.addEventListener('pointermove', event => {
    if (gesture?.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.dragging) {
      if (Math.hypot(dx, dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) { gesture = null; return; }
      gesture.dragging = true;
      rail.setPointerCapture(event.pointerId);
      stage.classList.add('is-deck-dragging');
    }
    event.preventDefault();
    target = clampPosition(gesture.start - dx / Math.max(160, cardWidth * .65));
    schedule();
  }, { passive: false });
  function finish(event, cancel = false) {
    if (gesture?.id !== event.pointerId) return;
    const previous = gesture; gesture = null;
    stage.classList.remove('is-deck-dragging');
    if (previous.dragging) { suppressClick = true; go(cancel ? Math.round(previous.start) : Math.round(target)); }
  }
  rail.addEventListener('pointerup', event => finish(event));
  rail.addEventListener('pointercancel', event => finish(event, true));
  rail.addEventListener('lostpointercapture', event => { if (event.target === rail) finish(event, true); });
  rail.addEventListener('click', event => { if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  new MutationObserver(refresh).observe(rail, { childList: true });
  resize.observe(rail);
  reduced.addEventListener('change', () => { pointer = null; schedule(); });
  window.addEventListener('fundcal-route-ready', measure);
  refresh();
}
