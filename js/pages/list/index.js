/** @typedef {{code:string,name:string,buyFee:number,annualFee:number,sellFeeSegments?:Array<{to:number|null,rate:number}>,trackingTarget?:string,fundManager?:string,performanceBenchmark?:string,tradingStatus?:{subscribe?:string,redeem?:string},initials?:string,fundType?:string,establishmentDate?:string,updatedAt?:string,source?:string,needsCrawl?:boolean,raw?:any}} CachedFundRow */

import { escapeHtml } from '../../utils/format.js';
import { getFeeApiBase } from '../../data/fund-api.js';
import { setupNarrowFilterDrawer, setupSidebarToggle } from './sidebar.js';
import { setupJsonModal } from './json-modal.js';
import { applyFilters, refreshFilterOptions, setupFilters } from './filters.js';
import { loadCachedFunds as fetchCachedFunds } from './data-loader.js';

/** @type {CachedFundRow[]} */
let allFunds = [];
/** 与主页 js/app.js 中 SESSION_COMPARE_FROM_CACHE_KEY 一致 */
const COMPARE_SESSION_KEY = 'fundCalCompareFromCache';
/** 去比较多选（迭代顺序 = 选中顺序） */
const selectedCompareCodes = new Set();
let currentPage = 1;
let pageSize = 100;
let totalPages = 1;

/** 当前排序配置：key 对应下拉框里的 code/name/buy/annual，dir 为 asc/desc */
let currentSort = { key: 'code', dir: 'asc' };

/** 按代码索引的基金原始详情；data-loader 与 json-modal 共享同一引用。 */
const fundDetailMap = {};

/** 统一搜索排序规则：与主页面基金卡片添加下拉栏保持一致 */
function getSearchScoreForRow(row, query) {
  const s = String(query || '').trim().toLowerCase();
  if (!s) return 999;
  const numOnly = s.replace(/\D/g, '');
  const code = (row.code || '').toLowerCase();
  const nameLower = (row.name || '').toLowerCase();
  const initials = (row.initials || '').toLowerCase();
  if (numOnly && code.startsWith(numOnly)) return 0;
  if (numOnly && code.includes(numOnly)) return 1;
  if (nameLower.startsWith(s)) return 2;
  if (initials && initials.startsWith(s)) return 3;
  return 4;
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '-';
  return (value * 100).toFixed(2) + '%';
}

function formatSellFeeSegments(segs) {
  if (!Array.isArray(segs) || !segs.length) return '-';
  const sorted = segs.slice().sort((a, b) => (a.to ?? Infinity) - (b.to ?? Infinity));
  let prev = 0;
  const parts = sorted.map(s => {
    const label = s.to == null ? `>${prev}天` : (prev > 0 ? `${prev}~${s.to}天` : `${s.to}天`);
    if (s.to != null) prev = s.to;
    const pct = formatPercent(s.rate ?? 0);
    return `${label}:${pct}`;
  });
  const maxParts = 4;
  return parts.length > maxParts
    ? parts.slice(0, maxParts).join('，') + '，…'
    : parts.join('，');
}

function setStatus(msg, isError = false) {
  const el = document.getElementById('cached-funds-status');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
}

