import { applyGlassRefraction, reducedGlassTransparency } from './glass-refraction.js';

const rail = document.querySelector('.top-rail');
const tabs = rail.querySelector('.top-rail-tabs');
const lens = tabs.querySelector('.top-rail-lens');
const pointerLight = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
let hoveredTab = null;
let positionFrame = 0;

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
    tabs.classList.toggle('is-previewing', target !== active);
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
  if (!pointerLight.matches || reducedGlassTransparency.matches || event.pointerType !== 'mouse') return;
  const tab = event.target.closest('.top-rail-tab');
  if (tab) setHoveredTab(tab);
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

let lightFrame = 0;
function clearLight() {
  cancelAnimationFrame(lightFrame);
  rail.style.removeProperty('--rail-light-opacity');
}

rail.addEventListener('pointermove', event => {
  if (!pointerLight.matches || event.pointerType !== 'mouse') return;
  cancelAnimationFrame(lightFrame);
  lightFrame = requestAnimationFrame(() => {
    const bounds = rail.getBoundingClientRect();
    rail.style.setProperty('--rail-light-x', `${event.clientX - bounds.left}px`);
    rail.style.setProperty('--rail-light-y', `${event.clientY - bounds.top}px`);
    rail.style.setProperty('--rail-light-opacity', '.20');
  });
});
rail.addEventListener('pointerleave', clearLight);
pointerLight.addEventListener('change', () => {
  setHoveredTab(null);
  clearLight();
});
