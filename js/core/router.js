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
};

const DEFAULT_ROUTE = 'calc';
const initialized = new Set();
let switching = false;
let pendingRoute = null;

function parseRoute() {
  const h = (window.location.hash || '').replace(/^#\/?/, '').trim();
  const name = h.split('/')[0] || '';
  return ROUTES[name] ? name : DEFAULT_ROUTE;
}

function setActiveTab(route) {
  const tabs = document.querySelectorAll('.top-rail-tab');
  tabs.forEach(t => {
    if (t.dataset.route === route) t.classList.add('active');
    else t.classList.remove('active');
  });
}

function showOnlyPage(route) {
  const pages = document.querySelectorAll('.page');
  pages.forEach(p => {
    if (p.dataset.route === route) p.classList.add('active');
    else p.classList.remove('active');
  });
}

async function activate(route) {
  pendingRoute = route;
  if (switching) return;
  switching = true;
  try {
    while (pendingRoute) {
      const current = pendingRoute;
      pendingRoute = null;
      showOnlyPage(current);
      setActiveTab(current);
      if (!initialized.has(current)) {
        const mod = await import(ROUTES[current].module);
        if (typeof mod.pageInit === 'function') mod.pageInit();
        initialized.add(current);
      }
      if (!pendingRoute) {
        window.scrollTo({ top: 0, behavior: 'instant' });
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new CustomEvent('fundcal-route-ready', { detail: { route: current } }));
      }
    }
  } finally { switching = false; }
}

function onHashChange() {
  activate(parseRoute());
}

function start() {
  if (!window.location.hash) {
    window.location.hash = '#/' + DEFAULT_ROUTE;
  }
  window.addEventListener('hashchange', onHashChange);
  activate(parseRoute());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
