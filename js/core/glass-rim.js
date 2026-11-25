import { createGlassContour } from './glass-contour.js';
import { glassApertureInset, glassLightDirection } from './glass-optics.js';
import { setGlassLight } from './glass-refraction.js';

const svgNamespace = 'http://www.w3.org/2000/svg';
const edgeInset = 1.7;
export const rimOutset = 5;
let instance = 0;

// Project the incident light onto the rounded lip. The lit patch stays short
// even on long table rows and moves with the pointer on all four sides.
function reflectionPoint(width, height, radius, inset, px, py, light) {
  const hx = Math.max(.1, width / 2 - inset), hy = Math.max(.1, height / 2 - inset);
  const r = Math.max(0, Math.min(hx, hy, radius - inset));
  const dx = (px ?? 0) * .72 + light.x * .48, dy = (py ?? 0) * .72 + light.y * .48;
  const extent = Math.max(.001, Math.abs(dx), Math.abs(dy));
  const x = hx * dx / extent, y = hy * dy / extent;
  const cx = Math.max(-hx + r, Math.min(x, hx - r)), cy = Math.max(-hy + r, Math.min(y, hy - r));
  const distance = Math.hypot(x - cx, y - cy) || 1;
  return { x: width / 2 + cx + r * (x - cx) / distance, y: height / 2 + cy + r * (y - cy) / distance };
}

