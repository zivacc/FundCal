import { createGlassContour } from './glass-contour.js';
import { glassLightDirection } from './glass-optics.js';
import { setGlassLight } from './glass-refraction.js';

const svgNamespace = 'http://www.w3.org/2000/svg';
// Keep room around the element for the moving lip, in both the clip and the displacement map.
export const rimOutset = 5;
let instance = 0;

// The seam, reflections and optical clip share a single moving outline.
export function attachGlassRim(host, { radius = Infinity, strength = 1, optical = false } = {}) {
  const contour = createGlassContour();
  const id = `glass-rim-${++instance}`;
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('class', 'glass-contour');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
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
  if (optical) {
    svg.querySelector('defs').insertAdjacentHTML('beforeend', `
      <clipPath id="${id}-aperture"><use href="#${id}-edge" transform="translate(${rimOutset} ${rimOutset})"/></clipPath>
      <radialGradient id="${id}-cool" gradientUnits="userSpaceOnUse">
        <stop stop-color="#e6f6ff" stop-opacity=".64"/><stop offset=".40" stop-color="#95cce8" stop-opacity=".46"/>
        <stop offset=".72" stop-color="#a1a5d7" stop-opacity=".22"/><stop offset="1" stop-color="#a1a5d7" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${id}-warm" gradientUnits="userSpaceOnUse">
        <stop stop-color="#fff1cf" stop-opacity=".62"/><stop offset=".42" stop-color="#d5b295" stop-opacity=".42"/>
        <stop offset=".74" stop-color="#b895b2" stop-opacity=".18"/><stop offset="1" stop-color="#b895b2" stop-opacity="0"/>
      </radialGradient>`);
    svg.insertAdjacentHTML('beforeend', `<use href="#${id}-edge" stroke="url(#${id}-cool)" stroke-width="1.15"/>
      <use href="#${id}-edge" stroke="url(#${id}-warm)" stroke-width="1"/>`);
    host.style.setProperty('--lens-aperture', `url("#${id}-aperture")`);
    host.classList.add('has-optical-lens');
  }
  const edge = svg.querySelector('.glass-contour-outline');
  const innerEdge = svg.getElementById(`${id}-inner`);
  const band = svg.querySelector('clipPath path');
  const shine = svg.querySelector('radialGradient');
  const specular = svg.querySelector('.rim-shine-line');
  const returnLight = svg.getElementById(`${id}-return`);
  const cool = svg.getElementById(`${id}-cool`), warm = svg.getElementById(`${id}-warm`);
  host.append(svg);
  host.style.setProperty('--rim-outset', `${rimOutset}px`);
  host.style.setProperty('--rim-clip', `url("#${id}-band")`);
  host.classList.add('has-glass-contour');
  let lastEdge, lastLight, lastIntensity;

  function paint(width, height, seconds, { velocityX, velocityY, pointerX, pointerY, pressure }, snap = false) {
    if (width < 2 || height < 2) return false;
    if (snap) contour.reset();
    const moving = !snap && contour.step(seconds, {
      velocityX: velocityX * strength, velocityY: velocityY * strength,
      pointerX: (pointerX ?? 0) * strength, pointerY: (pointerY ?? 0) * strength, pressure: pressure * strength,
    });
    const outline = contour.path(width, height, radius, 1.7);
    if (outline !== lastEdge) {
      lastEdge = outline;
      const inner = contour.path(width, height, radius, optical ? 3.15 : 4.6);
      edge.setAttribute('d', outline);
      innerEdge.setAttribute('d', inner);
      band.setAttribute('d', outline + inner);
    }

    // Project a broad specular highlight towards the contact point on the curved lip.
    const { x: nx, y: ny } = optical ? glassLightDirection(pointerX, pointerY)
      : { x: pointerX ?? -.45, y: pointerY ?? -.8 };
    const cx = Math.round((.5 + nx * .48) * width * 10) / 10;
    const cy = Math.round((.36 + ny * .5) * height * 10) / 10;
    const r = Math.round(Math.min(96, Math.max(22, Math.min(width, height * 2.2) * .66)));
    const light = `${cx} ${cy} ${r}`;
    if (lastLight !== light) {
      lastLight = light;
      shine.setAttribute('cx', cx);
      shine.setAttribute('cy', cy);
      shine.setAttribute('r', r);
      returnLight.setAttribute('cx', (width - cx).toFixed(1));
      returnLight.setAttribute('cy', (height - cy).toFixed(1));
      returnLight.setAttribute('r', r * .82);
      if (optical) {
        // The two short glancing reflections sit on opposing shoulders of the curved surface.
        const x = width * (.5 + .49 * nx), y = height * (.5 + .49 * ny);
        cool.setAttribute('cx', x);
        cool.setAttribute('cy', y);
        cool.setAttribute('r', r * .52);
        warm.setAttribute('cx', width - x);
        warm.setAttribute('cy', height - y);
        warm.setAttribute('r', r * .48);
      }
    }
    if (optical) setGlassLight(host, pointerX, pointerY);
    const load = Math.min(1, Math.hypot(velocityX, velocityY) / 850 + pressure * .65);
    const intensity = (.65 + load * .55).toFixed(2);
    if (lastIntensity !== intensity) {
      lastIntensity = intensity;
      specular.setAttribute('stroke-width', intensity);
    }
    return moving;
  }
  return { paint, reset: contour.reset };
}
