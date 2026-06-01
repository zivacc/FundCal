/**
 * 基金列表页 (服务端分页重构, 2026)。
 *
 * 数据流: 每次状态变更 (搜索/排序/筛选/翻页) → fetch /api/fund/list?page=...
 * 服务端做 filter+sort+page, 前端只持有当前页 rows + selected compare 集。
 *
 * AbortController 防竞态: 新请求发出时 abort 上一个未完成的请求, 防止旧响应覆盖新结果。
 */

import { escapeHtml } from '../../utils/format.js';
import { getFeeApiBase } from '../../data/fund-api.js';
import { setupNarrowFilterDrawer, setupSidebarToggle } from './sidebar.js';
import { setupJsonModal } from './json-modal.js';
import {
  setupFilters,
  applyOptions,
  getActiveFilters,
  setResultHint,
} from './filters.js';
import { loadFundsPage, loadFilterOptions } from './data-loader.js';

const COMPARE_SESSION_KEY = 'fundCalCompareFromCache';

/** 当前页 rows (仅本页, 非全集) */
let currentRows = [];
/** 选中比较: 保持插入顺序 + 同时持有 name (无全集可查) */
const selectedCompare = new Map(); // code → name
/** 详情弹窗按需 fetch 后写入 */
const fundDetailMap = {};

let currentPage = 1;
let pageSize = 100;
let total = 0;
let totalPages = 1;
let currentSort = { key: 'code', dir: 'asc' };
let currentQuery = '';
let currentFallback = false;   // 灾备模式 (纯静态部署) 时禁用筛选/排序

/** AbortController, 每次新请求重建 */
let inflightAbort = null;

/* ========== UI helpers ========== */

function formatPercent(v) {
  if (v == null || Number.isNaN(v)) return '-';
  return (v * 100).toFixed(2) + '%';
}

function formatSellFeeSegments(segs) {
  if (!Array.isArray(segs) || !segs.length) return '-';
  const sorted = segs.slice().sort((a, b) => (a.to ?? Infinity) - (b.to ?? Infinity));
  let prev = 0;
  const parts = sorted.map(s => {
    const label = s.to == null ? `>${prev}天` : (prev > 0 ? `${prev}~${s.to}天` : `${s.to}天`);
    if (s.to != null) prev = s.to;
    return `${label}:${formatPercent(s.rate ?? 0)}`;
  });
  return parts.length > 4 ? parts.slice(0, 4).join('，') + '，…' : parts.join('，');
}

function setStatus(msg, isError = false) {
  const el = document.getElementById('cached-funds-status');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
}

function setProgress(done, totalSteps) {
  const bar = document.getElementById('cached-funds-progress-bar');
  if (!bar) return;
  if (!totalSteps || totalSteps <= 0) { bar.style.width = '0%'; return; }
  bar.style.width = `${Math.max(0, Math.min(100, (done / totalSteps) * 100)).toFixed(1)}%`;
}

function updateCompareFab() {
  const fab = document.getElementById('cached-funds-compare-fab');
  if (!fab) return;
  const n = selectedCompare.size;
  fab.hidden = n === 0;
  const compareBtn = document.getElementById('cached-funds-compare-btn');
  if (compareBtn) compareBtn.textContent = n > 0 ? `去比较 (${n})` : '去比较';
  const jiuquanBtn = document.getElementById('cached-funds-jiuquan-btn');
  if (jiuquanBtn) {
    if (n <= 0) jiuquanBtn.textContent = '去韭圈儿';
    else if (n > 6) jiuquanBtn.textContent = `去韭圈儿 (${n}) ⚠超6只`;
    else jiuquanBtn.textContent = `去韭圈儿 (${n})`;
  }
}

function parseSortValue(val) {
  const safe = String(val || 'code-asc');
  const [key, dir] = safe.split('-');
  const valid = new Set([
    'code','name','buy','annual','fundType','sellFee','trackingTarget',
    'performanceBenchmark','fundManager','subscribe','redeem','updatedAt','establishmentDate',
  ]);
  const normKey = valid.has(key) ? key : 'code';
  return { key: normKey, dir: dir === 'desc' ? 'desc' : 'asc' };
}

/** 把前端 sort key 映射到 API 用的 key (差异: 'buy' → 'buyFee', 'annual' → 'annualFee') */
function toApiSortKey(key) {
  if (key === 'buy') return 'buyFee';
  if (key === 'annual') return 'annualFee';
  return key;
}

function applySortToSelect() {
  const select = document.getElementById('cached-funds-sort');
  if (!select) return;
  const desired = `${currentSort.key}-${currentSort.dir}`;
  if (Array.from(select.options || []).some(o => o.value === desired)) {
    select.value = desired;
  }
}

