import { fetchFundStatsFromAPI, fetchFundFeeFromAPI } from './api-adapter.js';
import { escapeHtml, getColorForIndex } from './utils.js';

const MAX_DROPDOWN_ITEMS = 30;
const MAX_FUNDS_LOAD = 220;
const SEARCH_DEBOUNCE_MS = 100;
const STORAGE_KEY = 'index-page-selected';
const DETAIL_TOP_N = 10;
const SUGGEST_MAX = 8;

const state = {
  stats: null,
  selectedIndexes: [],
  allRows: [],
  sortedRows: [],
  sortMode: 'annualFee_asc',
  returnPeriod: '近1年',
  lastLoadMeta: { loaded: 0, total: 0, failed: 0 },
  isLoading: false,
  fundDataCache: {},
  charts: { bar: null, scatter: null }
};

const els = {};

function cacheEls() {
  els.searchInput = document.getElementById('index-page-search-input');
  els.dropdown = document.getElementById('index-page-search-dropdown');
  els.searchHint = document.getElementById('index-page-search-hint');
  els.suggestions = document.getElementById('index-page-suggestions');
  els.chips = document.getElementById('index-page-selected-chips');
  els.main = document.getElementById('index-page-main');
  els.sortSelect = document.getElementById('index-page-sort-select');
  els.periodWrap = document.getElementById('index-page-period-wrap');
  els.periodButtons = Array.from(document.querySelectorAll('.index-page-period-btn'));
  els.loadingStatus = document.getElementById('index-page-loading-status');
  els.summary = document.getElementById('index-page-summary');
  els.tableBody = document.getElementById('index-page-table-body');
  els.barCanvas = document.getElementById('index-page-bar-chart');
  els.scatterCanvas = document.getElementById('index-page-scatter-chart');
  els.colScale = document.getElementById('index-page-col-scale');
  els.colAnnual = document.getElementById('index-page-col-annual');
  els.colBuy = document.getElementById('index-page-col-buy');
  els.colReturn = document.getElementById('index-page-col-return');
  els.detailWrap = document.getElementById('index-page-detail-table-wrap');
  els.detailTbody = document.getElementById('index-page-detail-tbody');
}

/* ── helpers ── */

function setHint(text, isError = false) {
  if (!els.searchHint) return;
  els.searchHint.textContent = text;
  els.searchHint.classList.toggle('error', isError);
}

function setLoadingStatus(text) {
  if (els.loadingStatus) els.loadingStatus.textContent = text || '';
}

function matchesQuery(item, query) {
  const s = String(query || '').trim().toLowerCase();
  if (!s) return false;
  const label = String(item.label || '').toLowerCase();
  const initials = String(item.initials || '').toLowerCase();
  const numOnly = s.replace(/\D/g, '');
  if (label.includes(s)) return true;
  if (initials.startsWith(s)) return true;
  if (numOnly && label.includes(numOnly)) return true;
  return false;
}

function searchTracking(query) {
  const tracking = state.stats?.tracking || [];
  const q = String(query || '').trim();
  if (!q) return [];
  const selectedLabels = new Set(state.selectedIndexes.map(i => i.label));
  return tracking
    .filter(item => matchesQuery(item, q) && !selectedLabels.has(item.label))
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, MAX_DROPDOWN_ITEMS);
}

function parseScaleValue(scale) {
  const text = String(scale?.amountText || scale?.text || '').trim();
  if (!text) return null;
  const yi = /([\d.]+)\s*亿/.exec(text);
  if (yi) return parseFloat(yi[1]);
  const wan = /([\d.]+)\s*万/.exec(text);
  if (wan) return parseFloat(wan[1]) / 10000;
  const n = parseFloat(text.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function getReturnValue(row, period) {
  if (!row || !row.stageReturnsMap) return null;
  const v = row.stageReturnsMap[period];
  return Number.isFinite(v) ? v : null;
}

function formatPct(v) {
  if (!Number.isFinite(v)) return '--';
  return `${(v * 100).toFixed(2)}%`;
}

function shortLabel(name) {
  const n = String(name || '').trim();
  return n.length > 8 ? n.slice(0, 8) + '..' : n;
}

/* ── localStorage persistence ── */

function saveSelection() {
  try {
    const labels = state.selectedIndexes.map(i => i.label);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(labels));
  } catch { /* quota or private mode */ }
}

function loadSelection(tracking) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const labels = JSON.parse(raw);
    if (!Array.isArray(labels) || !labels.length) return [];
    const byLabel = new Map(tracking.map(t => [t.label, t]));
    return labels.map(l => byLabel.get(l)).filter(Boolean);
  } catch { return []; }
}

