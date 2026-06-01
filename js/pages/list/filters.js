/**
 * 缓存基金列表页 —— 筛选条件状态 + UI 事件。
 *
 * 服务端筛选模式 (2026 重构):
 * - tag 选项 + 频次来自 /api/fund/filter-options (一次性, IDB SWR 缓存)
 * - fundManager 太多 (>50) → 默认显示 top-50, 配搜索框过滤剩余
 * - 筛选状态变更 → 调用方触发分页 API 重拉, 由 API 返回的 total 写入结果提示
 *
 * 对外:
 *   applyOptions(options)        — 注入 API 返回的 {fundType,fundManager,subscribe,redeem,total}, 重建标签
 *   getActiveFilters()           — 返回当前筛选状态 (供分页 API 调用方序列化进 query string)
 *   countActiveFilters()         — 当前激活几条 (UI 徽标)
 *   setResultHint(filteredTotal) — 显示 "N / Total 只基金符合条件"
 *   setupFilters({ onChange })   — 一次性绑定 UI; onChange 在筛选确认/重置时被调用
 */

import { escapeHtml } from '../../utils/format.js';

const MANAGER_TOP_N = 50;

function makeEmptyState() {
  return {
    fundType: new Set(),
    fundManager: new Set(),
    subscribe: new Set(),
    redeem: new Set(),
    floatingFee: '',
    buyFeeMin: null,
    buyFeeMax: null,
    annualFeeMin: null,
    annualFeeMax: null,
    trackingTarget: '',
  };
}

let activeFilters = makeEmptyState();
let cachedOptions = null;          // 上次 applyOptions 注入的全量选项
let managerSearchQuery = '';        // fundManager 搜索框当前值

/* ========== 对外:状态查询 ========== */

export function getActiveFilters() {
  return {
    fundType:       [...activeFilters.fundType],
    fundManager:    [...activeFilters.fundManager],
    subscribe:      [...activeFilters.subscribe],
    redeem:         [...activeFilters.redeem],
    floatingFee:    activeFilters.floatingFee,
    buyFeeMin:      activeFilters.buyFeeMin,
    buyFeeMax:      activeFilters.buyFeeMax,
    annualFeeMin:   activeFilters.annualFeeMin,
    annualFeeMax:   activeFilters.annualFeeMax,
    trackingTarget: activeFilters.trackingTarget,
  };
}

export function countActiveFilters() {
  const f = activeFilters;
  let n = 0;
  if (f.fundType.size) n++;
  if (f.fundManager.size) n++;
  if (f.subscribe.size) n++;
  if (f.redeem.size) n++;
  if (f.floatingFee) n++;
  if (f.buyFeeMin != null || f.buyFeeMax != null) n++;
  if (f.annualFeeMin != null || f.annualFeeMax != null) n++;
  if (f.trackingTarget) n++;
  return n;
}

/* ========== 对外:UI 同步 ========== */

/**
 * 注入服务端 filter-options。
 * @param {{fundType:Array<{label,count}>, fundManager:Array<{label,count}>, subscribe:Array<{label,count}>, redeem:Array<{label,count}>, total?:number}|null} options
 */
export function applyOptions(options) {
  if (!options) return;
  cachedOptions = options;
  renderAllTags();
  updateFilterBadge();
}

function renderTagList(containerEl, items, filterSet) {
  if (!containerEl) return;
  containerEl.innerHTML = items.map(({ label, count }) => {
    const active = filterSet.has(label) ? ' cf-filter-tag-active' : '';
    return `<button type="button" class="cf-filter-tag${active}" data-value="${escapeHtml(label)}">${escapeHtml(label)} <small>(${count})</small></button>`;
  }).join('');
}

function renderAllTags() {
  if (!cachedOptions) return;
  renderTagList(document.getElementById('cf-filter-fundType'),  cachedOptions.fundType  || [], activeFilters.fundType);
  renderTagList(document.getElementById('cf-filter-subscribe'), cachedOptions.subscribe || [], activeFilters.subscribe);
  renderTagList(document.getElementById('cf-filter-redeem'),    cachedOptions.redeem    || [], activeFilters.redeem);
  renderManagerTags();

  const floatingEl = document.getElementById('cf-filter-floatingFee');
  if (floatingEl) {
    floatingEl.innerHTML = ['yes', 'no'].map(v => {
      const label = v === 'yes' ? '仅浮动费率' : '排除浮动费率';
      const active = activeFilters.floatingFee === v ? ' cf-filter-tag-active' : '';
      return `<button type="button" class="cf-filter-tag${active}" data-value="${v}">${label}</button>`;
    }).join('');
  }
}

