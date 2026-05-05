/**
 * 缓存基金列表页 —— 筛选条件状态 + UI 事件。
 *
 * 设计：把可变筛选状态封装在模块作用域里，对外只暴露最小必要 API：
 * - applyFilters(rows)         —— 按当前筛选条件过滤一组行（pure 视角，仅读 state）
 * - countActiveFilters()       —— 当前激活了几条筛选；UI 用来刷新徽标 / 结果提示
 * - refreshFilterOptions(rows) —— 数据加载完后据 rows 重建标签按钮（基金类型 / 公司 / 申购 / 赎回）
 * - refreshResultHint(rows)    —— 刷新「N / Total 只基金符合条件」的提示文案
 * - setupFilters(opts)         —— 一次性绑定全部筛选 UI 事件，需要外部注入 getAllFunds() + onChange()
 *
 * 之所以把"工厂注入回调"，是因为应用筛选后还需要：
 *   1. 重置 currentPage = 1（分页器在 index.js 里）
 *   2. 触发 renderTable()
 * 这两步不属于 filters 自身职责，由调用方在 onChange 中完成。
 */

import { escapeHtml } from '../../utils/format.js';

/** 默认筛选状态：每次 reset 都从这里克隆。 */
function makeEmptyState() {
  return {
    fundType: new Set(),
    fundManager: new Set(),
    subscribe: new Set(),
    redeem: new Set(),
    floatingFee: '',      // '' | 'yes' | 'no'
    buyFeeMin: null,
    buyFeeMax: null,
    annualFeeMin: null,
    annualFeeMax: null,
    trackingTarget: '',
  };
}

let activeFilters = makeEmptyState();

/* ========== 对外：纯函数 / 状态查询 ========== */

/**
 * 按当前筛选条件过滤一组行；不会修改入参。
 * @template {Record<string, any>} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function applyFilters(rows) {
  const f = activeFilters;
  return rows.filter(r => {
    if (f.fundType.size && !f.fundType.has(r.fundType || '')) return false;
    if (f.fundManager.size && !f.fundManager.has(r.fundManager || '')) return false;
    if (f.subscribe.size) {
      const sv = (r.tradingStatus?.subscribe || '').trim() || '-';
      if (!f.subscribe.has(sv)) return false;
    }
    if (f.redeem.size) {
      const rv = (r.tradingStatus?.redeem || '').trim() || '-';
      if (!f.redeem.has(rv)) return false;
    }
    if (f.floatingFee === 'yes' && !(r.raw && r.raw.isFloatingAnnualFee)) return false;
    if (f.floatingFee === 'no' && (r.raw && r.raw.isFloatingAnnualFee)) return false;
    if (f.buyFeeMin != null && (r.buyFee ?? 0) < f.buyFeeMin) return false;
    if (f.buyFeeMax != null && (r.buyFee ?? 0) > f.buyFeeMax) return false;
    if (f.annualFeeMin != null && (r.annualFee ?? 0) < f.annualFeeMin) return false;
    if (f.annualFeeMax != null && (r.annualFee ?? 0) > f.annualFeeMax) return false;
    if (f.trackingTarget) {
      const kw = f.trackingTarget.toLowerCase();
      if (!(r.trackingTarget || '').toLowerCase().includes(kw)) return false;
    }
    return true;
  });
}

/** 当前激活了几条筛选条件（用于徽标显示）。 */
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

/* ========== 对外：UI 同步 ========== */

/**
 * 据当前数据集重建可选项标签（按出现频次倒序）。
 * 一般在 loadCachedFunds 之后调用一次，重置时也会自动调用。
 * @param {Array<Record<string, any>>} allFunds
 */
