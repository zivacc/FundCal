import { createGlassContour } from './glass-contour.js';

const svgNamespace = 'http://www.w3.org/2000/svg';
let instance = 0;

// The bevel and its reflections follow one surface. Only the band inside it refracts the backdrop.
export function attachGlassRim(host, { radius = Infinity, strength = 1 } = {}) {
  const contour = createGlassContour();
  const id = `glass-rim-${++instance}`;
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('class', 'glass-contour');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.innerHTML = `<defs>
    <path id="${id}-edge" class="glass-contour-outline"/>
    <clipPath id="${id}-band"><path clip-rule="evenodd" transform="translate(5 5)"/></clipPath>
    <linearGradient id="${id}-bevel" x1="16%" y1="0%" x2="78%" y2="100%">
      <stop class="rim-pearl" offset="0"/><stop class="rim-silver" offset=".23"/>
      <stop class="rim-depth" offset=".49"/><stop class="rim-silver" offset=".74"/>
      <stop class="rim-pearl" offset="1"/>
    </linearGradient>
    <radialGradient id="${id}-shine" gradientUnits="userSpaceOnUse">
      <stop stop-color="white" offset="0"/><stop stop-color="white" stop-opacity=".95" offset=".36"/>
      <stop class="rim-pearl" stop-opacity=".58" offset=".67"/><stop class="rim-pearl" stop-opacity="0" offset="1"/>
    </radialGradient>
    <radialGradient id="${id}-return" gradientUnits="userSpaceOnUse">
      <stop class="rim-return" offset="0"/><stop class="rim-return" stop-opacity=".6" offset=".48"/>
      <stop class="rim-return" stop-opacity="0" offset="1"/>
    </radialGradient>
  </defs>
  <use class="rim-depth-line" href="#${id}-edge"/>
  <use class="rim-bevel-line" href="#${id}-edge" stroke="url(#${id}-bevel)"/>
  <use class="rim-shine-line" href="#${id}-edge" stroke="url(#${id}-shine)"/>
  <path class="rim-caustic" stroke="url(#${id}-return)" stroke-width="1.15"/>`;
  const edge = svg.querySelector('.glass-contour-outline');
  const band = svg.querySelector('clipPath path');
  const shine = svg.querySelector('radialGradient');
  const specular = svg.querySelector('.rim-shine-line');
  const reflection = svg.querySelector('.rim-caustic');
  const returnLight = svg.getElementById(`${id}-return`);
  host.append(svg);
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
      const inner = contour.path(width, height, radius, 4.6);
      edge.setAttribute('d', outline);
      band.setAttribute('d', outline + inner);
      reflection.setAttribute('d', inner);
    }

    // Project a broad specular highlight towards the contact point on the curved lip.
    const nx = pointerX ?? -.45, ny = pointerY ?? -.8;
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
    }
    const load = Math.min(1, Math.hypot(velocityX, velocityY) / 850 + pressure * .65);
    const intensity = (.95 + load * 1.35).toFixed(2);
    if (lastIntensity !== intensity) {
      lastIntensity = intensity;
      specular.setAttribute('stroke-width', intensity);
    }
    return moving;
  }
  return { paint, reset: contour.reset };
}
