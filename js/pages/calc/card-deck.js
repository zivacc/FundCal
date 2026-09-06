import { disposeCardImplicitFee } from './implicit-fee.js';

export function setupCardDeck() {
  const rail = document.getElementById('fund-cards');
  const stage = document.getElementById('fund-card-stage');
  const count = stage.querySelector('.deck-count');
  const prev = stage.querySelector('[data-deck-prev]');
  const next = stage.querySelector('[data-deck-next]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  function draw() {
    frame = 0;
    const cards = [...rail.children];
    const center = rail.scrollLeft + rail.clientWidth / 2;
    let closest = 0, distance = Infinity;
    cards.forEach((card, i) => {
      const delta = (card.offsetLeft - rail.offsetLeft + card.offsetWidth / 2 - center) / Math.max(rail.clientWidth, 1);
      if (Math.abs(delta) < distance) { distance = Math.abs(delta); closest = i; }
      card.style.setProperty('--deck-angle', `${reduced.matches ? 0 : Math.max(-7, Math.min(7, -delta * 10))}deg`);
    });
    cards.forEach((card, i) => card.classList.toggle('is-deck-active', i === closest));
    count.textContent = cards.length ? `${closest + 1} / ${cards.length}` : '0 / 0';
    stage.classList.toggle('is-empty', !cards.length);
    prev.disabled = rail.scrollLeft < 2;
    next.disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2;
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(draw); }
  function move(direction) {
    rail.scrollBy({ left: direction * ((rail.firstElementChild?.offsetWidth || 340) + 22), behavior: reduced.matches ? 'instant' : 'smooth' });
  }
  prev.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  rail.addEventListener('keydown', event => {
    if (event.target !== rail || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1);
  });
  rail.addEventListener('scroll', schedule, { passive: true });
  rail.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || reduced.matches || document.body.classList.contains('basket-dragging')) return;
    const card = event.target.closest('.fund-card');
    if (!card) return;
    const b = card.getBoundingClientRect();
    card.style.setProperty('--light-x', `${100 * (event.clientX - b.x) / b.width}%`);
    card.style.setProperty('--light-y', `${100 * (event.clientY - b.y) / b.height}%`);
  }, { passive: true });
  new ResizeObserver(schedule).observe(rail);
  new MutationObserver(records => {
    for (const record of records) for (const node of record.removedNodes) if (node.nodeType === 1 && !node.isConnected) disposeCardImplicitFee(node);
    schedule();
  }).observe(rail, { childList: true });
  reduced.addEventListener('change', schedule);
  window.addEventListener('fundcal-route-ready', schedule);
  schedule();
}