export function refreshFilterOptions(allFunds) {
  const fundTypes = new Map();
  const managers  = new Map();
  const subscribes = new Map();
  const redeems    = new Map();

  for (const f of allFunds) {
    const ft = f.fundType || '';
    if (ft) fundTypes.set(ft, (fundTypes.get(ft) || 0) + 1);
    const fm = f.fundManager || '';
    if (fm) managers.set(fm, (managers.get(fm) || 0) + 1);
    const sv = (f.tradingStatus?.subscribe || '').trim();
    if (sv) subscribes.set(sv, (subscribes.get(sv) || 0) + 1);
    const rv = (f.tradingStatus?.redeem || '').trim();
    if (rv) redeems.set(rv, (redeems.get(rv) || 0) + 1);
  }

  const renderTags = (containerEl, map, filterSet) => {
    if (!containerEl) return;
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    containerEl.innerHTML = sorted.map(([label, count]) => {
      const active = filterSet.has(label) ? ' cf-filter-tag-active' : '';
      return `<button type="button" class="cf-filter-tag${active}" data-value="${escapeHtml(label)}">${escapeHtml(label)} <small>(${count})</small></button>`;
    }).join('');
  };

  renderTags(document.getElementById('cf-filter-fundType'),    fundTypes,  activeFilters.fundType);
  renderTags(document.getElementById('cf-filter-fundManager'), managers,   activeFilters.fundManager);
  renderTags(document.getElementById('cf-filter-subscribe'),   subscribes, activeFilters.subscribe);
  renderTags(document.getElementById('cf-filter-redeem'),      redeems,    activeFilters.redeem);

  // 浮动费率 是固定二选一，不依赖数据
  const floatingEl = document.getElementById('cf-filter-floatingFee');
  if (floatingEl) {
    floatingEl.innerHTML = ['yes', 'no'].map(v => {
      const label = v === 'yes' ? '仅浮动费率' : '排除浮动费率';
      const active = activeFilters.floatingFee === v ? ' cf-filter-tag-active' : '';
      return `<button type="button" class="cf-filter-tag${active}" data-value="${v}">${label}</button>`;
    }).join('');
  }
}

/** 顶部筛选数量徽标（红色小圆圈里的数字）。 */
function updateFilterBadge() {
  const el = document.getElementById('cf-filter-active-count');
  if (!el) return;
  const n = countActiveFilters();
  el.textContent = n > 0 ? `(${n})` : '';
}

/**
 * 「N / Total 只基金符合条件」的实时提示。
 * @param {Array<Record<string, any>>} allFunds
 */
export function refreshResultHint(allFunds) {
  const el = document.getElementById('cf-filter-result-hint');
  if (!el) return;
  const n = countActiveFilters();
  if (n === 0) { el.textContent = ''; return; }
  const total = allFunds.length;
  const filtered = applyFilters(allFunds).length;
  el.textContent = `${filtered} / ${total} 只基金符合条件`;
}

/* ========== 内部：UI ↔ state 同步 ========== */

/** 把数值输入框（百分比）反序列化进 activeFilters */
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

/** 重置所有筛选条件 + 清空对应输入框，重建标签按钮。 */
function resetFilters(getAllFunds) {
  activeFilters = makeEmptyState();
  const ids = [
    'cf-filter-buyFee-min', 'cf-filter-buyFee-max',
    'cf-filter-annualFee-min', 'cf-filter-annualFee-max',
    'cf-filter-trackingTarget',
  ];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  refreshFilterOptions(getAllFunds());
  updateFilterBadge();
}

/* ========== 对外：一次性绑定 UI ========== */

/**
 * 绑定全部筛选 UI 事件（折叠 / 标签开关 / 应用 / 重置）。
 * 需要调用方提供：
 * - getAllFunds(): 返回当前完整数据集（用于重置后重建标签 / 计算结果提示）
 * - onChange():    应用 / 重置后调用，由 index.js 负责重置分页与重渲染
 *
 * @param {Object} opts
 * @param {() => Array<Record<string, any>>} opts.getAllFunds
 * @param {() => void} opts.onChange
 */
export function setupFilters({ getAllFunds, onChange }) {
  const bar       = document.querySelector('.cf-filter-bar');
  const toggleBtn = document.getElementById('cf-filter-toggle');
  const panel     = document.getElementById('cf-filter-panel');
  const applyBtn  = document.getElementById('cf-filter-apply');
  const resetBtn  = document.getElementById('cf-filter-reset');

  // 整栏的折叠 / 展开
  if (toggleBtn && panel && bar) {
    toggleBtn.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      bar.classList.toggle('cf-filter-open', open);
    });
  }

  // 多选标签：点击切换
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

  // 浮动费率：单选语义（再点一次取消）
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

  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      readFiltersFromUI();
      updateFilterBadge();
      refreshResultHint(getAllFunds());
      onChange();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetFilters(getAllFunds);
      refreshResultHint(getAllFunds());
      onChange();
    });
  }
}
