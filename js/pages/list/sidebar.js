/**
 * 缓存基金列表页 —— 筛选侧栏的两块互补 UI：
 *
 * 1. setupNarrowFilterDrawer()
 *    - 窄屏（移动端 / 平板）下把侧栏改造为"抽屉"模式：在 body 上挂一个浮动按钮，
 *      点击展开 / 收起带遮罩层的滑出面板。监听 hashchange 在离开 list 页时自动收起。
 *    - 还会镜像同步顶部"筛选数量"小徽标到浮动按钮，让用户在抽屉收起时也能看到筛选数。
 *
 * 2. setupSidebarToggle()
 *    - 宽屏下侧栏可折叠：在侧栏首部插入一颗箭头按钮，点击切换 `cf-sidebar-collapsed`。
 *    - 状态用 localStorage 持久化，刷新后恢复。
 *
 * 这两块都只读写 DOM 与 localStorage、不依赖列表数据，因此独立成文件。
 */

/**
 * 注入窄屏筛选抽屉按钮 + 遮罩层；幂等（重复调用会自动跳过）。
 */
export function setupNarrowFilterDrawer() {
  const sidebar = document.getElementById('cf-filter-panel');
  if (!sidebar) return;
  if (document.getElementById('cf-filter-toggle-btn')) return;

  if (!sidebar.querySelector('.cf-sidebar-handle')) {
    const handle = document.createElement('div');
    handle.className = 'cf-sidebar-handle';
    handle.setAttribute('aria-hidden', 'true');
    sidebar.insertBefore(handle, sidebar.firstChild);
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'cf-sidebar-backdrop';
  backdrop.id = 'cf-sidebar-backdrop';
  document.body.appendChild(backdrop);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'cf-filter-toggle-btn';
  btn.className = 'cf-filter-toggle';
  btn.setAttribute('aria-label', '打开筛选');
  btn.innerHTML = '<span>筛选</span><span class="cf-filter-toggle-count" id="cf-filter-toggle-count"></span>';
  document.body.appendChild(btn);

  const list = document.querySelector('.page-list');
  function isOnList() {
    return list && list.classList.contains('active');
  }
  function setVisible(v) {
    btn.style.display = v ? '' : 'none';
  }
  setVisible(isOnList());
  window.addEventListener('hashchange', () => {
    setVisible(isOnList());
    if (!isOnList()) {
      sidebar.classList.remove('cf-sidebar-open');
      backdrop.classList.remove('cf-sidebar-backdrop-open');
    }
  });

  function open() {
    sidebar.classList.add('cf-sidebar-open');
    backdrop.classList.add('cf-sidebar-backdrop-open');
  }
  function close() {
    sidebar.classList.remove('cf-sidebar-open');
    backdrop.classList.remove('cf-sidebar-backdrop-open');
  }
  btn.addEventListener('click', () => {
    if (sidebar.classList.contains('cf-sidebar-open')) close();
    else open();
  });
  backdrop.addEventListener('click', close);

  // 应用 / 重置后顺手收起抽屉
  const applyBtn = document.getElementById('cf-filter-apply');
  const resetBtn = document.getElementById('cf-filter-reset');
  if (applyBtn) applyBtn.addEventListener('click', close);
  if (resetBtn) resetBtn.addEventListener('click', close);

  // 把顶部筛选计数同步到浮动按钮上
  const countEl = document.getElementById('cf-filter-toggle-count');
  const sourceCountEl = document.getElementById('cf-filter-active-count');
  if (countEl && sourceCountEl) {
    const sync = () => {
      const t = (sourceCountEl.textContent || '').trim();
      countEl.textContent = t;
    };
    sync();
    new MutationObserver(sync).observe(sourceCountEl, { childList: true, characterData: true, subtree: true });
  }
}

const SIDEBAR_COLLAPSE_KEY = 'fundcal-cf-sidebar-collapsed';

/**
 * 宽屏下的折叠按钮：插入到侧栏首部，状态写入 localStorage 跨刷新。
 */
export function setupSidebarToggle() {
  const sidebar = document.getElementById('cf-filter-panel');
  if (!sidebar) return;
  if (sidebar.querySelector('.cf-sidebar-toggle')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cf-sidebar-toggle';
  btn.title = '收起 / 展开筛选栏';
  btn.setAttribute('aria-label', '收起 / 展开筛选栏');
  const setLabel = () => {
    btn.textContent = sidebar.classList.contains('cf-sidebar-collapsed') ? '‹' : '›';
  };

  // 持久化折叠态
  try {
    if (localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1') {
      sidebar.classList.add('cf-sidebar-collapsed');
    }
  } catch { /* localStorage 不可用时静默 */ }

  setLabel();
  btn.addEventListener('click', () => {
    sidebar.classList.toggle('cf-sidebar-collapsed');
    try {
      localStorage.setItem(SIDEBAR_COLLAPSE_KEY,
        sidebar.classList.contains('cf-sidebar-collapsed') ? '1' : '0');
    } catch { /* 同上 */ }
    setLabel();
  });
  sidebar.insertBefore(btn, sidebar.firstChild);
}
