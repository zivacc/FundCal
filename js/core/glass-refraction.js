const svgNamespace = 'http://www.w3.org/2000/svg';
const bindings = new WeakMap();
const filters = new Map();
let nextFilterId = 0;

export const reducedGlassTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
// SVG displacement can sample the live backdrop in Chromium. Other engines use the CSS rim.
export const glassRefractionSupported = navigator.userAgentData?.brands.some(({ brand }) => brand === 'Chromium') ?? false;

function displacementMap(width, height, radius, rim) {
  const canvas = document.createElement('canvas');
  const resolution = Math.min(1, 256 / Math.max(width, height));
  canvas.width = Math.ceil(width * resolution);
  canvas.height = Math.ceil(height * resolution);
  const context = canvas.getContext('2d');
  if (!context) return null;

  const image = context.createImageData(canvas.width, canvas.height);
  const stepX = width / canvas.width;
  const stepY = height / canvas.height;
  for (let row = 0; row < canvas.height; row += 1) {
    for (let column = 0; column < canvas.width; column += 1) {
      const x = (column + 0.5) * stepX;
      const y = (row + 0.5) * stepY;
      const dx = x - Math.max(radius, Math.min(x, width - radius));
      const dy = y - Math.max(radius, Math.min(y, height - radius));
      const length = Math.hypot(dx, dy);
      const depth = radius - length;
      // Displace only the rounded rim. The interior samples the backdrop in place.
      const bend = depth > 0 && depth < rim ? 0.4 * Math.sin(Math.PI * depth / rim) / length : 0;
      const pixel = (row * canvas.width + column) * 4;
      image.data[pixel] = 128 + 255 * dx * bend;
      image.data[pixel + 1] = 128 + 255 * dy * bend;
      image.data[pixel + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

function addFilter(map, scale) {
  const id = `glass-refraction-${++nextFilterId}`;
  const filter = document.createElementNS(svgNamespace, 'filter');
  filter.id = id;
  filter.setAttribute('x', '0%');
  filter.setAttribute('y', '0%');
  filter.setAttribute('width', '100%');
  filter.setAttribute('height', '100%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');

  const image = document.createElementNS(svgNamespace, 'feImage');
  image.setAttribute('href', map);
  image.setAttribute('preserveAspectRatio', 'none');
  image.setAttribute('result', 'edge-map');

  const displacement = document.createElementNS(svgNamespace, 'feDisplacementMap');
  displacement.setAttribute('in', 'SourceGraphic');
  displacement.setAttribute('in2', 'edge-map');
  displacement.setAttribute('scale', scale);
  displacement.setAttribute('xChannelSelector', 'R');
  displacement.setAttribute('yChannelSelector', 'G');
  filter.append(image, displacement);
  document.getElementById('glass-filter-definitions').append(filter);
  return filter;
}

export function removeGlassRefraction(element) {
  const record = bindings.get(element);
  if (!record) return;
  element.style.removeProperty('--glass-refraction');
  bindings.delete(element);
  record.uses -= 1;
  if (record.uses === 0) {
    record.filter.remove();
    filters.delete(record.key);
  }
}

export function applyGlassRefraction(element, width, height, { radius = Math.min(width, height) / 2, rim = 8, scale = 14 } = {}) {
  if (!glassRefractionSupported || reducedGlassTransparency.matches || width < 1 || height < 1) {
    removeGlassRefraction(element);
    return;
  }

  width = Math.round(width);
  height = Math.round(height);
  radius = Math.min(radius, width / 2, height / 2);
  rim = Math.min(rim, radius);
  const key = [width, height, radius, rim, scale].join(':');
  if (bindings.get(element)?.key === key) return;
  removeGlassRefraction(element);

  let record = filters.get(key);
  if (!record) {
    const map = displacementMap(width, height, radius, rim);
    if (!map) return;
    record = { key, filter: addFilter(map, scale), uses: 0 };
    filters.set(key, record);
  }
  record.uses += 1;
  bindings.set(element, record);
  element.style.setProperty('--glass-refraction', `url("#${record.filter.id}")`);
}