/* ========== 渲染 ========== */

function renderRow(f) {
  const isSel = selectedCompare.has(f.code);
  const selClass = isSel ? ' cached-fund-row-selected' : '';
  const annualText = formatPercent(f.annualFee) + (f.isFloatingAnnualFee ? '（浮动）' : '');

  if (f.needsCrawl) {
    const lifecycle = f.lifecycle || 'normal';
    let badgeLabel, badgeClass, actionCell;
    if (lifecycle === 'terminated') {
      badgeLabel = '已终止'; badgeClass = 'cached-fund-badge-terminated';
      actionCell = `<span class="cached-fund-action-disabled" title="该基金已退市，无费率详情">—</span>`;
    } else if (lifecycle === 'issuing') {
      badgeLabel = '募集中'; badgeClass = 'cached-fund-badge-issuing';
      actionCell = `<button type="button" class="btn btn-sm cached-fund-crawl-btn" data-code="${escapeHtml(f.code)}" title="抓取该基金费率与详情">补全</button>`;
    } else {
      badgeLabel = '待补全'; badgeClass = 'cached-fund-badge-pending';
      actionCell = `<button type="button" class="btn btn-sm cached-fund-crawl-btn" data-code="${escapeHtml(f.code)}" title="抓取该基金费率与详情">补全</button>`;
    }
    return `
      <tr class="cached-fund-row cached-fund-row-placeholder cached-fund-row-${lifecycle}" data-code="${escapeHtml(f.code)}" data-needs-crawl="true">
        <td>${actionCell}</td>
        <td>${escapeHtml(f.code)}</td>
        <td><span class="cached-fund-status-badge ${badgeClass}">${badgeLabel}</span> ${escapeHtml(f.name)}</td>
        <td>${escapeHtml(f.fundType || '-')}</td>
        <td>${escapeHtml(f.establishmentDate || '-')}</td>
        <td>-</td><td>-</td><td>-</td><td>-</td>
        <td>${escapeHtml(f.performanceBenchmark || '-')}</td>
        <td>${escapeHtml(f.fundManager || '-')}</td>
        <td>-</td><td>-</td><td>-</td>
      </tr>`;
  }

  const isTerminated = f.lifecycle === 'terminated';
  const terminatedClass = isTerminated ? ' cached-fund-row-terminated' : '';
  const namePrefix = isTerminated
    ? '<span class="cached-fund-status-badge cached-fund-badge-terminated">已终止</span> '
    : '';
  return `
    <tr class="cached-fund-row${selClass}${terminatedClass}" data-code="${escapeHtml(f.code)}" tabindex="0" aria-selected="${isSel ? 'true' : 'false'}">
      <td><button type="button" class="btn btn-sm cached-fund-json-btn" data-code="${escapeHtml(f.code)}">查看</button></td>
      <td>${escapeHtml(f.code)}</td>
      <td>${namePrefix}${escapeHtml(f.name)}</td>
      <td>${escapeHtml(f.fundType || '-')}</td>
      <td>${escapeHtml(f.establishmentDate || '-')}</td>
      <td>${formatPercent(f.buyFee)}</td>
      <td>${annualText}</td>
      <td>${formatSellFeeSegments(f.sellFeeSegments)}</td>
      <td>${escapeHtml(f.trackingTarget || '-')}</td>
      <td>${escapeHtml(f.performanceBenchmark || '-')}</td>
      <td>${escapeHtml(f.fundManager || '-')}</td>
      <td>${escapeHtml(f.tradingStatus?.subscribe || '-')}</td>
      <td>${escapeHtml(f.tradingStatus?.redeem || '-')}</td>
      <td>${escapeHtml(f.updatedAt || '-')}</td>
    </tr>`;
}

function renderTable() {
  const tbody = document.getElementById('cached-funds-tbody');
  if (!tbody) return;

  totalPages = total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * pageSize;

  const countEl    = document.getElementById('cached-funds-count');
  const pageInfoEl = document.getElementById('cached-funds-page-info');
  const prevBtn    = document.getElementById('cached-funds-prev');
  const nextBtn    = document.getElementById('cached-funds-next');
  const pageInput  = document.getElementById('cached-funds-page-input');

  if (countEl) {
    countEl.textContent = total
      ? `共 ${total} 只基金，当前显示第 ${start + 1}–${start + currentRows.length} 条`
      : '暂无基金数据';
  }
  if (pageInfoEl) pageInfoEl.textContent = total ? `${currentPage} / ${totalPages}` : '0 / 0';
  if (prevBtn) prevBtn.disabled = currentPage <= 1 || !total;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages || !total;
  if (pageInput) {
    if (total) {
      pageInput.disabled = false;
      pageInput.value = String(currentPage);
      pageInput.min = '1';
      pageInput.max = String(totalPages);
    } else {
      pageInput.disabled = true;
      pageInput.value = '';
    }
  }

  if (!currentRows.length) {
    tbody.innerHTML = `<tr><td colspan="14" class="cached-funds-empty">没有匹配的基金</td></tr>`;
    return;
  }
  tbody.innerHTML = currentRows.map(renderRow).join('');
}

