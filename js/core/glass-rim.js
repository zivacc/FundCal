import { createGlassContour } from './glass-contour.js';
import { glassApertureInset, glassLightDirection } from './glass-optics.js';
import { setGlassLight } from './glass-refraction.js';

const svgNamespace = 'http://www.w3.org/2000/svg';
const edgeInset = 1.7;
export const rimOutset = 5;
let instance = 0;

function createChoiceSurface(svg, host, id) {
  svg.innerHTML = `<defs>
    <path id="${id}-edge" class="glass-contour-outline"/>
    <path id="${id}-opening" class="glass-aperture-outline"/>
    <clipPath id="${id}-silhouette"><use href="#${id}-edge"/></clipPath>
    <clipPath id="${id}-aperture"><use href="#${id}-opening" transform="translate(${rimOutset} ${rimOutset})"/></clipPath>
    <linearGradient id="${id}-light" gradientUnits="userSpaceOnUse">
      <stop class="rim-glint" offset="0"/><stop class="rim-silver" offset=".14"/>
      <stop class="rim-depth" offset=".38"/><stop class="rim-depth" stop-opacity=".34" offset=".60"/>
      <stop class="rim-silver" offset=".83"/><stop class="rim-pearl" offset="1"/>
    </linearGradient>
  </defs>
  <use class="rim-shine-line" href="#${id}-edge" fill="#fff" stroke="url(#${id}-light)" clip-path="url(#${id}-silhouette)"/>`;
  host.style.setProperty('--lens-aperture', `url("#${id}-aperture")`);
  host.classList.add('has-optical-lens');
  const edge = svg.querySelector('.glass-contour-outline');
  const opening = svg.querySelector('.glass-aperture-outline');
  const gradient = svg.querySelector('linearGradient');
  let lastLight;
  return {
    inset: glassApertureInset,
    shape(outline, inner) {
      edge.setAttribute('d', outline);
      opening.setAttribute('d', inner);
    },
    light(width, height, px, py) {
      const { x, y } = glassLightDirection(px, py);
      const shortSide = Math.min(width, height);
      const reach = (shortSide + Math.abs(x) * (width - shortSide) + Math.abs(y) * (height - shortSide)) / 2 - edgeInset;
      const dx = x * reach, dy = y * reach;
      const x1 = (width / 2 + dx).toFixed(1), y1 = (height / 2 + dy).toFixed(1);
      const x2 = (width / 2 - dx).toFixed(1), y2 = (height / 2 - dy).toFixed(1);
      const key = `${x1} ${y1} ${x2} ${y2}`;
      if (key !== lastLight) {
        lastLight = key;
        gradient.setAttribute('x1', x1);
        gradient.setAttribute('y1', y1);
        gradient.setAttribute('x2', x2);
        gradient.setAttribute('y2', y2);
      }
      setGlassLight(host, px, py);
    },
  };
}

