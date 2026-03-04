/** @typedef {{code:string,name:string,buyFee:number,annualFee:number,sellFeeSegments?:Array<{days:number,rate:number,unbounded?:boolean}>,trackingTarget?:string,fundManager?:string,performanceBenchmark?:string,tradingStatus?:{subscribe?:string,redeem?:string},initials?:string,fundType?:string,updatedAt?:string,raw?:any}} CachedFundRow */

/** @type {CachedFundRow[]} */
let allFunds = [];
let currentPage = 1;
let pageSize = 100;
let totalPages = 1;

/** 保存 allfund.json 中的原始数据，按代码索引，便于弹窗中展示完整字段 */
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
  const select = document.getElementById('cached-funds-sort');
  const val = select?.value || 'code-asc';
  const [key, dir] = val.split('-');
  return { key, dir };
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
    // 搜索结果排序：与基金卡片添加下拉栏逻辑一致
    rows.sort((a, b) => {
      const sa = getSearchScoreForRow(a, query);
      const sb = getSearchScoreForRow(b, query);
      if (sa !== sb) return sa - sb;
      // 次级按代码升序，保证结果稳定
      return a.code.localeCompare(b.code);
    });
  } else {
    // 无搜索关键字时，使用当前排序下拉框配置
    const { key, dir } = getSortConfig();
    rows.sort((a, b) => {
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
      return 0;
    });
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

  tbody.innerHTML = pageRows.map(f => `
    <tr>
      <td><button type="button" class="btn btn-sm cached-fund-json-btn" data-code="${escapeHtml(f.code)}">查看</button></td>
      <td>${escapeHtml(f.code)}</td>
      <td>${escapeHtml(f.name)}</td>
      <td>${escapeHtml(f.fundType || '-')}</td>
      <td>${formatPercent(f.buyFee)}</td>
      <td>${formatPercent(f.annualFee)}</td>
      <td>${formatSellFeeSegments(f.sellFeeSegments)}</td>
      <td>${escapeHtml(f.trackingTarget || '-')}</td>
      <td>${escapeHtml(f.performanceBenchmark || '-')}</td>
      <td>${escapeHtml(f.fundManager || '-')}</td>
      <td>${escapeHtml(formatTradingStatus(f.tradingStatus))}</td>
      <td>${escapeHtml(f.updatedAt || '-')}</td>
    </tr>
  `).join('');
}

async function loadCachedFunds() {
  try {
    setStatus('正在从本地汇总文件读取缓存基金列表...');
    setProgress(0, 1);

    const [allfundRes, indexRes] = await Promise.all([
      fetch('data/allfund/allfund.json'),
      fetch('data/allfund/search-index.json').catch(() => null)
    ]);
    if (!allfundRes.ok) {
      setStatus('读取 data/allfund/allfund.json 失败，请检查文件是否存在。', true);
      return;
    }

    /** @type {{codes?:string[], funds?:Record<string, any>} & Record<string, any>} */
    const data = await allfundRes.json();
    const store = data.funds || data;
    const codes = Array.isArray(data.codes) ? data.codes : Object.keys(store);
    if (!codes.length) {
      setStatus('本地汇总文件中没有发现任何基金代码。', true);
      return;
    }

    /** @type {Record<string, string>} */
    const initialsMap = {};
    if (indexRes && indexRes.ok) {
      try {
        /** @type {{code:string,name:string,initials?:string}[]} */
        const indexData = await indexRes.json();
        for (const item of indexData) {
          if (!item || !item.code) continue;
          initialsMap[item.code] = (item.initials || '').toLowerCase();
        }
      } catch {
        // 索引解析失败则忽略首字母功能，不影响主流程
      }
    }

    const results = [];
    const total = codes.length;
    let processed = 0;

    for (const code of codes) {
      const f = store[code];
      if (!f) continue;
      fundDetailMap[code] = f;
      results.push({
        code: f.code || code,
        name: f.name || code,
        initials: initialsMap[code] || '',
        buyFee: f.buyFee ?? 0,
        annualFee: f.annualFee ?? (f.operationFees?.total ?? 0),
        sellFeeSegments: f.sellFeeSegments ?? f.redeemSegments ?? [],
        trackingTarget: f.trackingTarget || '',
        fundManager: f.fundManager || '',
        performanceBenchmark: f.performanceBenchmark || '',
        tradingStatus: f.tradingStatus || null,
        fundType: f.fundType || '',
        updatedAt: f.updatedAt || '',
        raw: f
      });
      processed += 1;
      if (processed % 50 === 0) {
        setProgress(processed, total);
      }
    }

    setProgress(total, total);
    allFunds = results.sort((a, b) => a.code.localeCompare(b.code));
    setStatus(`已从本地汇总文件加载 ${allFunds.length} 只基金，可在上方搜索、排序。`);
    renderTable();
  } catch (e) {
    setStatus('从本地汇总文件加载缓存基金失败，请检查 data/allfund/allfund.json。', true);
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
    sortSelect.addEventListener('change', () => {
      currentPage = 1;
      renderTable();
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

  // 表格中点击「查看」按钮，展示对应基金在 allfund.json 中的完整原始数据
  const tbody = document.getElementById('cached-funds-tbody');
  if (tbody && jsonModal && jsonContent && jsonTable) {
    tbody.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement|null} */ (e.target instanceof HTMLElement ? e.target.closest('.cached-fund-json-btn') : null);
      if (!target) return;
      const code = target.getAttribute('data-code') || '';
      if (!code) return;
      const detail = fundDetailMap[code] || null;
      currentFundDetail = detail;
      if (!detail) {
        currentFundViewMode = 'json';
        jsonContent.textContent = `未在 allfund.json 中找到代码为 ${code} 的原始记录。`;
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