/* ── suggestions (name similarity) ── */

function extractKeywords(label) {
  const cleaned = String(label || '')
    .replace(/指数|ETF|联接|增强|LOF|A|C|基金/gi, '')
    .trim();
  if (!cleaned) return [];
  const keywords = [];
  if (cleaned.length >= 2) keywords.push(cleaned);
  for (let len = 2; len <= Math.min(4, cleaned.length - 1); len++) {
    for (let i = 0; i <= cleaned.length - len; i++) {
      const sub = cleaned.slice(i, i + len);
      if (!keywords.includes(sub)) keywords.push(sub);
    }
  }
  return keywords;
}

function getSuggestions() {
  if (!state.selectedIndexes.length) return [];
  const tracking = state.stats?.tracking || [];
  const selectedLabels = new Set(state.selectedIndexes.map(i => i.label));
  const allKeywords = [];
  state.selectedIndexes.forEach(idx => {
    allKeywords.push(...extractKeywords(idx.label));
  });
  if (!allKeywords.length) return [];
  const scored = new Map();
  for (const item of tracking) {
    if (selectedLabels.has(item.label)) continue;
    const lower = String(item.label || '').toLowerCase();
    let score = 0;
    for (const kw of allKeywords) {
      if (lower.includes(kw.toLowerCase())) score++;
    }
    if (score > 0) scored.set(item, score);
  }
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || (b[0].count || 0) - (a[0].count || 0))
    .slice(0, SUGGEST_MAX)
    .map(([item]) => item);
}

function renderSuggestions() {
  if (!els.suggestions) return;
  const items = getSuggestions();
  if (!items.length) {
    els.suggestions.innerHTML = '';
    return;
  }
  els.suggestions.innerHTML =
    '<span class="index-page-suggest-label">相似指数：</span>' +
    items.map(item =>
      `<button type="button" class="index-page-suggest-chip" data-label="${escapeHtml(item.label)}">${escapeHtml(item.label)}<em>${item.count || 0}</em></button>`
    ).join('');
  els.suggestions.querySelectorAll('.index-page-suggest-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const label = btn.dataset.label;
      const item = (state.stats?.tracking || []).find(t => t.label === label);
      if (item) selectDropdownItem(item);
    });
  });
}

/* ── dropdown ── */

let dropdownHighlight = -1;
let lastDropdownItems = [];

function showDropdown(items) {
  if (!els.dropdown) return;
  dropdownHighlight = -1;
  els.dropdown.innerHTML = '';
  if (!items || !items.length) {
    lastDropdownItems = [];
    els.dropdown.setAttribute('aria-hidden', 'true');
    els.dropdown.classList.remove('fund-search-dropdown-visible');
    return;
  }
  lastDropdownItems = items;
  items.forEach((item, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.index = String(i);
    li.innerHTML = `
      <span class="fund-search-name">${escapeHtml(item.label || '')}</span>
      <span class="fund-search-code">${item.count || 0} 只基金</span>
    `;
    li.addEventListener('click', () => selectDropdownItem(item));
    els.dropdown.appendChild(li);
  });
  els.dropdown.setAttribute('aria-hidden', 'false');
  els.dropdown.classList.add('fund-search-dropdown-visible');
}

function highlightDropdownItem(index) {
  if (!els.dropdown) return;
  const options = els.dropdown.querySelectorAll('[role="option"]');
  options.forEach((el, i) => el.classList.toggle('fund-search-item-active', i === index));
  dropdownHighlight = index;
  if (index >= 0 && options[index]) options[index].scrollIntoView({ block: 'nearest' });
}

