/* SPA hash 路由
 * 路由 → 页面模块映射，懒加载首次访问，复用已加载模块
 */

const ROUTES = {
  calc:  { module: '../pages/calc/index.js',          selector: '[data-route="calc"]' },
  list:  { module: '../pages/list/index.js',          selector: '[data-route="list"]' },
  index: { module: '../pages/index-picker/index.js',  selector: '[data-route="index"]' },
  nav:   { module: '../pages/nav/index.js',           selector: '[data-route="nav"]' },
  stats: { module: '../pages/stats/index.js',         selector: '[data-route="stats"]' },
};

const DEFAULT_ROUTE = 'calc';
const initialized = new Set();
let switching = false;

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
  if (switching) return;
  switching = true;
  try {
    showOnlyPage(route);
    setActiveTab(route);
    if (!initialized.has(route)) {
      const cfg = ROUTES[route];
      const mod = await import(cfg.module);
      if (typeof mod.pageInit === 'function') {
        mod.pageInit();
      }
      initialized.add(route);
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    // 触发 resize：Chart.js 等组件在 display:none → block 切换后需要重算尺寸
    window.dispatchEvent(new Event('resize'));
  } finally {
    switching = false;
  }
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