/* ========== 数据获取 (核心) ========== */

/** 重新拉当前状态对应的一页数据并渲染 */
async function refresh() {
  if (inflightAbort) { try { inflightAbort.abort(); } catch {} }
  inflightAbort = new AbortController();
  const signal = inflightAbort.signal;

  setStatus('加载中...');
  setProgress(0, 1);
  const t0 = performance.now();
  try {
    const data = await loadFundsPage({
      page: currentPage,
      size: pageSize,
      q: currentQuery,
      sort: `${toApiSortKey(currentSort.key)}:${currentSort.dir}`,
      filters: getActiveFilters(),
      signal,
    });
    if (signal.aborted) return;
    total = data.total || 0;
    currentRows = data.rows || [];
    currentFallback = !!data.fallback;
    setProgress(1, 1);
    setStatus(`共 ${total} 只基金 (${(performance.now() - t0).toFixed(0)} ms)`);
    setResultHint(total);
    renderTable();
    updateCompareFab();
  } catch (err) {
    if (signal.aborted) return;
    console.error('[list] fetch failed:', err);
    setStatus('加载失败: ' + (err?.message || err), true);
  }
}

/* ========== 事件 ========== */

function setupEvents() {
  const searchInput     = document.getElementById('cached-funds-search');
  const searchWrap      = document.querySelector('.cached-funds-search-wrap');
  const searchClearBtn  = document.getElementById('cached-funds-search-clear');
  const sortSelect      = document.getElementById('cached-funds-sort');
  const prevBtn         = document.getElementById('cached-funds-prev');
  const nextBtn         = document.getElementById('cached-funds-next');
  const pageSizeSelect  = document.getElementById('cached-funds-page-size');
  const pageInput       = document.getElementById('cached-funds-page-input');
  const lastBtn         = document.getElementById('cached-funds-last');

  const goToPage = (target) => {
    if (!Number.isFinite(target)) return;
    target = Math.max(1, Math.min(totalPages, target));
    if (!total || target === currentPage) return;
    currentPage = target;
    refresh();
  };

  if (searchInput) {
    let timer;
    const syncUI = () => {
      if (searchWrap) searchWrap.classList.toggle('has-value', !!(searchInput.value || '').trim());
    };
    syncUI();
    searchInput.addEventListener('focus', () => searchWrap?.classList.add('focused'));
    searchInput.addEventListener('blur',  () => searchWrap?.classList.remove('focused'));
    searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      syncUI();
      timer = setTimeout(() => {
        currentQuery = (searchInput.value || '').trim();
        currentPage = 1;
        refresh();
      }, 150);
    });
  }
  if (searchClearBtn && searchInput) {
    searchClearBtn.addEventListener('click', () => {
      if (!searchInput.value) return;
      searchInput.value = '';
      searchWrap?.classList.remove('has-value');
      currentQuery = '';
      currentPage = 1;
      refresh();
      searchInput.focus();
    });
  }
  if (sortSelect) {
    currentSort = parseSortValue(sortSelect.value || 'code-asc');
    sortSelect.addEventListener('change', () => {
      currentSort = parseSortValue(sortSelect.value || 'code-asc');
      currentPage = 1;
      refresh();
    });
  }
  // 表头点击排序
  document.querySelectorAll('.cached-funds-table thead th[data-sort-key]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort-key');
      if (!key) return;
      const keyMap = { name:'name', buyFee:'buy', annualFee:'annual', fundType:'fundType',
        establishmentDate:'establishmentDate', sellFee:'sellFee', trackingTarget:'trackingTarget',
        performanceBenchmark:'performanceBenchmark', fundManager:'fundManager',
        subscribe:'subscribe', redeem:'redeem', updatedAt:'updatedAt' };
      const mapped = keyMap[key] || 'code';
      if (currentSort.key === mapped) {
        currentSort = { key: mapped, dir: currentSort.dir === 'asc' ? 'desc' : 'asc' };
      } else {
        currentSort = { key: mapped, dir: 'asc' };
      }
      applySortToSelect();
      currentPage = 1;
      refresh();
    });
  });
  if (prevBtn) prevBtn.addEventListener('click', () => goToPage(currentPage - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => goToPage(currentPage + 1));
  if (lastBtn) lastBtn.addEventListener('click', () => totalPages && goToPage(totalPages));
  if (pageInput) {
    const handle = () => {
      const v = parseInt(pageInput.value, 10);
      if (!Number.isNaN(v)) goToPage(v);
    };
    pageInput.addEventListener('change', handle);
    pageInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') handle(); });
  }
  if (pageSizeSelect) {
    const initVal = parseInt(pageSizeSelect.value, 10);
    if (!Number.isNaN(initVal) && initVal > 0) pageSize = initVal;
    pageSizeSelect.addEventListener('change', () => {
      const n = parseInt(pageSizeSelect.value, 10);
      if (!Number.isNaN(n) && n > 0) {
        pageSize = n;
        currentPage = 1;
        refresh();
      }
    });
  }

  // 表格行: 切换选中比较 / 触发爬虫补全
  const tbody = document.getElementById('cached-funds-tbody');
  if (tbody) {
    const toggleRowSelect = (tr) => {
      if (!tr || !tr.classList.contains('cached-fund-row')) return;
      const code = (tr.dataset.code || '').trim();
      if (!code) return;
      if (selectedCompare.has(code)) {
        selectedCompare.delete(code);
      } else {
        const row = currentRows.find(r => r.code === code);
        selectedCompare.set(code, row?.name || code);
      }
      tr.classList.toggle('cached-fund-row-selected', selectedCompare.has(code));
      tr.setAttribute('aria-selected', selectedCompare.has(code) ? 'true' : 'false');
      updateCompareFab();
    };
    tbody.addEventListener('click', (e) => {
      if (e.target instanceof HTMLElement && e.target.closest('.cached-fund-json-btn')) return;
      if (e.target instanceof HTMLElement && e.target.closest('.cached-fund-crawl-btn')) return;
      const tr = e.target instanceof HTMLElement ? e.target.closest('tr.cached-fund-row') : null;
      if (!tr) return;
      if (tr.dataset.needsCrawl === 'true') return;
      toggleRowSelect(tr);
    });
    tbody.addEventListener('click', async (e) => {
      const btn = e.target instanceof HTMLElement ? e.target.closest('.cached-fund-crawl-btn') : null;
      if (!btn) return;
      const code = btn.getAttribute('data-code') || '';
      if (!code) return;
      const base = getFeeApiBase();
      if (!base) {
        alert('当前部署模式不支持触发爬取（无后端 API）。请在本地或 VPS 部署运行。');
        return;
      }
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = '抓取中...';
      try {
        const sep = base.endsWith('/') ? '' : '/';
        const res = await fetch(`${base}${sep}${code}/crawl`, { method: 'POST' });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.ok === false) {
          alert(`抓取失败：${j.stderr || j.error || res.status}`);
          btn.textContent = original;
          btn.disabled = false;
          return;
        }
        refresh();  // 重拉当前页即可显示新数据
      } catch (err) {
        alert('抓取请求异常：' + (err && err.message || err));
        btn.textContent = original;
        btn.disabled = false;
      }
    });
    tbody.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const tr = t.closest('tr.cached-fund-row');
      if (!tr) return;
      e.preventDefault();
      toggleRowSelect(tr);
    });
  }

  const compareBtn = document.getElementById('cached-funds-compare-btn');
  if (compareBtn) {
    compareBtn.addEventListener('click', () => {
      if (selectedCompare.size === 0) return;
      const items = Array.from(selectedCompare.entries()).map(([code, name]) => ({ code, name }));
      try {
        sessionStorage.setItem(COMPARE_SESSION_KEY, JSON.stringify({ funds: items }));
      } catch { return; }
      window.location.hash = '#/calc';
    });
  }
  const jiuquanBtn = document.getElementById('cached-funds-jiuquan-btn');
  if (jiuquanBtn) {
    jiuquanBtn.addEventListener('click', () => {
      const codes = Array.from(selectedCompare.keys());
      if (!codes.length) return;
      window.open('https://app.jiucaishuo.com/pagesA/manager/fund_pk?code=' + codes.join(','), '_blank');
    });
  }

  setupJsonModal({ tbody, fundDetailMap });
}

/* ========== bootstrap ========== */

export function pageInit() {
  setupEvents();
  setupFilters({ onChange: () => { currentPage = 1; refresh(); } });
  setupNarrowFilterDrawer();
  setupSidebarToggle();

  // 并行: 拉 filter-options + 首页数据
  loadFilterOptions().then(opts => {
    if (opts) applyOptions(opts);
  }).catch(() => {});
  refresh();
}