function selectDropdownItem(item) {
  if (!item) return;
  if (state.selectedIndexes.some(i => i.label === item.label)) return;
  state.selectedIndexes.push(item);
  if (els.searchInput) els.searchInput.value = '';
  showDropdown([]);
  triggerRefresh();
}

/* ── chips ── */

function renderChips() {
  if (!els.chips) return;
  if (!state.selectedIndexes.length) {
    els.chips.innerHTML = '';
    return;
  }
  els.chips.innerHTML = state.selectedIndexes.map((item, idx) => `
    <span class="index-page-chip">
      ${escapeHtml(item.label || '')}
      <em>${item.count || 0}</em>
      <button type="button" class="index-page-chip-remove" data-idx="${idx}" aria-label="移除">&times;</button>
    </span>
  `).join('');
  els.chips.querySelectorAll('.index-page-chip-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      if (Number.isFinite(idx) && idx >= 0 && idx < state.selectedIndexes.length) {
        state.selectedIndexes.splice(idx, 1);
        triggerRefresh();
      }
    });
  });
}

/* ── data loading ── */

async function buildRows(indexes) {
  const codeToIndexes = new Map();
  indexes.forEach(item => {
    const label = String(item.label || '').trim();
    (item.codes || []).forEach(code => {
      const safeCode = String(code || '').trim();
      if (!safeCode) return;
      if (!codeToIndexes.has(safeCode)) codeToIndexes.set(safeCode, new Set());
      codeToIndexes.get(safeCode).add(label);
    });
  });
  const allCodes = [...codeToIndexes.keys()];
  const limitedCodes = allCodes.slice(0, MAX_FUNDS_LOAD);
  setLoadingStatus(`正在加载 ${limitedCodes.length}/${allCodes.length} 只基金...`);
  const settled = await Promise.allSettled(limitedCodes.map(code => fetchFundFeeFromAPI(code)));
  const rows = [];
  let failed = 0;
  settled.forEach((item, idx) => {
    const code = limitedCodes[idx];
    if (item.status !== 'fulfilled' || !item.value) { failed++; return; }
    const data = item.value;
    state.fundDataCache[code] = data;
    const stageReturnsMap = {};
    (data.stageReturns || []).forEach(s => {
      const key = String(s.period || '').trim();
      if (!key) return;
      const val = typeof s.returnPct === 'number' ? s.returnPct : parseFloat(s.returnPct);
      if (Number.isFinite(val)) stageReturnsMap[key] = val;
    });
    rows.push({
      code,
      name: data.name || `基金${code}`,
      annualFee: Number.isFinite(data.annualFee) ? data.annualFee : null,
      buyFee: Number.isFinite(data.buyFee) ? data.buyFee : null,
      scaleValue: parseScaleValue(data.netAssetScale),
      scaleText: data.netAssetScale?.amountText || data.netAssetScale?.text || '--',
      stageReturnsMap,
      trackingIndexes: [...(codeToIndexes.get(code) || [])],
      sellFeeSegments: data.sellFeeSegments || [],
      fundManager: data.fundManager || '',
      trackingTarget: data.trackingTarget || ''
    });
  });
  setLoadingStatus('');
  return { rows, loadMeta: { loaded: rows.length, total: allCodes.length, failed } };
}

/* ── sorting ── */

function sortedValue(row) {
  if (state.sortMode === 'scale_desc') return row.scaleValue;
  if (state.sortMode === 'annualFee_asc') return row.annualFee;
  if (state.sortMode === 'buyFee_asc') return row.buyFee;
  if (state.sortMode === 'return_desc') return getReturnValue(row, state.returnPeriod);
  return null;
}

function sortRows() {
  const asc = state.sortMode.endsWith('_asc');
  state.sortedRows = [...state.allRows].sort((a, b) => {
    const av = sortedValue(a);
    const bv = sortedValue(b);
    const aMissing = !Number.isFinite(av);
    const bMissing = !Number.isFinite(bv);
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    return asc ? av - bv : bv - av;
  });
}

/* ── rendering ── */

