/** @typedef {{code:string,name:string,buyFee:number,annualFee:number,sellFeeSegments?:Array<{days:number,rate:number,unbounded?:boolean}>,trackingTarget?:string,fundManager?:string,performanceBenchmark?:string,tradingStatus?:{subscribe?:string,redeem?:string},initials?:string,fundType?:string,updatedAt?:string,raw?:any}} CachedFundRow */

/** @type {CachedFundRow[]} */
let allFunds = [];
let currentPage = 1;
let pageSize = 100;
let totalPages = 1;

/** 当前排序配置：key 对应下拉框里的 code/name/buy/annual，dir 为 asc/desc */
let currentSort = { key: 'code', dir: 'asc' };

/** 保存 allfund.json 中的原始数据，按代码索引，便于弹窗中展示完整字段 */
const fundDetailMap = {};

/** allfund 原始 store 缓存，避免反复读取大文件 */
let allfundStoreCache = null;
let allfundStoreLoading = null;

/**
 * 确保已加载 allfund.json，并返回按代码索引的原始对象
 * @returns {Promise<Record<string, any>>}
 */
async function ensureAllfundStore() {
  if (allfundStoreCache) return allfundStoreCache;
  if (allfundStoreLoading) return allfundStoreLoading;
  allfundStoreLoading = (async () => {
    try {
      const res = await fetch('data/allfund/allfund.json').catch(() => null);
      if (!res || !res.ok) return {};
      const data = await res.json();
      const store = data.funds || data || {};
      /** @type {Record<string, any>} */
      const byCode = {};
      for (const code of Object.keys(store)) {
        byCode[code] = store[code];
        fundDetailMap[code] = store[code];
      }
      allfundStoreCache = byCode;
      return byCode;
    } catch {
      allfundStoreCache = {};
      return {};
    } finally {
      allfundStoreLoading = null;
    }
  })();
  return allfundStoreLoading;
}

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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTradingStatus(status) {
  if (!status || ( !status.subscribe && !status.redeem)) return '-';
  const parts = [];
  if (status.subscribe) parts.push(`申购：${status.subscribe}`);
  if (status.redeem) parts.push(`赎回：${status.redeem}`);
  return parts.join('，');
}

