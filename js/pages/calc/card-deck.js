import { disposeCardImplicitFee } from './implicit-fee.js';
import { deckPose, deckFrontCount, clampDeckIndex } from './deck-layout.js';
import { applyGlassRefraction, glassRefractionSupported, reducedGlassTransparency, removeGlassRefraction } from '../../core/glass-refraction.js';

export function setupCardDeck() {
  const rail = document.getElementById('fund-cards');
  const stage = document.getElementById('fund-card-stage');
  const count = stage.querySelector('.deck-count');
  const prev = stage.querySelector('[data-deck-prev]');
  const next = stage.querySelector('[data-deck-next]');
  const identities = document.createElement('div');
  identities.className = 'deck-card-identities';
  identities.setAttribute('aria-hidden', 'true');
  identities.hidden = true;
  stage.append(identities);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const cardSurfaces = new WeakMap();
  let cards = [], position = 0, target = 0, frame = 0, gesture = null, suppressClick = false;
  let width = 0, cardWidth = 330, cardRadius = 24, frontCount = 1, lastTime = 0;
  let lightFrame = 0, pointer = null;
  const maxIndex = () => Math.max(0, cards.length - frontCount);
  const clampPosition = value => clampDeckIndex(value, maxIndex() + 1);
  function paintIdentities(surfaces, bounds) {
    const first = surfaces.findIndex(({ card }) => card.classList.contains('is-deck-active'));
    if (first < 0) return;
    const last = surfaces.findLastIndex(({ card }) => card.classList.contains('is-deck-active'));
    const zoom = bounds.width / stage.offsetWidth;

    // 标记放在后排卡片实际露出的侧边，避免透明卡面透出另一只基金的名称。
    for (const trailing of [false, true]) {
      let covered = trailing ? surfaces[last].box.right : surfaces[first].box.left;
      const rear = trailing ? surfaces.slice(last + 1) : surfaces.slice(0, first).reverse();
      for (const { card, box } of rear) {
        const left = Math.max(box.left, trailing ? covered : bounds.left);
        const right = Math.min(box.right, trailing ? bounds.right : covered);
        covered = trailing ? Math.max(covered, box.right) : Math.min(covered, box.left);
        const exposed = right - left;
        if (exposed < 14 * zoom) continue;

        const { identity } = cardSurfaces.get(card);
        identity.textContent = card.dataset.fundCode || card.querySelector('.deck-card-open').title;
        identity.style.setProperty('--card-accent', card.style.getPropertyValue('--card-accent'));
        identity.style.left = `${((left + right) / 2 - bounds.left) / bounds.width * 100}%`;
        identity.style.top = `${(box.top - bounds.top + 31 * zoom) / bounds.height * 100}%`;
        identity.style.maxWidth = `${exposed / bounds.width * 100}%`;
        identity.classList.toggle('is-vertical', exposed < 54 * zoom);
        identity.hidden = false;
      }
    }
    identities.hidden = false;
  }
  function paintLight() {
    lightFrame = 0;
    const bounds = stage.getBoundingClientRect();
    if (!bounds.width) return;
    const x = pointer && !reduced.matches ? (pointer.x - bounds.x) / bounds.width : .42;
    const y = pointer && !reduced.matches ? (pointer.y - bounds.y) / Math.max(1, bounds.height) : .12;
    // 光源可以位于舞台之外，卡片边缘的光线角度保持在有限范围内。
    const lightDirection = Math.max(-1, Math.min(2, x));
    // 所有反射都由同一个舞台光源投射，先读取位置，再批量写入样式。
    const surfaces = cards.filter(card => card.style.visibility !== 'hidden').map(card => ({ card, box: card.getBoundingClientRect() }));
    stage.style.setProperty('--light-x', `${x * 100}%`);
    stage.style.setProperty('--light-y', `${y * 100}%`);
    stage.style.setProperty('--light-angle', `${100 + (lightDirection - .5) * 55}deg`);
    for (const { card, box } of surfaces) {
      card.style.setProperty('--reflection-x', `${(bounds.x + x * bounds.width - box.x) / Math.max(1, box.width) * 100}%`);
      card.style.setProperty('--reflection-y', `${(bounds.y + y * bounds.height - box.y) / Math.max(1, box.height) * 100}%`);
    }
    if (identities.hidden && !gesture?.dragging && position === target) paintIdentities(surfaces, bounds);
  }
  function light() { if (!lightFrame) lightFrame = requestAnimationFrame(paintLight); }
  window.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    pointer = { x: event.clientX, y: event.clientY };
    if (!reduced.matches && stage.closest('.page')?.classList.contains('active')) light();
  }, { passive: true, capture: true });
  // 页面滚动会改变舞台相对光标的位置；离开舞台/窗口时保留最后光源。
  window.addEventListener('scroll', () => {
    if (pointer && !reduced.matches && stage.closest('.page')?.classList.contains('active')) light();
  }, { passive: true });
  const resize = new ResizeObserver(entries => {
    for (const { target: card, borderBoxSize } of entries) {
      const surface = cardSurfaces.get(card);
      if (!surface) continue;
      const size = borderBoxSize?.[0];
      surface.width = size?.inlineSize ?? card.offsetWidth;
      surface.height = size?.blockSize ?? card.offsetHeight;
      surface.scale = null;
    }
    measure();
  });
  function measure() {
    width = rail.clientWidth;
    if (!width) return;
    cardWidth = cards[0]?.offsetWidth || 330;
    cardRadius = parseFloat(getComputedStyle(stage).getPropertyValue('--deck-card-radius')) || 24;
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
    for (const old of cards) {
      if (current.includes(old)) continue;
      resize.unobserve(old);
      removeGlassRefraction(old);
      cardSurfaces.get(old)?.identity.remove();
      cardSurfaces.delete(old);
      disposeCardImplicitFee(old);
    }
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
      if (!cardSurfaces.has(card)) {
        const identity = document.createElement('span');
        identity.className = 'deck-card-identity';
        identities.append(identity);
        cardSurfaces.set(card, { width: 0, height: 0, scale: null, identity });
        resize.observe(card, { box: 'border-box' });
      }
    }
    stage.classList.toggle('is-empty', !cards.length);
    measure();
  }
  function setRefraction(card, front, dragged) {
    const surface = cardSurfaces.get(card);
    if (!surface.width || !surface.height) return;
    let scale = 0;
    if (glassRefractionSupported && !reducedGlassTransparency.matches) {
      if (dragged && !reduced.matches) scale = 32;
      else if (front) scale = 22;
    }
    if (surface.scale === scale) return;
    surface.scale = scale;
    if (scale) applyGlassRefraction(card, surface.width, surface.height, { radius: cardRadius, rim: 19, scale });
    else removeGlassRefraction(card);
  }
  function draw(time) {
    frame = 0;
    identities.hidden = true;
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
      const dragged = gesture?.dragging && gesture.card === card && pose.opacity > 0;
      card.classList.toggle('is-deck-active', front);
      card.classList.toggle('is-deck-drag-surface', Boolean(dragged));
      cardSurfaces.get(card).identity.hidden = true;
      setRefraction(card, front && pose.opacity > 0, dragged);
      const open = card.querySelector('.deck-card-open');
      const name = card.querySelector('.fund-name')?.value || `基金 ${i + 1}`;
      open.hidden = front;
      if (open.title !== name) {
        open.title = name;
        open.setAttribute('aria-label', `展示 ${name}`);
      }
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
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, start: target, dragging: false, card: event.target.closest('.fund-card') };
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
    if (event.pointerType === 'touch' && !reduced.matches) pointer = { x: event.clientX, y: event.clientY };
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
  reduced.addEventListener('change', schedule);
  reducedGlassTransparency.addEventListener('change', schedule);
  window.addEventListener('fundcal-theme-change', schedule);
  window.addEventListener('fundcal-route-ready', measure);
  refresh();
}