function updateSortColumnHighlight() {
  const map = { scale_desc: els.colScale, annualFee_asc: els.colAnnual, buyFee_asc: els.colBuy, return_desc: els.colReturn };
  [els.colScale, els.colAnnual, els.colBuy, els.colReturn].forEach(el => {
    if (el) el.classList.remove('index-page-sort-col-active');
  });
  const active = map[state.sortMode];
  if (active) active.classList.add('index-page-sort-col-active');
}

function renderSummary() {
  if (!els.summary) return;
  const lm = state.lastLoadMeta;
  const missing = state.sortedRows.filter(r => (
    r.scaleValue == null || !Number.isFinite(r.annualFee) ||
    !Number.isFinite(r.buyFee) || getReturnValue(r, state.returnPeriod) == null
  )).length;
  els.summary.innerHTML = `
    <div class="fund-stats-summary-card index-page-summary-card">
      <span class="fund-stats-summary-number">${state.selectedIndexes.length}</span>
      <span class="fund-stats-summary-label">选中指数</span>
    </div>
    <div class="fund-stats-summary-card index-page-summary-card">
      <span class="fund-stats-summary-number">${lm.loaded}</span>
      <span class="fund-stats-summary-label">有效基金</span>
      <span class="fund-stats-summary-sub">总候选 ${lm.total} / 失败 ${lm.failed}</span>
    </div>
    <div class="fund-stats-summary-card index-page-summary-card">
      <span class="fund-stats-summary-number">${missing}</span>
      <span class="fund-stats-summary-label">缺失指标</span>
      <span class="fund-stats-summary-sub">缺失值排在末尾</span>
    </div>
  `;
}

function renderTable() {
  if (!els.tableBody) return;
  if (!state.sortedRows.length) {
    els.tableBody.innerHTML = '<tr><td class="cached-funds-empty" colspan="7">未找到可比较基金。</td></tr>';
    return;
  }
  els.tableBody.innerHTML = state.sortedRows.map(row => {
    const ret = getReturnValue(row, state.returnPeriod);
    return `<tr>
      <td>${escapeHtml(row.name || `基金${row.code}`)}</td>
      <td><span class="fund-code">${escapeHtml(row.code || '--')}</span></td>
      <td>${escapeHtml(row.scaleText || '--')}</td>
      <td>${formatPct(row.annualFee)}</td>
      <td>${formatPct(row.buyFee)}</td>
      <td>${formatPct(ret)}</td>
      <td title="${escapeHtml((row.trackingIndexes || []).join(' / '))}">${escapeHtml((row.trackingIndexes || []).slice(0, 2).join(' / ') || '--')}</td>
    </tr>`;
  }).join('');
}

/* ── detail table (Top N, vertical layout like main page) ── */

function formatSellSegments(segs) {
  if (!Array.isArray(segs) || !segs.length) return '-';
  return segs
    .slice().sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
    .map(s => {
      const label = s.unbounded ? `≥${s.days}天` : `${s.days}天`;
      const pct = s.rate != null ? (s.rate * 100).toFixed(2) + '%' : '-';
      return `<div>${escapeHtml(label)}: ${pct}</div>`;
    }).join('');
}

function renderDetailTable() {
  if (!els.detailWrap || !els.detailTbody) return;
  const topFunds = state.sortedRows.slice(0, DETAIL_TOP_N);
  if (!topFunds.length) {
    els.detailWrap.style.display = 'none';
    return;
  }
  els.detailWrap.style.display = '';

  const rows = [
    { label: '基金名称', render: r => escapeHtml(r.name || '-') },
    { label: '基金代码', render: r => escapeHtml(r.code || '-') },
    { label: '规模', render: r => escapeHtml(r.scaleText || '-'), nowrap: false },
    { label: '年化费率', render: r => formatPct(r.annualFee) },
    { label: '申购费率', render: r => formatPct(r.buyFee) },
    { label: '卖出费率分段', render: r => formatSellSegments(r.sellFeeSegments), nowrap: false },
    { label: '跟踪标的', render: r => escapeHtml(r.trackingTarget || (r.trackingIndexes || []).join(' / ') || '-'), nowrap: false },
    { label: `${state.returnPeriod}收益`, render: r => formatPct(getReturnValue(r, state.returnPeriod)) },
    { label: '基金公司', render: r => escapeHtml(r.fundManager || '-') },
    {
      label: '外链',
      render: r => {
        if (!r.code) return '-';
        const isOverseas = /^968\d{3}$/.test(r.code);
        const emUrl = isOverseas
          ? `https://overseas.1234567.com.cn/${r.code}`
          : `https://fundf10.eastmoney.com/jjfl_${r.code}.html`;
        return `<a href="${emUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-secondary">天天基金</a>`;
      }
    }
  ];

  els.detailTbody.innerHTML = rows.map(row => {
    const th = `<th class="fund-detail-row-label">${row.label}</th>`;
    const style = row.nowrap === false ? ' style="white-space:normal"' : '';
    const tds = topFunds.map(f => `<td${style}>${row.render(f)}</td>`).join('');
    return `<tr>${th}${tds}</tr>`;
  }).join('');
}

