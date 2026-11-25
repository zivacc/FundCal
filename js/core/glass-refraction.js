import { createGlassField, glassLightMatrices } from './glass-optics.js';

const svgNamespace = 'http://www.w3.org/2000/svg';
const bindings = new WeakMap();
const sharedRims = new Map();
const lensMaps = new Map();
let nextFilterId = 0;

export const reducedGlassTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
// SVG displacement can sample the live backdrop in Chromium; other engines can filter a foreground.
export const glassRefractionSupported = navigator.userAgentData?.brands.some(({ brand }) => brand === 'Chromium') ?? false;

function encodeMaps(width, height, radius, rim, scale, outset, magnification, density) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  const field = createGlassField(width, height, radius, rim, scale, outset, magnification, density);
  canvas.width = field.width;
  canvas.height = field.height;
  function encode(bytes) {
    context.putImageData(new ImageData(bytes, field.width, field.height), 0, 0);
    return canvas.toDataURL();
  }
  return { refraction: encode(field.refraction), dispersion: field.dispersion && encode(field.dispersion), range: field.range };
}

function primitive(parent, type, attributes) {
  const node = document.createElementNS(svgNamespace, type);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  parent.append(node);
  return node;
}

function displace(filter, source, map, scale, result) {
  primitive(filter, 'feDisplacementMap', {
    in: source, in2: map, scale, xChannelSelector: 'R', yChannelSelector: 'G', result,
  });
}

function addFilter(maps) {
  const filter = document.createElementNS(svgNamespace, 'filter');
  filter.id = `glass-refraction-${++nextFilterId}`;
  filter.setAttribute('x', '0%');
  filter.setAttribute('y', '0%');
  filter.setAttribute('width', '100%');
  filter.setAttribute('height', '100%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  primitive(filter, 'feImage', { href: maps.refraction, preserveAspectRatio: 'none', result: 'surface' });
  const record = { filter, uses: 0 };
  if (maps.dispersion) {
    record.range = maps.range;
    record.bend = primitive(filter, 'feColorMatrix', { in: 'surface', type: 'matrix', result: 'lit-surface' });
    displace(filter, 'SourceGraphic', 'lit-surface', maps.range, 'bent');
    primitive(filter, 'feImage', { href: maps.dispersion, preserveAspectRatio: 'none', result: 'normals' });
    record.color = primitive(filter, 'feColorMatrix', { in: 'normals', type: 'matrix', result: 'lit-edge' });
    displace(filter, 'bent', 'lit-edge', 2.8, 'red-rays');
    displace(filter, 'bent', 'lit-edge', -2.8, 'blue-rays');
    // Reassemble the three samples, retaining the original refracted alpha for
    // translucent foreground glyphs. All channel filters work in sRGB.
    for (const [channel, input] of ['red-rays', 'bent', 'blue-rays'].entries()) {
      const values = new Array(20).fill(0);
      values[channel * 6] = 1;
      values[19] = 1;
      primitive(filter, 'feColorMatrix', { in: input, values: values.join(' '), result: `channel-${channel}` });
    }
    primitive(filter, 'feComposite', { in: 'channel-0', in2: 'channel-1', operator: 'arithmetic', k2: 1, k3: 1, result: 'rg' });
    primitive(filter, 'feComposite', { in: 'rg', in2: 'channel-2', operator: 'arithmetic', k2: 1, k3: 1, result: 'rgb' });
    primitive(filter, 'feComposite', { in: 'rgb', in2: 'bent', operator: 'in' });
    steer(record, null, null);
  } else {
    displace(filter, 'SourceGraphic', 'surface', maps.range, 'bent');
  }
  document.getElementById('glass-filter-definitions').append(filter);
  return record;
}

function steer(record, x, y) {
  const nx = x == null ? null : Math.round(Math.max(-1, Math.min(1, x)) * 48) / 48;
  const ny = y == null ? null : Math.round(Math.max(-1, Math.min(1, y)) * 48) / 48;
  if (record.x === nx && record.y === ny) return;
  record.x = nx;
  record.y = ny;
  const { bend, color } = glassLightMatrices(nx, ny, record.range);
  record.bend.setAttribute('values', bend.join(' '));
  record.color.setAttribute('values', color.join(' '));
}

export function setGlassLight(element, x, y) {
  const record = bindings.get(element);
  if (record?.bend) steer(record, x, y);
}

export function removeGlassRefraction(element) {
  const record = bindings.get(element);
  if (!record) return;
  element.style.removeProperty('--glass-refraction');
  bindings.delete(element);
  record.uses -= 1;
  if (record.uses === 0) {
    record.filter.remove();
    if (!record.bend) sharedRims.delete(record.key);
  }
}

export function applyGlassRefraction(element, width, height, {
  radius = Math.min(width, height) / 2, rim = 8, scale = 14, outset = 0,
  magnification = 1, foreground = false,
} = {}) {
  if ((!glassRefractionSupported && !foreground) || reducedGlassTransparency.matches || width < 1 || height < 1) {
    removeGlassRefraction(element);
    return;
  }
  width = Math.round(width);
  height = Math.round(height);
  radius = Math.min(radius, width / 2, height / 2);
  rim = Math.min(rim, radius);
  const density = magnification > 1 ? Math.min(2, Math.max(1, devicePixelRatio)) : 1;
  const key = [width, height, radius, rim, scale, outset, magnification, density].join(':');
  if (bindings.get(element)?.key === key) return;
  removeGlassRefraction(element);

  let record = sharedRims.get(key);
  if (!record) {
    let maps = lensMaps.get(key);
    if (!maps) {
      maps = encodeMaps(width, height, radius, rim, scale, outset, magnification, density);
      if (!maps) return;
      if (maps.dispersion) {
        if (lensMaps.size >= 24) lensMaps.delete(lensMaps.keys().next().value);
        lensMaps.set(key, maps);
      }
    }
    record = addFilter(maps);
    record.key = key;
    if (!record.bend) sharedRims.set(key, record);
  }
  record.uses += 1;
  bindings.set(element, record);
  element.style.setProperty('--glass-refraction', `url("#${record.filter.id}")`);
}
