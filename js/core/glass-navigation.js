import { applyGlassRefraction, reducedGlassTransparency } from './glass-refraction.js';

const rail = document.querySelector('.top-rail');
const tabs = rail.querySelector('.top-rail-tabs');
const lens = tabs.querySelector('.top-rail-lens');
const hoverPointer = matchMedia('(hover: hover) and (pointer: fine)');
let hoveredTab = null;
let positionFrame = 0;

// Keep navigation labels legible as data rows scroll underneath.
function syncScrollSurface() {
  rail.classList.toggle('is-scrolled', window.scrollY > 8);
}
window.addEventListener('scroll', syncScrollSurface, { passive: true });
syncScrollSurface();

function schedulePosition() {
  if (positionFrame) return;
  positionFrame = requestAnimationFrame(() => {
    positionFrame = 0;
    const active = tabs.querySelector('[aria-selected="true"]');
    if (!active?.offsetWidth) return;

    const target = hoveredTab ?? active;
    lens.style.setProperty('--lens-width', `${target.offsetWidth}px`);
    lens.style.setProperty('--lens-offset', `${target.offsetLeft}px`);
    lens.classList.add('is-positioned');
    applyGlassRefraction(lens, target.offsetWidth, target.offsetHeight, { scale: 19 });

    if (hoveredTab) return;
    const left = active.offsetLeft;
    const trailingEdge = left + active.offsetWidth + 3;
    if (left < tabs.scrollLeft + 3) tabs.scrollLeft = left - 3;
    else if (trailingEdge > tabs.scrollLeft + tabs.clientWidth) {
      tabs.scrollLeft = trailingEdge - tabs.clientWidth;
    }
  });
}

function setHoveredTab(tab) {
  if (hoveredTab === tab) return;
  hoveredTab = tab;
  schedulePosition();
}

tabs.addEventListener('pointerover', event => {
  if (!hoverPointer.matches || event.pointerType !== 'mouse') return;
  const tab = event.target.closest('.top-rail-tab');
  setHoveredTab(tab);
});
tabs.addEventListener('pointerleave', () => setHoveredTab(null));

new MutationObserver(schedulePosition).observe(tabs, {
  subtree: true,
  attributes: true,
  attributeFilter: ['aria-selected'],
});
new ResizeObserver(schedulePosition).observe(tabs);
reducedGlassTransparency.addEventListener('change', () => {
  setHoveredTab(null);
  schedulePosition();
});

hoverPointer.addEventListener('change', () => setHoveredTab(null));