function formatSellFeeSegments(segs) {
  if (!Array.isArray(segs) || !segs.length) return '-';
  const sorted = segs.slice().sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  const parts = sorted.map(s => {
    const label = s.unbounded ? `≥${s.days}天` : `${s.days}天`;
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

function getSortConfig() {
  return currentSort;
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
    key === 'tradingStatus' ||
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
   if (key === 'tradingStatus') {
     const av = formatTradingStatus(a.tradingStatus || {});
     const bv = formatTradingStatus(b.tradingStatus || {});
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
    // 有搜索关键字时：先按匹配度排序，再按照当前排序配置细化顺序
    rows.sort((a, b) => {
      const sa = getSearchScoreForRow(a, query);
      const sb = getSearchScoreForRow(b, query);
      if (sa !== sb) return sa - sb;
      return compareByCurrentSort(a, b, currentSort);
    });
  } else {
    // 无搜索关键字时，仅按当前排序配置排序
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
        <td colspan="12" class="cached-funds-empty">没有匹配的基金</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = pageRows.map(f => {
    const annualText = formatPercent(f.annualFee) + (f.raw && f.raw.isFloatingAnnualFee ? '（浮动）' : '');
    return `
    <tr>
      <td><button type="button" class="btn btn-sm cached-fund-json-btn" data-code="${escapeHtml(f.code)}">查看</button></td>
      <td>${escapeHtml(f.code)}</td>
      <td>${escapeHtml(f.name)}</td>
      <td>${escapeHtml(f.fundType || '-')}</td>
      <td>${formatPercent(f.buyFee)}</td>
      <td>${annualText}</td>
      <td>${formatSellFeeSegments(f.sellFeeSegments)}</td>
      <td>${escapeHtml(f.trackingTarget || '-')}</td>
      <td>${escapeHtml(f.performanceBenchmark || '-')}</td>
      <td>${escapeHtml(f.fundManager || '-')}</td>
      <td>${escapeHtml(formatTradingStatus(f.tradingStatus))}</td>
      <td>${escapeHtml(f.updatedAt || '-')}</td>
    </tr>
  `;
  }).join('');
}

async function loadCachedFunds() {
  try {
    setStatus('正在读取缓存基金列表...');
    setProgress(0, 1);

    // 优化：优先读取轻量级的 list-index.json，而不是庞大的 allfund.json
    const indexRes = await fetch('data/allfund/list-index.json').catch(() => null);
    
    if (!indexRes || !indexRes.ok) {
      // 如果 list-index.json 不存在，则回退到原来的 allfund.json (保证向后兼容)
      const store = await ensureAllfundStore();
      const codes = Object.keys(store);
      
      const results = [];
      for (const code of codes) {
        const f = store[code];
        if (!f) continue;
        results.push({
          code: f.code || code,
          name: f.name || code,
          buyFee: f.buyFee ?? 0,
          annualFee: f.annualFee ?? (f.operationFees?.total ?? 0),
          sellFeeSegments: f.sellFeeSegments ?? f.redeemSegments ?? [],
          fundType: f.fundType || '',
          trackingTarget: f.trackingTarget || '',
          performanceBenchmark: f.performanceBenchmark || '',
          fundManager: f.fundManager || '',
          tradingStatus: f.tradingStatus || null,
          updatedAt: f.updatedAt || '',
          raw: f
        });
      }
      allFunds = results;
    } else {
      // 使用分片索引数据（轻量），再用 allfund 补全详情字段
      const list = await indexRes.json();
      const store = await ensureAllfundStore();
      allFunds = list.map((row) => {
        const code = row.code || row.fundCode || '';
        const origin = code && store[code] ? store[code] : null;
        if (origin) {
          fundDetailMap[code] = origin;
        }
        return {
          code,
          name: row.name || code,
          buyFee: row.buyFee ?? origin?.buyFee ?? 0,
          annualFee: row.annualFee ?? origin?.annualFee ?? (origin?.operationFees?.total ?? 0),
          sellFeeSegments: row.sellFeeSegments ?? origin?.sellFeeSegments ?? origin?.redeemSegments ?? [],
          fundType: row.fundType || origin?.fundType || '',
          trackingTarget: row.trackingTarget || origin?.trackingTarget || '',
          performanceBenchmark: row.performanceBenchmark || origin?.performanceBenchmark || '',
          fundManager: row.fundManager || origin?.fundManager || '',
          tradingStatus: row.tradingStatus || origin?.tradingStatus || null,
          updatedAt: row.updatedAt || origin?.updatedAt || '',
          initials: row.initials || '',
          raw: origin || row
        };
      });
    }

    setProgress(1, 1);
    allFunds.sort((a, b) => a.code.localeCompare(b.code));
    setStatus(`已加载 ${allFunds.length} 只基金。`);
    renderTable();
  } catch (e) {
    setStatus('从本地汇总文件加载缓存基金失败。', true);
  }
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

  const jsonModal = document.getElementById('fund-json-modal');
  const jsonContent = document.getElementById('fund-json-content');
  const jsonTable = document.getElementById('fund-json-table');
  const jsonCloseBtn = document.getElementById('fund-json-close');
  const jsonCancelBtn = document.getElementById('fund-json-cancel');
  const jsonToTableBtn = document.getElementById('fund-json-to-table');

  /** @type {any|null} */
  let currentFundDetail = null;
  /** @type {'json'|'table'} */
  let currentFundViewMode = 'json';

  function openModal(backdrop) {
    if (!backdrop) return;
    backdrop.classList.add('modal-visible');
    backdrop.setAttribute('aria-hidden', 'false');
  }

  function closeModal(backdrop) {
    if (!backdrop) return;
    backdrop.classList.remove('modal-visible');
    backdrop.setAttribute('aria-hidden', 'true');
  }

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
        else if (key === 'sellFee') mappedKey = 'sellFee';
        else if (key === 'trackingTarget') mappedKey = 'trackingTarget';
        else if (key === 'performanceBenchmark') mappedKey = 'performanceBenchmark';
        else if (key === 'fundManager') mappedKey = 'fundManager';
        else if (key === 'tradingStatus') mappedKey = 'tradingStatus';
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

  // 表格中点击「查看」按钮，展示对应基金的完整原始数据
  const tbody = document.getElementById('cached-funds-tbody');
  if (tbody && jsonModal && jsonContent && jsonTable) {
    tbody.addEventListener('click', async (e) => {
      const target = /** @type {HTMLElement|null} */ (e.target instanceof HTMLElement ? e.target.closest('.cached-fund-json-btn') : null);
      if (!target) return;
      const code = target.getAttribute('data-code') || '';
      if (!code) return;

      // 优化：如果内存中没有详情，则按需从分片文件加载
      let detail = fundDetailMap[code] || null;
      if (!detail) {
        try {
          const res = await fetch(`data/allfund/funds/${code}.json`);
          if (res.ok) {
            detail = await res.json();
            fundDetailMap[code] = detail;
          }
        } catch (err) {
          console.error('加载基金详情失败:', err);
        }
      }

      currentFundDetail = detail;
      if (!detail) {
        currentFundViewMode = 'json';
        jsonContent.textContent = `无法加载代码为 ${code} 的详细数据。`;
        jsonContent.style.display = 'block';
        jsonTable.style.display = 'none';
        if (jsonToTableBtn) jsonToTableBtn.textContent = '转为表格';
      } else {
        // 默认以表格视图展示
        currentFundViewMode = 'table';
        jsonContent.textContent = JSON.stringify(detail, null, 2);
        renderFundDetailAsTable(detail);
        jsonContent.style.display = 'none';
        jsonTable.style.display = 'block';
        if (jsonToTableBtn) jsonToTableBtn.textContent = '查看 JSON';
      }
      openModal(jsonModal);
    });
  }

  [jsonCloseBtn, jsonCancelBtn].forEach(btn => {
    if (!btn || !jsonModal) return;
    btn.addEventListener('click', () => closeModal(jsonModal));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && jsonModal && jsonModal.classList.contains('modal-visible')) {
      closeModal(jsonModal);
    }
  });

  function renderFundDetailAsTable(detail) {
    if (!jsonTable) return;
    if (!detail) {
      jsonTable.innerHTML = '<div class="modal-json-table-empty">无可用数据</div>';
      return;
    }
    /** @type {Set<any>} */
    const seen = new Set();

    function renderValue(value, nested = true) {
      if (value === null || value === undefined) {
        return '';
      }
      const t = typeof value;
      if (t === 'string' || t === 'number' || t === 'boolean') {
        return escapeHtml(String(value));
      }
      if (t === 'object') {
        if (seen.has(value)) {
          return '<span class="modal-json-circular">[Circular]</span>';
        }
        seen.add(value);
        let html;
        if (Array.isArray(value)) {
          html = renderArray(value);
        } else {
          html = renderObject(value, nested);
        }
        seen.delete(value);
        return html;
      }
      return escapeHtml(String(value));
    }

    function renderObject(obj, nested = false) {
      const entries = Object.entries(obj);
      if (!entries.length) {
        return '<span class="modal-json-empty-object">{}</span>';
      }
      const rows = entries.map(([key, value]) => {
        return `<tr><th>${escapeHtml(key)}</th><td>${renderValue(value)}</td></tr>`;
      });
      const cls = nested ? 'modal-json-table-inner modal-json-table-inner-nested' : 'modal-json-table-inner';
      return `<table class="${cls}"><tbody>${rows.join('')}</tbody></table>`;
    }

    function renderArray(arr) {
      if (!arr.length) {
        return '<span class="modal-json-empty-array">[]</span>';
      }
      const rows = arr.map((value, idx) => {
        return `<tr><th>[${idx}]</th><td>${renderValue(value)}</td></tr>`;
      });
      return `<table class="modal-json-table-inner modal-json-table-inner-nested"><tbody>${rows.join('')}</tbody></table>`;
    }

    jsonTable.innerHTML = renderObject(detail, false);
  }

  if (jsonToTableBtn && jsonModal && jsonContent && jsonTable) {
    jsonToTableBtn.addEventListener('click', () => {
      if (!currentFundDetail) {
        return;
      }
      if (currentFundViewMode === 'json') {
        renderFundDetailAsTable(currentFundDetail);
        jsonContent.style.display = 'none';
        jsonTable.style.display = 'block';
        jsonToTableBtn.textContent = '查看 JSON';
        currentFundViewMode = 'table';
      } else {
        jsonContent.textContent = JSON.stringify(currentFundDetail, null, 2);
        jsonContent.style.display = 'block';
        jsonTable.style.display = 'none';
        jsonToTableBtn.textContent = '转为表格';
        currentFundViewMode = 'json';
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupEvents();
  loadCachedFunds();
});

