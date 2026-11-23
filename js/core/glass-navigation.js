import { bindGlassChoices } from './glass-choices.js';

const rail = document.querySelector('.top-rail');
const tabs = rail.querySelector('.top-rail-tabs');
bindGlassChoices(tabs, tabs.querySelector('.top-rail-lens'), {
  itemSelector: '.top-rail-tab',
  activeClass: 'active',
  optics: { scale: 19 },
  scrollSelection: true,
});

// Keep navigation labels legible as data rows scroll underneath.
function syncScrollSurface() {
  rail.classList.toggle('is-scrolled', window.scrollY > 8);
}
window.addEventListener('scroll', syncScrollSurface, { passive: true });
syncScrollSurface();
