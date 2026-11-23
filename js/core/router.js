/* SPA hash 路由
 * 路由 → 页面模块映射，懒加载首次访问，复用已加载模块
 */

const ROUTES = {
  calc:  { module: '../pages/calc/index.js',          selector: '[data-route="calc"]' },
  list:  { module: '../pages/list/index.js',          selector: '[data-route="list"]' },
  index: { module: '../pages/index-picker/index.js',  selector: '[data-route="index"]' },
  nav:   { module: '../pages/nav/index.js',           selector: '[data-route="nav"]' },
  stats: { module: '../pages/stats/index.js',         selector: '[data-route="stats"]' },
  fund:  { module: '../pages/fund-detail/index.js',   selector: '[data-route="fund"]' },
  compare: { module: '../pages/fund-compare/index.js', selector: '[data-route="compare"]' },
  'index-detail': { module: '../pages/index-detail/index.js', selector: '[data-route="index-detail"]' },
};

const DEFAULT_ROUTE = 'calc';
const initialized = new Set();
const routeMotion = matchMedia('(prefers-reduced-motion: no-preference)');
let routeVersion = 0;

function parseRoute() {
  const h = (window.location.hash || '').replace(/^#\/?/, '').trim();
  const name = h.split('/')[0] || '';
  return Object.hasOwn(ROUTES, name) ? name : DEFAULT_ROUTE;
}

function setActiveTab(route) {
  const tabs = document.querySelectorAll('.top-rail-tab');
  tabs.forEach(t => {
    const active = t.dataset.route === route;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
}

function showOnlyPage(route) {
  const previous = document.querySelector('.page.active');
  const next = document.querySelector(`.page${ROUTES[route].selector}`);
  if (next === previous) return;
  previous?.classList.remove('active', 'is-route-entering');
  next.classList.add('active');
  if (previous && routeMotion.matches) next.classList.add('is-route-entering');
}

async function activate(route) {
  const version = ++routeVersion;
  showOnlyPage(route);
  setActiveTab(route);
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (!initialized.has(route)) {
    const mod = await import(ROUTES[route].module);
    if (version !== routeVersion) return;
    if (typeof mod.pageInit === 'function') mod.pageInit();
    initialized.add(route);
  }
  window.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new CustomEvent('fundcal-route-ready', { detail: { route } }));
}

function onHashChange() {
  activate(parseRoute());
}

function start() {
  if (!window.location.hash) {
    window.location.hash = '#/' + DEFAULT_ROUTE;
  }
  window.addEventListener('hashchange', onHashChange);
  document.addEventListener('animationend', event => {
    if (event.animationName === 'pageEnter') event.target.closest('.page')?.classList.remove('is-route-entering');
  });
  routeMotion.addEventListener('change', () => {
    if (!routeMotion.matches) document.querySelector('.page.is-route-entering')?.classList.remove('is-route-entering');
  });
  activate(parseRoute());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