function createRimBand(svg, host, id) {
  svg.innerHTML = `<defs>
    <path id="${id}-edge" class="glass-contour-outline"/>
    <path id="${id}-inner"/>
    <clipPath id="${id}-band"><path clip-rule="evenodd" transform="translate(${rimOutset} ${rimOutset})"/></clipPath>
    <linearGradient id="${id}-bevel" x1="16%" y1="0%" x2="78%" y2="100%">
      <stop class="rim-pearl" offset="0"/><stop class="rim-silver" offset=".23"/>
      <stop class="rim-depth" offset=".49"/><stop class="rim-silver" offset=".74"/>
      <stop class="rim-pearl" offset="1"/>
    </linearGradient>
    <radialGradient id="${id}-shine" gradientUnits="userSpaceOnUse">
      <stop class="rim-pearl" offset="0"/><stop class="rim-pearl" stop-opacity=".76" offset=".36"/>
      <stop class="rim-pearl" stop-opacity=".34" offset=".67"/><stop class="rim-pearl" stop-opacity="0" offset="1"/>
    </radialGradient>
    <radialGradient id="${id}-return" gradientUnits="userSpaceOnUse">
      <stop class="rim-return" offset="0"/><stop class="rim-return" stop-opacity=".6" offset=".48"/>
      <stop class="rim-return" stop-opacity="0" offset="1"/>
    </radialGradient>
  </defs>
  <use class="rim-depth-line" href="#${id}-edge"/>
  <use class="rim-bevel-line" href="#${id}-inner" stroke="url(#${id}-bevel)"/>
  <use class="rim-shine-line" href="#${id}-inner" stroke="url(#${id}-shine)"/>
  <use class="rim-caustic" href="#${id}-inner" stroke="url(#${id}-return)" stroke-width=".85"/>`;
  host.style.setProperty('--rim-clip', `url("#${id}-band")`);
  const edge = svg.querySelector('.glass-contour-outline');
  const innerEdge = svg.getElementById(`${id}-inner`);
  const band = svg.querySelector('clipPath path');
  const shine = svg.getElementById(`${id}-shine`);
  const returnLight = svg.getElementById(`${id}-return`);
  let lastLight;
  return {
    inset: 4.6,
    shape(outline, inner) {
      edge.setAttribute('d', outline);
      innerEdge.setAttribute('d', inner);
      band.setAttribute('d', outline + inner);
    },
    light(width, height, px, py) {
      const cx = Math.round((.5 + (px ?? -.45) * .48) * width * 10) / 10;
      const cy = Math.round((.36 + (py ?? -.8) * .5) * height * 10) / 10;
      const r = Math.round(Math.min(96, Math.max(22, Math.min(width, height * 2.2) * .66)));
      const key = `${cx} ${cy} ${r}`;
      if (key === lastLight) return;
      lastLight = key;
      shine.setAttribute('cx', cx);
      shine.setAttribute('cy', cy);
      shine.setAttribute('r', r);
      returnLight.setAttribute('cx', (width - cx).toFixed(1));
      returnLight.setAttribute('cy', (height - cy).toFixed(1));
      returnLight.setAttribute('r', r * .82);
    },
  };
}

export function attachGlassRim(host, { radius = Infinity, strength = 1, optical = false } = {}) {
  const contour = createGlassContour();
  const id = `glass-rim-${++instance}`;
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('class', 'glass-contour');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  const surface = optical ? createChoiceSurface(svg, host, id) : createRimBand(svg, host, id);
  const specular = svg.querySelector('.rim-shine-line');
  host.append(svg);
  host.style.setProperty('--rim-outset', `${rimOutset}px`);
  host.classList.add('has-glass-contour');
  let lastEdge, lastIntensity;

  function paint(width, height, seconds, { velocityX, velocityY, pointerX, pointerY, pressure }, snap = false) {
    if (width < 2 || height < 2) return false;
    if (snap) contour.reset();
    const moving = !snap && contour.step(seconds, {
      velocityX: velocityX * strength, velocityY: velocityY * strength,
      pointerX: (pointerX ?? 0) * strength, pointerY: (pointerY ?? 0) * strength, pressure: pressure * strength,
    });
    const outline = contour.path(width, height, radius, edgeInset);
    if (outline !== lastEdge) {
      lastEdge = outline;
      surface.shape(outline, contour.path(width, height, radius, surface.inset));
    }
    surface.light(width, height, pointerX, pointerY);
    const load = Math.min(1, Math.hypot(velocityX, velocityY) / 850 + pressure * .65);
    // The choice seam is clipped to its own silhouette, so only its inner half is painted.
    const intensity = ((optical ? 1.45 : .65) + load * .55).toFixed(2);
    if (lastIntensity !== intensity) {
      lastIntensity = intensity;
      specular.setAttribute('stroke-width', intensity);
      if (optical) specular.setAttribute('fill-opacity', (.02 + load * .085).toFixed(3));
    }
    return moving;
  }
  return { paint, reset: contour.reset };
}