/* ── charts ── */

function destroyCharts() {
  if (state.charts.bar) { state.charts.bar.destroy(); state.charts.bar = null; }
  if (state.charts.scatter) { state.charts.scatter.destroy(); state.charts.scatter = null; }
}

function getBarLabel() {
  if (state.sortMode === 'scale_desc') return '规模(亿元)';
  if (state.sortMode === 'annualFee_asc') return '年化费率(%)';
  if (state.sortMode === 'buyFee_asc') return '申购费率(%)';
  return `${state.returnPeriod}收益(%)`;
}

function getBarNumber(row) {
  if (state.sortMode === 'scale_desc') return row.scaleValue;
  if (state.sortMode === 'annualFee_asc') return Number.isFinite(row.annualFee) ? row.annualFee * 100 : null;
  if (state.sortMode === 'buyFee_asc') return Number.isFinite(row.buyFee) ? row.buyFee * 100 : null;
  const v = getReturnValue(row, state.returnPeriod);
  return Number.isFinite(v) ? v * 100 : null;
}

function renderCharts() {
  if (typeof Chart === 'undefined' || !els.barCanvas || !els.scatterCanvas) return;
  destroyCharts();

  const topRows = state.sortedRows.filter(r => Number.isFinite(getBarNumber(r))).slice(0, 10);
  state.charts.bar = new Chart(els.barCanvas, {
    type: 'bar',
    data: {
      labels: topRows.map(r => shortLabel(r.name)),
      datasets: [{ label: getBarLabel(), data: topRows.map(getBarNumber), backgroundColor: topRows.map((_, i) => getColorForIndex(i)) }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { bottom: 8 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title(items) { const idx = items[0]?.dataIndex; return idx != null && topRows[idx] ? `${topRows[idx].name}(${topRows[idx].code})` : ''; } } }
      },
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 0, autoSkip: true, font: { size: 11 } } },
        y: { beginAtZero: true }
      }
    }
  });

  const scatterRows = state.sortedRows.filter(r => Number.isFinite(r.annualFee) && Number.isFinite(getReturnValue(r, state.returnPeriod)));
  state.charts.scatter = new Chart(els.scatterCanvas, {
    type: 'scatter',
    data: {
      datasets: [{
        label: '基金分布',
        data: scatterRows.map((row, i) => ({ x: row.annualFee * 100, y: getReturnValue(row, state.returnPeriod) * 100, label: `${row.name || row.code}(${row.code})`, backgroundColor: getColorForIndex(i) })),
        pointBackgroundColor: scatterRows.map((_, i) => getColorForIndex(i)),
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: { tooltip: { callbacks: { label(ctx) { const item = ctx.raw || {}; return `${item.label || ''} 年化:${ctx.parsed.x.toFixed(2)}% 收益:${ctx.parsed.y.toFixed(2)}%`; } } } },
      scales: {
        x: { title: { display: true, text: '年化费率(%)' } },
        y: { title: { display: true, text: `${state.returnPeriod}收益(%)` } }
      }
    }
  });
}

/* ── rerender ── */

function rerender() {
  sortRows();
  updateSortColumnHighlight();
  renderChips();
  renderSuggestions();
  renderSummary();
  renderTable();
  renderDetailTable();
  renderCharts();
}

function updatePeriodButtonStatus() {
  const show = state.sortMode === 'return_desc';
  if (els.periodWrap) els.periodWrap.classList.toggle('index-page-period-wrap-hidden', !show);
  els.periodButtons.forEach(btn => {
    btn.classList.toggle('index-page-period-btn-active', btn.dataset.period === state.returnPeriod);
  });
}

/* ── triggerRefresh ── */

async function triggerRefresh() {
  saveSelection();
  renderChips();
  renderSuggestions();

  if (!state.selectedIndexes.length) {
    state.allRows = [];
    state.sortedRows = [];
    state.lastLoadMeta = { loaded: 0, total: 0, failed: 0 };
    els.main?.classList.add('index-page-main-hidden');
    setHint('从上方搜索并选择想买的指数。');
    return;
  }

  if (state.isLoading) return;
  state.isLoading = true;

  els.main?.classList.remove('index-page-main-hidden');
  setHint(`正在加载 ${state.selectedIndexes.length} 个指数的基金...`);

  try {
    const { rows, loadMeta } = await buildRows(state.selectedIndexes);
    state.allRows = rows;
    state.lastLoadMeta = loadMeta;
    rerender();
    const cut = loadMeta.total > MAX_FUNDS_LOAD ? `（仅加载前 ${MAX_FUNDS_LOAD} 只）` : '';
    setHint(`${loadMeta.loaded} 只基金${cut}`);
  } catch {
    setHint('加载失败，请重试。', true);
  } finally {
    state.isLoading = false;
  }
}

/* ── events ── */

function bindEvents() {
  let searchTimer;
  els.searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = els.searchInput.value.trim();
      showDropdown(searchTracking(q));
    }, SEARCH_DEBOUNCE_MS);
  });

  els.searchInput?.addEventListener('keydown', (e) => {
    const options = els.dropdown?.querySelectorAll('[role="option"]') || [];
    if (e.key === 'ArrowDown') { e.preventDefault(); highlightDropdownItem(dropdownHighlight < options.length - 1 ? dropdownHighlight + 1 : 0); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); highlightDropdownItem(dropdownHighlight <= 0 ? options.length - 1 : dropdownHighlight - 1); return; }
    if (e.key === 'Enter') { e.preventDefault(); const idx = dropdownHighlight >= 0 ? dropdownHighlight : 0; if (lastDropdownItems[idx]) selectDropdownItem(lastDropdownItems[idx]); return; }
    if (e.key === 'Escape') { showDropdown([]); els.searchInput.blur(); }
  });

  els.dropdown?.addEventListener('mousedown', (e) => e.preventDefault());

  document.addEventListener('click', (e) => {
    if (els.dropdown?.classList.contains('fund-search-dropdown-visible') &&
        !els.searchInput?.contains(e.target) && !els.dropdown?.contains(e.target)) {
      showDropdown([]);
    }
  });

  els.sortSelect?.addEventListener('change', () => {
    state.sortMode = els.sortSelect.value;
    updatePeriodButtonStatus();
    rerender();
  });

  els.periodButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      state.returnPeriod = btn.dataset.period || '近1年';
      updatePeriodButtonStatus();
      rerender();
    });
  });
}

/* ── init ── */

async function init() {
  cacheEls();
  setHint('正在加载指数数据...');
  const stats = await fetchFundStatsFromAPI();
  state.stats = stats;
  const tracking = Array.isArray(stats?.tracking) ? stats.tracking : [];
  if (!tracking.length) {
    setHint('指数数据加载失败，请先生成 fund-stats.json。', true);
    return;
  }
  bindEvents();
  updatePeriodButtonStatus();

  const restored = loadSelection(tracking);
  if (restored.length) {
    state.selectedIndexes = restored;
    setHint(`已还原 ${restored.length} 个指数，正在加载基金...`);
    triggerRefresh();
  } else {
    setHint(`已加载 ${tracking.length} 个指数，输入关键词搜索并选择。`);
  }
}

init();
