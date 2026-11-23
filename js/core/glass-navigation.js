const rail = document.querySelector('.top-rail');
const tabs = rail.querySelector('.top-rail-tabs');
const lens = tabs.querySelector('.top-rail-lens');
const displacementImage = document.querySelector('#nav-refraction feImage');
const reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)');

// Chromium can sample a live backdrop with an SVG displacement map.
const canRefract = navigator.userAgentData?.brands.some(({ brand }) => brand === 'Chromium');
let lastLensSize = '';

function updateRefraction(width, height) {
  if (!canRefract || reducedTransparency.matches) {
    lens.style.removeProperty('--lens-refraction');
    lastLensSize = '';
    return;
  }

  const size = `${width}:${height}`;
  if (lastLensSize === size) return;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;

  // The displacement follows the nearest capsule edge, fading to zero inside the lens.
  const image = context.createImageData(width, height);
  const radius = height / 2;
  const rim = Math.min(9, radius);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x + 0.5 - Math.max(radius, Math.min(x + 0.5, width - radius));
      const dy = y + 0.5 - radius;
      const length = Math.hypot(dx, dy);
      const depth = radius - length;
      const distortion = depth > 0 && depth < rim ? 0.4 * Math.sin(Math.PI * depth / rim) / length : 0;
      const pixel = (y * width + x) * 4;
      image.data[pixel] = 128 + 255 * dx * distortion;
      image.data[pixel + 1] = 128 + 255 * dy * distortion;
      image.data[pixel + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  displacementImage.setAttribute('href', canvas.toDataURL());
  lens.style.setProperty('--lens-refraction', 'url("#nav-refraction")');
  lastLensSize = size;
}

let positionFrame = 0;
function schedulePosition() {
  if (positionFrame) return;
  positionFrame = requestAnimationFrame(() => {
    positionFrame = 0;
    const active = tabs.querySelector('[aria-selected="true"]');
    if (!active) return;

    const width = active.offsetWidth;
    const height = active.offsetHeight;
    if (!width || !height) return;

    const left = active.offsetLeft;
    const trailingEdge = left + width + 3;
    lens.style.setProperty('--lens-width', `${width}px`);
    lens.style.setProperty('--lens-offset', `${left}px`);
    lens.classList.add('is-positioned');
    updateRefraction(width, height);

    if (left < tabs.scrollLeft + 3) tabs.scrollLeft = left - 3;
    else if (trailingEdge > tabs.scrollLeft + tabs.clientWidth) {
      tabs.scrollLeft = trailingEdge - tabs.clientWidth;
    }
  });
}

new MutationObserver(schedulePosition).observe(tabs, {
  subtree: true,
  attributes: true,
  attributeFilter: ['aria-selected'],
});
new ResizeObserver(schedulePosition).observe(tabs);
reducedTransparency.addEventListener('change', schedulePosition);

const pointerLight = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
let lightFrame = 0;
rail.addEventListener('pointermove', event => {
  if (!pointerLight.matches || event.pointerType !== 'mouse') return;
  cancelAnimationFrame(lightFrame);
  lightFrame = requestAnimationFrame(() => {
    const bounds = rail.getBoundingClientRect();
    rail.style.setProperty('--rail-light-x', `${event.clientX - bounds.left}px`);
    rail.style.setProperty('--rail-light-y', `${event.clientY - bounds.top}px`);
    rail.style.setProperty('--rail-light-opacity', '.34');
  });
});
rail.addEventListener('pointerleave', () => {
  cancelAnimationFrame(lightFrame);
  rail.style.removeProperty('--rail-light-opacity');
});