function updateCompareFab() {
  const fab = document.getElementById('cached-funds-compare-fab');
  if (!fab) return;
  const n = selectedCompareCodes.size;
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

let _cachePageToastTimer = null;
function showToast(msg) {
  let el = document.getElementById('fund-floating-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fund-floating-toast';
    el.className = 'fund-floating-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(_cachePageToastTimer);
  _cachePageToastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
}

function setProgress(done, total) {
  const bar = document.getElementById('cached-funds-progress-bar');
  if (!bar) return;
  if (!total || total <= 0) {
    bar.style.width = '0%';
    return;
  }
  const pct = Math.max(0, Math.min(100, (done / total) * 100));
  bar.style.width = `${pct.toFixed(1)}%`;
}

function parseSortValue(val) {
  const safe = String(val || 'code-asc');
  const [key, dir] = safe.split('-');
  const normKey = (
    key === 'code' ||
    key === 'name' ||
    key === 'buy' ||
    key === 'annual' ||
    key === 'fundType' ||
    key === 'sellFee' ||
    key === 'trackingTarget' ||
    key === 'performanceBenchmark' ||
    key === 'fundManager' ||
    key === 'subscribe' ||
    key === 'redeem' ||
    key === 'updatedAt'
  ) ? key : 'code';
  const normDir = dir === 'desc' ? 'desc' : 'asc';
  return { key: normKey, dir: normDir };
}

function applySortToSelect() {
  const select = document.getElementById('cached-funds-sort');
  if (!select) return;
  const desired = `${currentSort.key}-${currentSort.dir}`;
  const options = Array.from(select.options || []);
  const exists = options.some(opt => opt.value === desired);
  if (exists) {
    select.value = desired;
  }
}

/**
 * 根据当前排序配置比较两行
 * @param {CachedFundRow} a
 * @param {CachedFundRow} b
 * @param {{key:string,dir:'asc'|'desc'}} sort
 */
function compareByCurrentSort(a, b, sort) {
  const { key, dir } = sort || currentSort;
  const factor = dir === 'desc' ? -1 : 1;
  if (key === 'code') {
    return factor * a.code.localeCompare(b.code);
  }
  if (key === 'name') {
    return factor * a.name.localeCompare(b.name, 'zh-CN');
  }
  if (key === 'annual') {
    return factor * ((a.annualFee ?? 0) - (b.annualFee ?? 0));
  }
  if (key === 'buy') {
    return factor * ((a.buyFee ?? 0) - (b.buyFee ?? 0));
  }
   if (key === 'fundType') {
     const av = a.fundType || '';
     const bv = b.fundType || '';
     return factor * av.localeCompare(bv, 'zh-CN');
   }
   if (key === 'establishmentDate') {
     const av = a.establishmentDate || '';
     const bv = b.establishmentDate || '';
     return factor * av.localeCompare(bv);
   }
   if (key === 'sellFee') {
     const ra = Array.isArray(a.sellFeeSegments) && a.sellFeeSegments.length ? (a.sellFeeSegments[0].rate ?? 0) : 0;
     const rb = Array.isArray(b.sellFeeSegments) && b.sellFeeSegments.length ? (b.sellFeeSegments[0].rate ?? 0) : 0;
     return factor * (ra - rb);
   }
   if (key === 'trackingTarget') {
     const av = (a.trackingTarget || '').trim();
     const bv = (b.trackingTarget || '').trim();
     return factor * av.localeCompare(bv, 'zh-CN');
   }
   if (key === 'performanceBenchmark') {
     const av = (a.performanceBenchmark || '').trim();
     const bv = (b.performanceBenchmark || '').trim();
     return factor * av.localeCompare(bv, 'zh-CN');
   }
   if (key === 'fundManager') {
     const av = (a.fundManager || '').trim();
     const bv = (b.fundManager || '').trim();
     return factor * av.localeCompare(bv, 'zh-CN');
   }
   if (key === 'subscribe') {
     const av = (a.tradingStatus?.subscribe || '').trim();
     const bv = (b.tradingStatus?.subscribe || '').trim();
     return factor * av.localeCompare(bv, 'zh-CN');
   }
   if (key === 'redeem') {
     const av = (a.tradingStatus?.redeem || '').trim();
     const bv = (b.tradingStatus?.redeem || '').trim();
     return factor * av.localeCompare(bv, 'zh-CN');
   }
   if (key === 'updatedAt') {
     const av = a.updatedAt || '';
     const bv = b.updatedAt || '';
     return factor * av.localeCompare(bv);
   }
  return 0;
}

function renderTable() {
  const tbody = document.getElementById('cached-funds-tbody');
  if (!tbody) return;
  const searchInput = document.getElementById('cached-funds-search');
  const query = searchInput?.value?.trim().toLowerCase() ?? '';

  /** @type {CachedFundRow[]} */
  let rows = allFunds.slice();
  if (query) {
    rows = rows.filter(f =>
      f.code.toLowerCase().includes(query) ||
      f.name.toLowerCase().includes(query) ||
      (f.initials && f.initials.toLowerCase().includes(query))
    );
  }

  // 应用筛选条件（作用于搜索结果之上）
  rows = applyFilters(rows);

  if (query) {
    rows.sort((a, b) => {
      const sa = getSearchScoreForRow(a, query);
      const sb = getSearchScoreForRow(b, query);
      if (sa !== sb) return sa - sb;
      return compareByCurrentSort(a, b, currentSort);
    });
  } else {
    rows.sort((a, b) => compareByCurrentSort(a, b, currentSort));
  }

  const total = rows.length;
  const localTotalPages = total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  totalPages = localTotalPages;
  if (currentPage > localTotalPages) currentPage = localTotalPages;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  const countEl = document.getElementById('cached-funds-count');
  const pageInfoEl = document.getElementById('cached-funds-page-info');
  const prevBtn = document.getElementById('cached-funds-prev');
  const nextBtn = document.getElementById('cached-funds-next');
  const pageInput = document.getElementById('cached-funds-page-input');

  if (countEl) {
    countEl.textContent = total ? `共 ${total} 只基金，当前显示第 ${start + 1}–${start + pageRows.length} 条` : '暂无基金数据';
  }
  if (pageInfoEl) {
    pageInfoEl.textContent = total ? `${currentPage} / ${localTotalPages}` : '0 / 0';
  }
  if (prevBtn) prevBtn.disabled = currentPage <= 1 || !total;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages || !total;
  if (pageInput) {
    if (total) {
      pageInput.disabled = false;
      pageInput.value = String(currentPage);
      pageInput.min = '1';
      pageInput.max = String(localTotalPages);
    } else {
      pageInput.disabled = true;
      pageInput.value = '';
    }
  }

  if (!pageRows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="14" class="cached-funds-empty">没有匹配的基金</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = pageRows.map(f => {
    const annualText = formatPercent(f.annualFee) + (f.raw && f.raw.isFloatingAnnualFee ? '（浮动）' : '');
    const isSel = selectedCompareCodes.has(f.code);
    const selClass = isSel ? ' cached-fund-row-selected' : '';
    if (f.needsCrawl) {
      // tushare-only 占位行：按 lifecycle 区分
      //   terminated (D) → 灰红「已终止」无按钮
      //   issuing    (I) → 蓝「募集中」可补全
      //   normal     (L) → 橙「待补全」可补全
      const lifecycle = f.lifecycle || 'normal';
      let badgeLabel, badgeClass, actionCell;
      if (lifecycle === 'terminated') {
        badgeLabel = '已终止';
        badgeClass = 'cached-fund-badge-terminated';
        actionCell = `<span class="cached-fund-action-disabled" title="该基金已退市，无费率详情">—</span>`;
      } else if (lifecycle === 'issuing') {
        badgeLabel = '募集中';
        badgeClass = 'cached-fund-badge-issuing';
        actionCell = `<button type="button" class="btn btn-sm cached-fund-crawl-btn" data-code="${escapeHtml(f.code)}" title="抓取该基金费率与详情">补全</button>`;
      } else {
        badgeLabel = '待补全';
        badgeClass = 'cached-fund-badge-pending';
        actionCell = `<button type="button" class="btn btn-sm cached-fund-crawl-btn" data-code="${escapeHtml(f.code)}" title="抓取该基金费率与详情">补全</button>`;
      }
      return `
    <tr class="cached-fund-row cached-fund-row-placeholder cached-fund-row-${lifecycle}" data-code="${escapeHtml(f.code)}" data-needs-crawl="true">
      <td>${actionCell}</td>
      <td>${escapeHtml(f.code)}</td>
      <td><span class="cached-fund-status-badge ${badgeClass}">${badgeLabel}</span> ${escapeHtml(f.name)}</td>
      <td>${escapeHtml(f.fundType || '-')}</td>
      <td>${escapeHtml(f.establishmentDate || '-')}</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>${escapeHtml(f.performanceBenchmark || '-')}</td>
      <td>${escapeHtml(f.fundManager || '-')}</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
    </tr>
  `;
    }
    // 已终止 + 有 crawler 数据：常规行 + 「已终止」徽标 + 灰显
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
    </tr>
  `;
  }).join('');
}

async function loadCachedFunds() {
  const funds = await fetchCachedFunds({ setStatus, setProgress, fundDetailMap });
  if (!funds) return;
  funds.sort((a, b) => a.code.localeCompare(b.code));
  allFunds = funds;
  setStatus(`已加载 ${allFunds.length} 只基金。`);
  refreshFilterOptions(allFunds);
  renderTable();
  updateCompareFab();
}

function setupEvents() {
  const searchInput = document.getElementById('cached-funds-search');
  const searchWrap = document.querySelector('.cached-funds-search-wrap');
  const searchClearBtn = document.getElementById('cached-funds-search-clear');
  const sortSelect = document.getElementById('cached-funds-sort');
  const prevBtn = document.getElementById('cached-funds-prev');
  const nextBtn = document.getElementById('cached-funds-next');
  const pageSizeSelect = document.getElementById('cached-funds-page-size');
  const pageInput = document.getElementById('cached-funds-page-input');
  const lastBtn = document.getElementById('cached-funds-last');

  /** @param {number} target */
  const goToPage = (target) => {
    if (!Number.isFinite(target)) return;
    if (target < 1) target = 1;
    if (target > totalPages) target = totalPages;
    if (!totalPages || target === currentPage) return;
    currentPage = target;
    renderTable();
  };
  if (searchInput) {
    let timer;
    const syncSearchUI = () => {
      const val = searchInput.value || '';
      if (searchWrap) {
        searchWrap.classList.toggle('has-value', !!val.trim());
      }
    };
    syncSearchUI();
    searchInput.addEventListener('focus', () => {
      if (searchWrap) searchWrap.classList.add('focused');
    });
    searchInput.addEventListener('blur', () => {
      if (searchWrap) searchWrap.classList.remove('focused');
    });
    searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      syncSearchUI();
      timer = setTimeout(() => {
        currentPage = 1;
        renderTable();
      }, 150);
    });
  }
  if (searchClearBtn && searchInput) {
    searchClearBtn.addEventListener('click', () => {
      if (!searchInput.value) return;
      searchInput.value = '';
      if (searchWrap) searchWrap.classList.remove('has-value');
      currentPage = 1;
      renderTable();
      searchInput.focus();
    });
  }
  if (sortSelect) {
    // 初始化 currentSort，使其与下拉框默认值保持一致
    currentSort = parseSortValue(sortSelect.value || 'code-asc');
    sortSelect.addEventListener('change', () => {
      currentSort = parseSortValue(sortSelect.value || 'code-asc');
      currentPage = 1;
      renderTable();
    });
  }

  // 表头点击排序：与下拉框联动
  const headerCells = document.querySelectorAll('.cached-funds-table thead th[data-sort-key]');
  if (headerCells && headerCells.length) {
    headerCells.forEach(th => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort-key');
        if (!key) return;
        /** 将表头 data-sort-key 映射到排序字段 */
        /** @type {'code'|'name'|'buy'|'annual'|'fundType'|'sellFee'|'trackingTarget'|'performanceBenchmark'|'fundManager'|'tradingStatus'|'updatedAt'} */
        let mappedKey = 'code';
        if (key === 'name') mappedKey = 'name';
        else if (key === 'buyFee') mappedKey = 'buy';
        else if (key === 'annualFee') mappedKey = 'annual';
        else if (key === 'fundType') mappedKey = 'fundType';
        else if (key === 'establishmentDate') mappedKey = 'establishmentDate';
        else if (key === 'sellFee') mappedKey = 'sellFee';
        else if (key === 'trackingTarget') mappedKey = 'trackingTarget';
        else if (key === 'performanceBenchmark') mappedKey = 'performanceBenchmark';
        else if (key === 'fundManager') mappedKey = 'fundManager';
        else if (key === 'subscribe') mappedKey = 'subscribe';
        else if (key === 'redeem') mappedKey = 'redeem';
        else if (key === 'updatedAt') mappedKey = 'updatedAt';

        if (currentSort.key === mappedKey) {
          currentSort = {
            key: mappedKey,
            dir: currentSort.dir === 'asc' ? 'desc' : 'asc'
          };
        } else {
          // 默认按字母顺序 / 数值从小到大排序（升序）
          currentSort = { key: mappedKey, dir: 'asc' };
        }
        applySortToSelect();
        currentPage = 1;
        renderTable();
      });
    });
  }
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage -= 1;
        renderTable();
      }
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      currentPage += 1;
      renderTable();
    });
  }
  if (pageInput) {
    pageInput.addEventListener('change', () => {
      const v = parseInt(pageInput.value, 10);
      if (!Number.isNaN(v)) {
        goToPage(v);
      }
    });
    pageInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        const v = parseInt(pageInput.value, 10);
        if (!Number.isNaN(v)) {
          goToPage(v);
        }
      }
    });
  }
  if (lastBtn) {
    lastBtn.addEventListener('click', () => {
      if (totalPages > 0) {
        goToPage(totalPages);
      }
    });
  }
  if (pageSizeSelect) {
    const val = parseInt(pageSizeSelect.value, 10);
    if (!Number.isNaN(val) && val > 0) pageSize = val;
    pageSizeSelect.addEventListener('change', () => {
      const n = parseInt(pageSizeSelect.value, 10);
      if (!Number.isNaN(n) && n > 0) {
        pageSize = n;
        currentPage = 1;
        renderTable();
      }
    });
  }

  // 表格行：单击切换「去比较」选中（不占用「查看」按钮）
  const tbody = document.getElementById('cached-funds-tbody');
  if (tbody) {
    const toggleRowSelect = (tr) => {
      if (!tr || !tr.classList.contains('cached-fund-row')) return;
      const code = (tr.dataset.code || '').trim();
      if (!code) return;
      if (selectedCompareCodes.has(code)) selectedCompareCodes.delete(code);
      else selectedCompareCodes.add(code);
      tr.classList.toggle('cached-fund-row-selected', selectedCompareCodes.has(code));
      tr.setAttribute('aria-selected', selectedCompareCodes.has(code) ? 'true' : 'false');
      updateCompareFab();
    };
    tbody.addEventListener('click', (e) => {
      if (e.target instanceof HTMLElement && e.target.closest('.cached-fund-json-btn')) return;
      if (e.target instanceof HTMLElement && e.target.closest('.cached-fund-crawl-btn')) return;
      const tr = e.target instanceof HTMLElement ? e.target.closest('tr.cached-fund-row') : null;
      if (!tr) return;
      if (tr.dataset.needsCrawl === 'true') return; // 占位行不参与多选
      toggleRowSelect(tr);
    });

    // 「补全」按钮：触发后端爬虫
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
        // 抓取并入 DB 已完成，直接拉新数据替换内存中该行
        try {
          const sep2 = base.endsWith('/') ? '' : '/';
          const detailRes = await fetch(`${base}${sep2}${code}`);
          if (detailRes.ok) {
            const detail = await detailRes.json();
            const idx = allFunds.findIndex(r => r.code === code);
            if (idx !== -1) {
              allFunds[idx] = {
                code,
                name: detail.name || code,
                buyFee: detail.buyFee ?? 0,
                annualFee: detail.annualFee ?? 0,
                sellFeeSegments: detail.sellFeeSegments ?? [],
                fundType: detail.fundType || '',
                establishmentDate: detail.establishmentDate || '',
                trackingTarget: detail.trackingTarget || '',
                performanceBenchmark: detail.performanceBenchmark || '',
                fundManager: detail.fundManager || '',
                tradingStatus: detail.tradingStatus || null,
                updatedAt: detail.updatedAt || '',
                initials: allFunds[idx].initials || '',
                source: detail.source || 'both',
                needsCrawl: false,
                raw: detail,
              };
              fundDetailMap[code] = detail;
            }
            renderTable();
            return;
          }
        } catch {}
        btn.textContent = '✓ 已抓取';
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
      if (selectedCompareCodes.size === 0) return;
      const items = Array.from(selectedCompareCodes).map(code => {
        const row = allFunds.find(f => f.code === code);
        return { code, name: row?.name || code };
      });
      try {
        sessionStorage.setItem(COMPARE_SESSION_KEY, JSON.stringify({ funds: items }));
      } catch {
        return;
      }
      window.location.hash = '#/calc';
    });
  }

  const jiuquanBtn = document.getElementById('cached-funds-jiuquan-btn');
  if (jiuquanBtn) {
    jiuquanBtn.addEventListener('click', () => {
      const codes = Array.from(selectedCompareCodes);
      if (!codes.length) return;
      window.open('https://app.jiucaishuo.com/pagesA/manager/fund_pk?code=' + codes.join(','), '_blank');
    });
  }

  // 基金详情弹窗（JSON / 表格双视图 + 外链）
  setupJsonModal({ tbody, fundDetailMap });
}

export function pageInit() {
  setupEvents();
  setupFilters({
    getAllFunds: () => allFunds,
    onChange: () => { currentPage = 1; renderTable(); },
  });
  setupNarrowFilterDrawer();
  setupSidebarToggle();
  loadCachedFunds();
}

