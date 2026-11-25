import { rimOutset } from './glass-rim.js';

const ns = 'http://www.w3.org/2000/svg';
let nextClip = 0;
const textStyles = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
  'letterSpacing', 'color', 'textDecorationLine', 'textDecorationColor', 'textUnderlineOffset'];

// WebKit supports SVG displacement on foreground pixels. Mirror only the ink
// inside the aperture, leaving the real links/buttons and their focus rings in place.
export function createChoiceProjection(group, lens, items, schedule) {
  const aperture = document.createElement('span');
  aperture.className = 'glass-choice-projection';
  aperture.inert = true;
  aperture.setAttribute('aria-hidden', 'true');
  const optical = document.createElement('span');
  optical.className = 'glass-projection-optics';
  // Clip the source before filtering it. WebKit otherwise maps displacement
  // over the entire scrolling rail, shifting the optical center towards one cap.
  const sourceWindow = document.createElement('span');
  sourceWindow.className = 'glass-projection-window';
  const scene = document.createElement('span');
  scene.className = 'glass-projection-scene';
  sourceWindow.append(scene);
  optical.append(sourceWindow);
  aperture.append(optical);
  lens.prepend(aperture);

  const defs = document.getElementById('glass-filter-definitions');
  const entries = new Map();
  let dirty = true;
  function invalidate() { dirty = true; schedule(); }
  const observer = new MutationObserver(invalidate);
  for (const item of items) {
    const original = document.createElement('span');
    original.className = 'glass-choice-label';
    const copy = document.createElement('span');
    scene.append(copy);
    const clip = document.createElementNS(ns, 'clipPath');
    clip.id = `glass-label-clip-${++nextClip}`;
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('clip-rule', 'evenodd');
    clip.append(path);
    defs.append(clip);
    original.style.setProperty('--outside-choice', `url("#${clip.id}")`);
    entries.set(item, { original, copy, path });
    observer.observe(item, {
      childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'aria-selected'],
    });
  }
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const selection = new MutationObserver(invalidate);
  for (const item of items) selection.observe(item, { attributes: true, attributeFilter: ['class'] });
  group.addEventListener('transitionend', event => { if (event.propertyName === 'color') invalidate(); });
  document.fonts.addEventListener('loadingdone', invalidate);
  let visible = [], edge, pose, boxes = [];

  function sync(choices) {
    if (!lens.style.getPropertyValue('--glass-refraction')) {
      hide();
      return;
    }
    aperture.hidden = false;
    if (!dirty && choices.length === boxes.length && choices.every((choice, i) => {
      const box = boxes[i];
      return choice.item === box.item && choice.x === box.x && choice.y === box.y &&
        choice.width === box.width && choice.height === box.height;
    })) return;
    dirty = false;
    boxes = choices;
    const current = new Set(choices.map(({ item }) => item));
    for (const [item, { original, copy }] of entries) {
      copy.hidden = !current.has(item);
      if (copy.hidden) original.classList.remove('glass-label-cutout');
      if (original.parentNode !== item || item.childNodes.length !== 1) {
        if (original.parentNode === item) original.replaceWith(...original.childNodes);
        original.replaceChildren(...item.childNodes);
        item.append(original);
      }
    }
    visible = choices.map(({ item, x, y, width, height }) => {
      const entry = entries.get(item);
      const box = item.getBoundingClientRect();
      const label = entry.original.getBoundingClientRect();
      const sx = width / box.width, sy = height / box.height;
      entry.x = x + (label.left - box.left) * sx;
      entry.y = y + (label.top - box.top) * sy;
      entry.width = label.width * sx;
      entry.height = label.height * sy;
      const style = getComputedStyle(item);
      for (const property of textStyles) entry.copy.style[property] = style[property];
      entry.copy.style.left = `${entry.x}px`;
      entry.copy.style.top = `${entry.y}px`;
      if (entry.copy.textContent !== entry.original.textContent) entry.copy.textContent = entry.original.textContent;
      return entry;
    });
    if (pose) paint(pose);
  }

  function paint(frame) {
    pose = frame;
    if (aperture.hidden) return;
    edge ??= lens.querySelector('.glass-contour-outline');
    const outline = edge?.getAttribute('d');
    if (!outline) return;
    const { x, y, w, h, width, height } = frame;
    const sx = w / width, sy = h / height;
    scene.style.transform = `matrix(${1 / sx},0,0,${1 / sy},${rimOutset - x / sx},${rimOutset - y / sy})`;
    for (const entry of visible) {
      const touches = entry.x + entry.width >= x - rimOutset && entry.x <= x + w + rimOutset &&
        entry.y + entry.height >= y - rimOutset && entry.y <= y + h + rimOutset;
      entry.original.classList.toggle('glass-label-cutout', touches);
      if (!touches) continue;
      // Both layers use the physical spring contour, including while crossing a gap.
      if (entry.outline !== outline) {
        entry.path.setAttribute('d', 'M-10000 -10000h20000v20000h-20000Z' + outline);
        entry.outline = outline;
      }
      entry.path.setAttribute('transform', `matrix(${sx} 0 0 ${sy} ${x - entry.x} ${y - entry.y})`);
    }
  }

  function hide() {
    if (aperture.hidden) return;
    aperture.hidden = true;
    dirty = true;
    for (const { original } of entries.values()) original.classList.remove('glass-label-cutout');
  }
  function reset() { hide(); pose = null; }
  return { sync, paint, reset };
}
