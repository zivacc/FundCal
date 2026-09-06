/** 全屏控制层：复用原 DOM，退出时归位；图表尺寸不随面板开合变化。 */
const PANELS = [
  ['funds', '基金', '搜索、添加或隐藏对比项'],
  ['period', '区间', '选择显示范围，或框选一段进行比较'],
  ['indicators', '指标', '调整主图、副图与坐标模式'],
  ['stats', '统计', '查看当前显示范围的统计'],
  ['tools', '工具', '图表操作与使用提示'],
];
const chevron = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const menu = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';

export function setupNavFullscreen({ onResize, createRange, zoomRange, clearRange, hasRange, hasData }) {
  const page = document.querySelector('.page-nav');
  const entry = document.getElementById('nav-chart-toolbar-fullscreen');
  const shell = document.createElement('div');
  shell.className = 'nav-fs-ui';
  shell.hidden = true;
  shell.innerHTML = `
    <button type="button" class="nav-fs-exit" aria-label="退出图表全屏">↙ <span>退出</span></button>
    <div class="nav-fs-dock" role="group" aria-label="全屏图表控制">
      ${PANELS.map(([id, title]) => `<button type="button" class="nav-fs-tab" data-panel="${id}" aria-controls="nav-fs-panel" aria-expanded="false">${title}</button>`).join('')}
      <button type="button" class="nav-fs-fold" aria-label="收起控制条" title="收起控制条">${chevron}</button>
    </div>
    <button type="button" class="nav-fs-unfold" aria-label="展开图表控制条" hidden>${menu}<span>控制</span></button>
    <section id="nav-fs-panel" class="nav-fs-panel" role="dialog" aria-modal="false" aria-labelledby="nav-fs-title" hidden>
      <div class="nav-fs-panel-heading">
        <div><h2 id="nav-fs-title"></h2><p id="nav-fs-description"></p></div>
        <button type="button" class="nav-fs-close" aria-label="收起面板" title="点击收起，手机也可向下拖动">${chevron}</button>
      </div>
      <div class="nav-fs-content">
        ${PANELS.map(([id]) => `<div class="nav-fs-pane" data-pane="${id}" hidden></div>`).join('')}
      </div>
    </section>`;
  page.appendChild(shell);
  const dock = shell.querySelector('.nav-fs-dock');
  const unfold = shell.querySelector('.nav-fs-unfold');
  const panel = shell.querySelector('.nav-fs-panel');
  const close = shell.querySelector('.nav-fs-close');
  const dragHandle = shell.querySelector('.nav-fs-panel-heading');
  const pane = id => shell.querySelector(`[data-pane="${id}"]`);
  const tabs = [...shell.querySelectorAll('[data-panel]')];
  let active = false, current = null, savedFocus = null, scrollY = 0;
  const moved = new Map();
  const groupTitle = (host, text) => {
    const heading = document.createElement('h3');
    heading.className = 'nav-fs-section-title'; heading.textContent = text; host.appendChild(heading);
  };
  const fundSearch = document.createElement('div');
  const fundLegend = document.createElement('div');
  pane('funds').append(fundSearch);
  groupTitle(pane('funds'), '对比项 · 点击切换显隐');
  pane('funds').append(fundLegend);
  const periodControls = document.createElement('div');
  periodControls.className = 'nav-controls'; pane('period').append(periodControls);
  const indicatorControls = document.createElement('div');
  indicatorControls.className = 'nav-controls'; pane('indicators').append(indicatorControls);
  const rangeActions = document.createElement('div');
  rangeActions.className = 'nav-fs-actions';
  rangeActions.innerHTML = '<button type="button" class="btn btn-secondary" data-action="create-range">框选区间</button><button type="button" class="btn btn-secondary" data-action="zoom-range">放大选区</button><button type="button" class="btn btn-secondary" data-action="clear-range">清除选区</button>';
  groupTitle(pane('period'), '选区比较'); pane('period').append(rangeActions);
  const toolActions = document.createElement('div'); toolActions.className = 'nav-fs-actions';
  pane('tools').append(toolActions);
  const help = document.createElement('p'); help.className = 'nav-fs-note';
  help.textContent = '电脑：滚轮缩放，右键拖选区间。手机：双指缩放；在“区间”中框选后拖动两侧手柄。点击图表收起面板；Esc 先收起面板，再退出全屏。';
  pane('tools').append(help);

  function move(node, host) {
    if (!node || moved.has(node)) return;
    const anchor = document.createComment('nav-fullscreen-slot');
    node.before(anchor); moved.set(node, anchor); host.appendChild(node);
  }
  // 图表可能在进入全屏后才首次取数，同步操作可用状态。
  function sync() {
    if (!active) return;
    rangeActions.querySelector('[data-action="create-range"]').disabled = !hasData();
    rangeActions.querySelector('[data-action="zoom-range"]').disabled = !hasRange();
    rangeActions.querySelector('[data-action="clear-range"]').disabled = !hasRange();

  }
  function mount() {
    move(page.querySelector('.container > .nav-toolbar'), fundSearch);
    move(document.getElementById('nav-chart-legend'), fundLegend);
    const controls = page.querySelector('.container > .nav-controls');
    [...controls.children].forEach(node => move(node, node.classList.contains('nav-period-group') ? periodControls : indicatorControls));
    move(page.querySelector('.container > .nav-stats-section'), pane('stats'));
    move(document.getElementById('nav-chart-toolbar-save'), toolActions);
    move(document.getElementById('nav-chart-toolbar-restore'), toolActions);
    sync();
  }
  function viewport() {
    if (!active) return;
    page.style.setProperty('--nav-fs-height', `${window.visualViewport?.height || window.innerHeight}px`);
    page.style.setProperty('--nav-fs-top', `${window.visualViewport?.offsetTop || 0}px`);
  }
  function showPanel(id, { focus = true } = {}) {
    current = id;
    panel.hidden = !id;
    tabs.forEach(btn => btn.setAttribute('aria-expanded', String(btn.dataset.panel === id)));
    shell.querySelectorAll('[data-pane]').forEach(node => { node.hidden = node.dataset.pane !== id; });
    if (id) {
      const [, title, description] = PANELS.find(([key]) => key === id);
      shell.querySelector('#nav-fs-title').textContent = title;
      shell.querySelector('#nav-fs-description').textContent = description;
      shell.querySelector('.nav-fs-content').scrollTop = 0;
      sync();
      if (focus) close.focus({ preventScroll: true });
    }
  }
  function dismiss({ focus = true } = {}) {
    const previous = current; showPanel(null);
    if (focus) tabs.find(btn => btn.dataset.panel === previous)?.focus({ preventScroll: true });
  }
  function toggle(force) {
    const enter = force ?? !active;
    if (enter === active) return;
    if (enter) { savedFocus = document.activeElement; scrollY = window.scrollY; }
    active = enter;
    document.body.classList.toggle('is-fullscreen-nav', enter);
    shell.hidden = !enter;
    entry.classList.toggle('is-active', enter);
    entry.setAttribute('aria-pressed', String(enter));
    entry.setAttribute('aria-label', enter ? '退出全屏' : '全屏'); entry.title = enter ? '退出全屏' : '全屏';
    if (enter) {
      viewport(); mount(); showPanel(null);
      dock.hidden = false; unfold.hidden = true;
      shell.querySelector('.nav-fs-exit').focus({ preventScroll: true });
    } else {
      showPanel(null);
      for (const [node, anchor] of moved) { anchor.replaceWith(node); }
      moved.clear();
      page.style.removeProperty('--nav-fs-height'); page.style.removeProperty('--nav-fs-top');
      window.scrollTo({ top: scrollY, behavior: 'instant' });
      if (/^#\/nav(?:\/|$)/.test(window.location.hash)) savedFocus?.focus({ preventScroll: true });
    }
    requestAnimationFrame(() => requestAnimationFrame(onResize));
  }
  entry.addEventListener('click', () => toggle());
  shell.querySelector('.nav-fs-exit').addEventListener('click', () => toggle(false));
  tabs.forEach(btn => btn.addEventListener('click', () => {
    if (current === btn.dataset.panel) dismiss(); else showPanel(btn.dataset.panel);
  }));
  close.addEventListener('click', () => dismiss());
  shell.querySelector('.nav-fs-fold').addEventListener('click', () => {
    showPanel(null); dock.hidden = true; unfold.hidden = false; unfold.focus({ preventScroll: true });
  });
  unfold.addEventListener('click', () => { dock.hidden = false; unfold.hidden = true; tabs[0].focus({ preventScroll: true }); });
  rangeActions.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'create-range') { dismiss({ focus: false }); createRange(); }
    if (action === 'zoom-range') { zoomRange(); dismiss(); }
    if (action === 'clear-range') clearRange();
    sync();
  });
  document.addEventListener('pointerdown', event => {
    if (active && current && !shell.contains(event.target)) dismiss({ focus: false });
  });
  document.addEventListener('keydown', event => {
    if (!active || event.isComposing || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      // 搜索下拉优先响应自身的 Esc，中文输入期间不关闭面板。
      if (event.target.closest?.('.fund-search-wrap')?.querySelector('.fund-search-dropdown-visible')) return;
      event.preventDefault();
      if (current) dismiss(); else toggle(false);
    }
    if (event.key === 'Tab') {
      const focusable = [...page.querySelectorAll('button, input, select, [tabindex="0"], a[href]')]
        .filter(node => !node.disabled && node.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }, true);
  window.addEventListener('hashchange', () => { if (!/^#\/nav(?:\/|$)/.test(window.location.hash)) toggle(false); });
  window.addEventListener('resize', viewport);
  window.visualViewport?.addEventListener('resize', viewport);
  window.visualViewport?.addEventListener('scroll', viewport);
  let drag = null, suppressClick = false;
  dragHandle.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse') return;
    drag = { y: event.clientY, id: event.pointerId };
    event.target.setPointerCapture(event.pointerId);
  });
  dragHandle.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const distance = Math.max(0, event.clientY - drag.y);
    panel.style.transform = `translateY(${Math.min(distance, 100)}px)`;
  });
  const endDrag = event => {
    if (!drag) return;
    const shouldClose = event.type !== 'pointercancel' && event.clientY - drag.y > 48;
    drag = null; panel.style.transform = '';
    if (shouldClose) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); dismiss(); }
  };
  dragHandle.addEventListener('pointerup', endDrag);
  dragHandle.addEventListener('pointercancel', endDrag);
  dragHandle.addEventListener('click', event => {
    if (suppressClick) { event.stopImmediatePropagation(); suppressClick = false; }
  }, true);
  return { toggle, sync };
}