export function attachGlassRim(host, { radius = Infinity, strength = 1, rim = 8, optical = false } = {}) {
  const contour = createGlassContour();
  const id = `glass-rim-${++instance}`;
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('class', 'glass-contour');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.innerHTML = `<defs>
    <path id="${id}-edge" class="glass-contour-outline"/>
    <path id="${id}-opening" class="glass-aperture-outline"/>
    <clipPath id="${id}-silhouette"><use href="#${id}-edge"/></clipPath>
    ${optical
      ? `<clipPath id="${id}-aperture"><use href="#${id}-opening" transform="translate(${rimOutset} ${rimOutset})"/></clipPath>`
      : `<clipPath id="${id}-band"><path clip-rule="evenodd" transform="translate(${rimOutset} ${rimOutset})"/></clipPath>`}
    <linearGradient id="${id}-light" gradientUnits="userSpaceOnUse">
      <stop class="rim-glint" offset="0"/><stop class="rim-silver" offset=".14"/>
      <stop class="rim-depth" offset=".38"/><stop class="rim-depth" stop-opacity=".34" offset=".60"/>
      <stop class="rim-silver" offset=".83"/><stop class="rim-pearl" offset="1"/>
    </linearGradient>
    <radialGradient id="${id}-reflection" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#b2e1e8" stop-opacity=".8"/>
      <stop offset=".28" stop-color="#8dc5df" stop-opacity=".65"/>
      <stop offset=".62" stop-color="#aaa3c8" stop-opacity=".43"/>
      <stop offset=".80" stop-color="#c7ac98" stop-opacity=".24"/>
      <stop offset="1" stop-color="#c7ac98" stop-opacity="0"/>
    </radialGradient>
    <filter id="${id}-feather" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="2.2"/>
    </filter>
  </defs>
  <g clip-path="url(#${id}-silhouette)">
    <use class="rim-reflection" href="#${id}-opening" fill="none" stroke="url(#${id}-reflection)"
      stroke-width="2.6" filter="url(#${id}-feather)" opacity="0"/>
  </g>
  <use class="rim-shine-line" href="#${id}-edge" fill="${optical ? '#fff' : 'none'}"
    stroke="url(#${id}-light)" clip-path="url(#${id}-silhouette)"/>`;
  const edge = svg.querySelector('.glass-contour-outline');
  const opening = svg.querySelector('.glass-aperture-outline');
  const band = svg.querySelector('clipPath path');
  const shine = svg.querySelector('.rim-shine-line');
  const reflection = svg.querySelector('.rim-reflection');
  const gradient = svg.querySelector('linearGradient');
  const spot = svg.querySelector('radialGradient');
  const feather = svg.getElementById(`${id}-feather`);
  host.append(svg);
  host.style.setProperty('--rim-outset', `${rimOutset}px`);
  host.style.setProperty('--glass-silhouette', `url("#${id}-silhouette")`);
  if (optical) host.style.setProperty('--lens-aperture', `url("#${id}-aperture")`);
  else host.style.setProperty('--rim-clip', `url("#${id}-band")`);
  host.classList.add('has-glass-contour', optical ? 'has-optical-lens' : 'has-glass-edge');
  let lastEdge, lastLight, lastSpot, lastIntensity, lastReflection;

  function paint(width, height, seconds, {
    velocityX, velocityY, pointerX, pointerY, pressure, hovered = pointerX != null || pointerY != null, radius: shapeRadius = radius,
  }, snap = false) {
    if (width < 2 || height < 2) return false;
    if (snap) contour.reset();
    const moving = !snap && contour.step(seconds, {
      velocityX: velocityX * strength, velocityY: velocityY * strength,
      pointerX: (pointerX ?? 0) * strength, pointerY: (pointerY ?? 0) * strength, pressure: pressure * strength,
    });
    const outline = contour.path(width, height, shapeRadius, edgeInset);
    if (outline !== lastEdge) {
      lastEdge = outline;
      const aperture = contour.path(width, height, shapeRadius, glassApertureInset);
      edge.setAttribute('d', outline);
      opening.setAttribute('d', aperture);
      if (band) band.setAttribute('d', aperture + contour.path(width, height, shapeRadius, Math.max(rim, glassApertureInset + 1)));
    }

    const light = glassLightDirection(pointerX, pointerY);
    const corner = Math.min(width / 2, height / 2, shapeRadius);
    const reach = corner + Math.abs(light.x) * (width / 2 - corner) + Math.abs(light.y) * (height / 2 - corner) - edgeInset;
    const dx = light.x * reach, dy = light.y * reach;
    const x1 = (width / 2 + dx).toFixed(1), y1 = (height / 2 + dy).toFixed(1);
    const x2 = (width / 2 - dx).toFixed(1), y2 = (height / 2 - dy).toFixed(1);
    const lightKey = `${x1} ${y1} ${x2} ${y2}`;
    if (lightKey !== lastLight) {
      lastLight = lightKey;
      gradient.setAttribute('x1', x1);
      gradient.setAttribute('y1', y1);
      gradient.setAttribute('x2', x2);
      gradient.setAttribute('y2', y2);
    }
    const load = Math.min(1, Math.hypot(velocityX, velocityY) / 850 + pressure * .65);
    const reflectionAlpha = Math.min(.55, (hovered ? .30 : 0) + load * .32).toFixed(2);
    if (reflectionAlpha !== lastReflection) {
      lastReflection = reflectionAlpha;
      reflection.setAttribute('opacity', reflectionAlpha);
    }
    if (hovered || load > 0) {
      const position = reflectionPoint(width, height, corner, glassApertureInset + 1, pointerX, pointerY, light);
      const cx = position.x.toFixed(1), cy = position.y.toFixed(1);
      const r = Math.min(52, Math.min(width, height) * .47).toFixed(1);
      const key = `${cx} ${cy} ${r}`;
      if (key !== lastSpot) {
        lastSpot = key;
        spot.setAttribute('cx', cx);
        spot.setAttribute('cy', cy);
        spot.setAttribute('r', r);
        // Feather only this short glint. The final silhouette clips it, and
        // the page pixels and the optical displacement never pass through this filter.
        const padding = Number(r) + 8;
        feather.setAttribute('x', (position.x - padding).toFixed(1));
        feather.setAttribute('y', (position.y - padding).toFixed(1));
        feather.setAttribute('width', 2 * padding);
        feather.setAttribute('height', 2 * padding);
      }
    }
    setGlassLight(host, pointerX, pointerY, Math.min(1, (hovered ? .70 : .46) + load * .6));
    const intensity = (1.45 + load * .55).toFixed(2);
    if (lastIntensity !== intensity) {
      lastIntensity = intensity;
      shine.setAttribute('stroke-width', intensity);
      if (optical) shine.setAttribute('fill-opacity', (.02 + load * .085).toFixed(3));
    }
    return moving;
  }
  return { paint, reset: contour.reset };
}
