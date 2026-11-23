import { bindGlassChoices } from '../../core/glass-choices.js';

export function setupNavChoiceLenses() {
  const groups = [
    ['.nav-period-group', '.nav-period-btn', 'nav-period-btn-active'],
    ['#nav-value-mode', '.nav-toggle-btn', 'nav-toggle-btn-active'],
    ['#nav-axis-scale', '.nav-toggle-btn', 'nav-toggle-btn-active'],
  ];
  for (const [selector, itemSelector, activeClass] of groups) {
    const group = document.querySelector(selector);
    const lens = document.createElement('span');
    lens.className = 'glass-hover-frame nav-choice-lens';
    lens.setAttribute('aria-hidden', 'true');
    lens.hidden = true;
    group.append(lens);
    group.classList.add('has-nav-choice-lens');
    bindGlassChoices(group, lens, { itemSelector, activeClass, optics: { rim: 5, scale: 11 } });
  }
}