function renderManagerTags() {
  const containerEl = document.getElementById('cf-filter-fundManager');
  if (!containerEl || !cachedOptions) return;
  const all = cachedOptions.fundManager || [];
  const q = managerSearchQuery.trim().toLowerCase();
  let items;
  if (q) {
    items = all.filter(it => it.label.toLowerCase().includes(q));
  } else {
    // 默认 top-N + 已选中的(若未在 top-N) 都展示, 避免选中态消失
    const top = all.slice(0, MANAGER_TOP_N);
    const topLabels = new Set(top.map(x => x.label));
    const selectedExtra = all.filter(x => activeFilters.fundManager.has(x.label) && !topLabels.has(x.label));
    items = [...top, ...selectedExtra];
  }
  renderTagList(containerEl, items, activeFilters.fundManager);

  // 在 tag 栏前插一条统计提示 (如果 top-N 还有更多被截断)
  const hint = document.getElementById('cf-filter-fundManager-hint');
  if (hint) {
    if (q) {
      hint.textContent = `匹配 ${items.length} 个基金公司`;
    } else if (all.length > MANAGER_TOP_N) {
      hint.textContent = `共 ${all.length} 个基金公司，仅显示前 ${MANAGER_TOP_N} 个，可用搜索框查找其他`;
    } else {
      hint.textContent = '';
    }
  }
}

function updateFilterBadge() {
  const el = document.getElementById('cf-filter-active-count');
  if (!el) return;
  const n = countActiveFilters();
  el.textContent = n > 0 ? `(${n})` : '';
}

/**
 * 显示 "N / Total 只基金符合条件"。
 * @param {number} filteredTotal API 返回的 total
 */
export function setResultHint(filteredTotal) {
  const el = document.getElementById('cf-filter-result-hint');
  if (!el) return;
  const n = countActiveFilters();
  if (n === 0) { el.textContent = ''; return; }
  const total = cachedOptions?.total ?? '?';
  el.textContent = `${filteredTotal} / ${total} 只基金符合条件`;
}

/* ========== 内部:UI ↔ state ========== */

function readFiltersFromUI() {
  const pv = (id) => {
    const v = parseFloat(document.getElementById(id)?.value);
    return isNaN(v) ? null : v / 100;
  };
  activeFilters.buyFeeMin    = pv('cf-filter-buyFee-min');
  activeFilters.buyFeeMax    = pv('cf-filter-buyFee-max');
  activeFilters.annualFeeMin = pv('cf-filter-annualFee-min');
  activeFilters.annualFeeMax = pv('cf-filter-annualFee-max');
  activeFilters.trackingTarget = (document.getElementById('cf-filter-trackingTarget')?.value || '').trim();
}

function resetFilters() {
  activeFilters = makeEmptyState();
  managerSearchQuery = '';
  const mgrSearch = document.getElementById('cf-filter-fundManager-search');
  if (mgrSearch) mgrSearch.value = '';
  const ids = [
    'cf-filter-buyFee-min', 'cf-filter-buyFee-max',
    'cf-filter-annualFee-min', 'cf-filter-annualFee-max',
    'cf-filter-trackingTarget',
  ];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  renderAllTags();
  updateFilterBadge();
}

/* ========== 对外:绑定 UI ========== */

/**
 * @param {Object} opts
 * @param {() => void} opts.onChange  应用 / 重置后调用 (调用方负责重拉 API + render)
 */
export function setupFilters({ onChange }) {
  const bar       = document.querySelector('.cf-filter-bar');
  const toggleBtn = document.getElementById('cf-filter-toggle');
  const panel     = document.getElementById('cf-filter-panel');
  const applyBtn  = document.getElementById('cf-filter-apply');
  const resetBtn  = document.getElementById('cf-filter-reset');

  if (toggleBtn && panel && bar) {
    toggleBtn.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      bar.classList.toggle('cf-filter-open', open);
    });
  }

  const bindTagToggle = (containerId, filterSet) => {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.addEventListener('click', (e) => {
      const tag = e.target.closest('.cf-filter-tag');
      if (!tag) return;
      const val = tag.dataset.value;
      if (filterSet.has(val)) {
        filterSet.delete(val);
        tag.classList.remove('cf-filter-tag-active');
      } else {
        filterSet.add(val);
        tag.classList.add('cf-filter-tag-active');
      }
    });
  };

  bindTagToggle('cf-filter-fundType',    activeFilters.fundType);
  bindTagToggle('cf-filter-fundManager', activeFilters.fundManager);
  bindTagToggle('cf-filter-subscribe',   activeFilters.subscribe);
  bindTagToggle('cf-filter-redeem',      activeFilters.redeem);

  const floatingEl = document.getElementById('cf-filter-floatingFee');
  if (floatingEl) {
    floatingEl.addEventListener('click', (e) => {
      const tag = e.target.closest('.cf-filter-tag');
      if (!tag) return;
      const val = tag.dataset.value;
      if (activeFilters.floatingFee === val) {
        activeFilters.floatingFee = '';
        tag.classList.remove('cf-filter-tag-active');
      } else {
        activeFilters.floatingFee = val;
        floatingEl.querySelectorAll('.cf-filter-tag').forEach(t => t.classList.remove('cf-filter-tag-active'));
        tag.classList.add('cf-filter-tag-active');
      }
    });
  }

  // fundManager 搜索框 (top-50 + 关键字过滤)
  const mgrSearch = document.getElementById('cf-filter-fundManager-search');
  if (mgrSearch) {
    let timer;
    mgrSearch.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        managerSearchQuery = mgrSearch.value || '';
        renderManagerTags();
      }, 120);
    });
  }

  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      readFiltersFromUI();
      updateFilterBadge();
      onChange();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetFilters();
      onChange();
    });
  }
}
