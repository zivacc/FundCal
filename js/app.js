/**
 * 基金费率计算器 - 主应用
 */
import { MAX_CALC_DAYS, calcFeeCurve, calcTotalFeeRate, findAllCrossovers, toAnnualizedFeeRate, getSellFeeRate } from './fee-calculator.js';
import { fetchFundFeeFromAPI, fetchFundCodesFromAPI, fetchSearchIndexFromAPI, fetchFeederIndexFromAPI } from './api-adapter.js';
import {
  CHART_COLORS, getColorForIndex, DEMO_FUND_CODES, DEFAULT_SEGMENTS, QUICK_SEGMENT_DAYS,
  defaultSegments, parseRate, formatRate, escapeHtml, shuffle, parseDaysInput,
  openModal, closeModal
} from './utils.js';
import { SEARCH_DEBOUNCE_MS, filterSearchIndex } from './search-utils.js';
import {
  normalizeImportText, parseImportFromText, parseImportFromLines,
  readFileAsText, readExcelFirstColumn
} from './import-utils.js';
import { setupIndexPickerModal } from './index-picker.js';

// 注册 Chart.js 标注插件（由 script 标签加载，全局名 chartjs-plugin-annotation）
if (typeof window !== 'undefined' && window.Chart && window['chartjs-plugin-annotation']) {
  window.Chart.register(window['chartjs-plugin-annotation']);
}

let chartInstance = null;
let activeChartFundCodes = new Set();
let knownChartFundCodes = new Set();
let showAllFundsActive = false;
let hideAllSnapshot = null;
let lastFundsForCrosshair = [];
let buyFeeDiscountFactor = 1;

const STORAGE_KEY = 'fundCalState';

/** 全局搜索索引缓存，供顶部搜索、卡片名称联想、批量导入共用 */
let searchIndexCache = null;

/** 导入结果临时缓存：[{ code?, name, source }] */
let importParsedItems = [];

async function ensureSearchIndex() {
  if (searchIndexCache) return searchIndexCache;
  searchIndexCache = await fetchSearchIndexFromAPI();
  return searchIndexCache;
}

/** 从 DOM 读取基金配置 */
function readFundFromCard(card) {
  const name = card.querySelector('.fund-name')?.value?.trim() || '未命名基金';
  const code = (card.dataset.fundCode || '').trim() || undefined;
  const rawBuyFee = parseRate(card.querySelector('.input-buy-fee')?.value);
  const buyFee = rawBuyFee * buyFeeDiscountFactor;
  const _rawBuyFee = rawBuyFee;
  const annualFee = parseRate(card.querySelector('.input-annual-fee')?.value);
  const unboundedRate = parseRate(card.querySelector('.input-unbounded-rate')?.value);
  const segments = [];
  card.querySelectorAll('.segment-row').forEach(row => {
    let days, rate;
    if (row.dataset.unbounded === 'true') {
      days = parseInt(row.dataset.days, 10);
      rate = unboundedRate;
      if (!isNaN(days) && days > 0) segments.push({ days, rate, unbounded: true });
    } else {
      const daysInput = row.querySelector('.input-days');
      const rateInput = row.querySelector('.input-rate');
      days = parseInt(daysInput?.value, 10);
      rate = parseRate(rateInput?.value);
      if (!isNaN(days) && days > 0) segments.push({ days, rate });
    }
  });
  segments.sort((a, b) => a.days - b.days || (a.unbounded ? 1 : 0) - (b.unbounded ? 1 : 0));
  // 若没有无上限行但用户设置了无上限段费率，则从最后一段的天数起应用该费率（便于手动填写的卡片也生效）
  const hasUnbounded = segments.some(s => s.unbounded);
  if (!hasUnbounded && segments.length > 0 && (unboundedRate > 0 || card.querySelector('.input-unbounded-rate')?.value?.trim() !== '')) {
    const lastSeg = segments[segments.length - 1];
    segments.push({ days: lastSeg.days, rate: unboundedRate, unbounded: true });
    segments.sort((a, b) => a.days - b.days || (a.unbounded ? 1 : 0) - (b.unbounded ? 1 : 0));
  }
  const fund = { name, buyFee, _rawBuyFee, sellFeeSegments: segments, annualFee, unboundedSellFeeRate: unboundedRate };
  if (code) fund.code = code;
  return fund;
}

/** 根据持有天数和卖出费率计算年化费率，并更新行上的悬停提示 */
function updateSegmentRowTitle(row) {
  const daysInput = row.querySelector('.input-days');
  const rateInput = row.querySelector('.input-rate');
  const days = parseInt(daysInput?.value, 10);
  const rate = parseRate(rateInput?.value);
  if (!isNaN(days) && days > 0) {
    const annualized = rate * (365 / days);
    row.title = `折合年化约 ${formatRate(annualized)}`;
  } else {
    row.title = '';
  }
}

/** 渲染分段表格行（含删除按钮），seg 为空则天数和费率都为空；seg.unbounded 时为无上限段，费率由下方「无上限段卖出费率」输入决定 */
function renderSegmentRow(container, seg = { days: 7, rate: 0 }, onUpdate, onRowChange) {
  const row = document.createElement('tr');
  row.className = 'segment-row';
  const isUnbounded = !!seg.unbounded;
  const daysVal = seg.days !== undefined && seg.days !== null && seg.days !== '' ? seg.days : '';
  const rateVal = seg.rate != null && seg.rate > 0 ? (seg.rate * 100).toFixed(2) : '';
  if (isUnbounded) {
    row.dataset.unbounded = 'true';
    row.dataset.days = String(daysVal);
    row.innerHTML = `
      <td class="unbounded-days-cell">≥${daysVal}天</td>
      <td class="unbounded-rate-cell">永久费率</td>
      <td class="segment-actions"><button type="button" class="segment-del-btn" title="删除该行" aria-label="删除该行">×</button></td>
    `;
  } else {
    row.innerHTML = `
      <td><input type="number" class="input-days" value="${daysVal}" min="1" placeholder="期限"></td>
      <td><input type="text" class="input-rate" value="${rateVal}" placeholder="0.00 或 0.00%"></td>
      <td class="segment-actions"><button type="button" class="segment-del-btn" title="删除该行" aria-label="删除该行">×</button></td>
    `;
  }
  container.appendChild(row);

  if (!isUnbounded) {
    updateSegmentRowTitle(row);
    row.addEventListener('mouseenter', () => updateSegmentRowTitle(row));
  }

  row.querySelector('.segment-del-btn').addEventListener('click', () => {
    if (container.querySelectorAll('.segment-row').length <= 1) return;
    row.remove();
    onRowChange?.();
    onUpdate?.();
  });
  if (!isUnbounded) {
    row.querySelector('.input-days').addEventListener('blur', () => {
      sortSegmentRows(container);
      onRowChange?.();
      onUpdate?.();
    });
    row.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        updateSegmentRowTitle(row);
        onUpdate?.();
      });
    });
  }
  return row;
}

/** 按持有天数从小到大重排卖出费率表格行；无上限段（同天数）排最后 */
function sortSegmentRows(tbody) {
  const rows = Array.from(tbody.querySelectorAll('.segment-row'));
  const withDays = rows.map(row => {
    const daysInput = row.querySelector('.input-days');
    const days = daysInput ? parseInt(daysInput.value, 10) : parseInt(row.dataset.days, 10);
    const unbounded = row.dataset.unbounded === 'true';
    return { row, days: !isNaN(days) && days > 0 ? days : Infinity, unbounded };
  });
  withDays.sort((a, b) => a.days - b.days || (a.unbounded ? 1 : 0) - (b.unbounded ? 1 : 0));
  withDays.forEach(({ row }) => tbody.appendChild(row));
}

/** 获取表格中已存在的持有天数列表 */
function getExistingDays(tbody) {
  return Array.from(tbody.querySelectorAll('.segment-row'))
    .map(r => {
      const inp = r.querySelector('.input-days');
      return inp ? parseInt(inp.value, 10) : (r.dataset.unbounded === 'true' ? parseInt(r.dataset.days, 10) : NaN);
    })
    .filter(d => !isNaN(d) && d > 0);
}

/** 刷新快捷按钮：仅显示表格中尚未存在的天数对应的按钮 */
function updateQuickButtons(tbody, quickContainer, onUpdate, onRowChange) {
  if (!quickContainer) return;
  const existing = getExistingDays(tbody);
  quickContainer.innerHTML = '';
  QUICK_SEGMENT_DAYS.forEach(days => {
    if (existing.includes(days)) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm';
    btn.dataset.days = days;
    btn.textContent = `${days}天`;
    btn.addEventListener('click', () => {
      addQuickSegment(tbody, days, onUpdate, onRowChange);
    });
    quickContainer.appendChild(btn);
  });
}

/** 添加快捷分段，若该天数已存在则跳过；新行天数预填，费率为空 */
function addQuickSegment(tbody, days, onUpdate, onRowChange) {
  const existing = getExistingDays(tbody);
  if (existing.includes(days)) return;
  renderSegmentRow(tbody, { days, rate: '' }, onUpdate, onRowChange);
  sortSegmentRows(tbody);
  onRowChange?.();
  onUpdate?.();
}

/** 从 DOM 收集可持久化的状态 */
function getStateFromDOM() {
  const calcDaysMinEl = document.getElementById('calc-days-min');
  const calcDaysMaxEl = document.getElementById('calc-days-max');
  const buyFeeDiscountEl = document.getElementById('buy-fee-discount');
  const skipFirst7El = document.getElementById('skip-first-7');
  const showTooltipEl = document.getElementById('show-tooltip');
  const penetrateFeederEl = document.getElementById('penetrate-linked');
  const cards = document.querySelectorAll('.fund-card');
  return {
    calcDaysMin: calcDaysMinEl?.value ?? '',
    calcDaysMax: calcDaysMaxEl?.value ?? '',
    buyFeeDiscount: buyFeeDiscountEl?.value ?? '1',
    skipFirst7: !!skipFirst7El?.checked,
    showTooltip: showTooltipEl ? !!showTooltipEl.checked : true,
    penetrateFeeder: penetrateFeederEl ? !!penetrateFeederEl.checked : false,
    funds: Array.from(cards).map(card => {
      const f = readFundFromCard(card);
      return { ...f, buyFee: f._rawBuyFee };
    })
  };
}

/** 构建可导出的页面快照（.ziva） */
function buildExportSnapshot() {
  const state = getStateFromDOM();
  return {
    type: 'FundCalSnapshot',
    version: 1,
    createdAt: new Date().toISOString(),
    state
  };
}

/** 从 .ziva 快照对象中提取 state；容错支持直接传入 state 本身 */
function extractStateFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (snapshot.type === 'FundCalSnapshot' && snapshot.state && typeof snapshot.state === 'object') {
    return snapshot.state;
  }
  // 兼容老格式：直接就是 state
  if (snapshot.funds || snapshot.calcDaysMin != null || snapshot.calcDaysMax != null) {
    return snapshot;
  }
  return null;
}

/** 暂存到 localStorage（防抖由调用方保证） */
function saveState() {
  try {
    const state = getStateFromDOM();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { /* ignore */ }
}

/** 从 localStorage 读取暂存 */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

/** 清除所有卡片并清除本地暂存 */
function clearStoredState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) { /* ignore */ }
  const container = document.getElementById('fund-cards');
  if (!container) return;
  container.innerHTML = '';
  const buyFeeDiscountEl = document.getElementById('buy-fee-discount');
  if (buyFeeDiscountEl) buyFeeDiscountEl.value = '0.1';
  buyFeeDiscountFactor = 0.1;
  updateChart();
}

/** 创建基金卡片 DOM，可选传入 initialData 用于恢复 */
function createFundCard(index, color, initialData) {
  const card = document.createElement('div');
  card.className = 'fund-card';
  card.dataset.index = index;
  card.innerHTML = `
    <h3>
      <span class="color-dot" style="background:${color}"></span>
      <div class="fund-name-wrap">
        <input type="text" class="fund-name" value="基金 ${index + 1}" placeholder="基金名称" data-min-ch="10" autocomplete="off" aria-autocomplete="list">
        <ul class="fund-name-dropdown" role="listbox" aria-hidden="true"></ul>
        <span class="fund-code" aria-hidden="true"></span>
      </div>
      <button type="button" class="remove-btn" title="移除该基金" aria-label="移除该基金">×</button>
    </h3>
    <div class="form-row form-row-fee">
      <span class="segment-section-label">买入费率</span>
      <input type="text" class="input-buy-fee" placeholder="0.1">
      <span class="input-unit">%</span>
    </div>
    <div class="form-row form-row-annual form-row-fee">
      <span class="segment-section-label">年化费率</span>
      <input type="text" class="input-annual-fee" placeholder="1.5">
      <span class="input-unit">%</span>
    </div>
    <p class="segment-section-label">卖出费率</p>
    <table class="segments-table">
      <thead><tr><th>持有期限（天）</th><th>卖出费率（%）</th><th class="segment-actions"></th></tr></thead>
      <tbody></tbody>
    </table>
    <div class="segment-toolbar">
      <button type="button" class="btn btn-sm segment-add-row">+ 添加</button>
      <div class="segment-quick-buttons"></div>
    </div>
    <div class="unbounded-rate-row">
      <label class="unbounded-rate-label">永久卖出费率</label>
      <input type="text" class="input-unbounded-rate" placeholder="0" value="" title="适用「≥N天」无上限区间的费率，默认 0">
      <span class="unbounded-rate-unit">%</span>
      <div class="unbounded-quick-btns">
        <button type="button" class="btn btn-sm unbounded-rate-btn" data-action="clear">清除</button>
        <button type="button" class="btn btn-sm unbounded-rate-btn" data-rate="0.5">0.5%</button>
      </div>
    </div>
  `;
  const tbody = card.querySelector('.segments-table tbody');
  const quickContainer = card.querySelector('.segment-quick-buttons');
  const unboundedInput = card.querySelector('.input-unbounded-rate');
  const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
  const update = debounce(() => { updateChart(); saveState(); }, 300);
  const refreshQuickButtons = () => updateQuickButtons(tbody, quickContainer, update, refreshQuickButtons);

  const nameInput = card.querySelector('.fund-name');
  const nameDropdown = card.querySelector('.fund-name-dropdown');

  function resizeFundNameInput() {
    const minCh = parseInt(nameInput.dataset.minCh, 10) || 10;
    const len = (nameInput.value || '').length;
    nameInput.style.width = `${Math.max(minCh, len + 1)}ch`;
  }

  function showNameDropdown(items) {
    nameDropdown.innerHTML = '';
    nameDropdown.setAttribute('aria-hidden', 'true');
    nameDropdown.classList.remove('fund-name-dropdown-visible');
    if (!items || items.length === 0) return;
    items.forEach((item, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.code = item.code;
      li.dataset.name = item.name;
      li.innerHTML = `<span class="fund-search-code">${item.code}</span> <span class="fund-search-name">${item.name}</span>`;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); selectNameItem(card, item); });
      nameDropdown.appendChild(li);
    });
    nameDropdown.setAttribute('aria-hidden', 'false');
    nameDropdown.classList.add('fund-name-dropdown-visible');
    card.dataset.nameHighlightIndex = '0';
    nameDropdown.querySelectorAll('[role="option"]').forEach((el, i) => el.classList.toggle('fund-search-item-active', i === 0));
  }

  function selectNameItem(cardEl, item) {
    const inp = cardEl.querySelector('.fund-name');
    const codeSpan = cardEl.querySelector('.fund-code');
    if (inp) inp.value = item.name || `基金${item.code}`;
    if (codeSpan) codeSpan.textContent = item.code || '';
    cardEl.dataset.fundCode = item.code || '';
    resizeFundNameInput();
    nameDropdown.classList.remove('fund-name-dropdown-visible');
    (async () => {
      const data = await fetchFundFeeFromAPI(item.code);
      if (data && cardEl.isConnected) {
        cardEl.querySelector('.input-buy-fee').value = data.buyFee != null ? (data.buyFee * 100).toFixed(2) : '';
        cardEl.querySelector('.input-annual-fee').value = data.annualFee != null ? (data.annualFee * 100).toFixed(2) : '';
        const tbody = cardEl.querySelector('.segments-table tbody');
        const segs = data.sellFeeSegments?.length ? data.sellFeeSegments : defaultSegments();
        tbody.innerHTML = '';
        segs.forEach(seg => renderSegmentRow(tbody, seg, update, refreshQuickButtons));
        refreshQuickButtons();
      }
      update();
    })();
  }

  let nameDebounceTimer;
  nameInput.addEventListener('focus', () => ensureSearchIndex());
  nameInput.addEventListener('input', () => {
    resizeFundNameInput();
    update();
    clearTimeout(nameDebounceTimer);
    nameDebounceTimer = setTimeout(async () => {
      const q = nameInput.value.trim();
      if (!q) {
        showNameDropdown([]);
        return;
      }
      const list = await ensureSearchIndex();
      const items = filterSearchIndex(list, q);
      showNameDropdown(items);
    }, SEARCH_DEBOUNCE_MS);
  });
  nameInput.addEventListener('keydown', (e) => {
    const list = nameDropdown.querySelectorAll('[role="option"]');
    if (e.key === 'Escape') {
      nameDropdown.classList.remove('fund-name-dropdown-visible');
      nameInput.blur();
      return;
    }
    if (list.length === 0) return;
    let idx = parseInt(card.dataset.nameHighlightIndex, 10);
    if (Number.isNaN(idx)) idx = 0;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      idx = idx < list.length - 1 ? idx + 1 : 0;
      card.dataset.nameHighlightIndex = String(idx);
      list.forEach((el, i) => el.classList.toggle('fund-search-item-active', i === idx));
      list[idx].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx = idx <= 0 ? list.length - 1 : idx - 1;
      card.dataset.nameHighlightIndex = String(idx);
      list.forEach((el, i) => el.classList.toggle('fund-search-item-active', i === idx));
      list[idx].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = { code: list[idx].dataset.code, name: list[idx].dataset.name };
      selectNameItem(card, item);
    }
  });

  document.addEventListener('click', (e) => {
    if (!card.contains(e.target) && nameDropdown.classList.contains('fund-name-dropdown-visible')) {
      nameDropdown.classList.remove('fund-name-dropdown-visible');
    }
  });

  resizeFundNameInput();

  if (initialData) {
    nameInput.value = initialData.name || '';
    const codeVal = (initialData.code != null ? String(initialData.code).trim() : '') || '';
    if (codeVal) {
      card.dataset.fundCode = codeVal;
      const codeEl = card.querySelector('.fund-code');
      if (codeEl) codeEl.textContent = `${codeVal}`;
    }
    resizeFundNameInput();
    card.querySelector('.input-buy-fee').value = initialData.buyFee != null ? (initialData.buyFee * 100).toFixed(2) : '';
    card.querySelector('.input-annual-fee').value = initialData.annualFee != null ? (initialData.annualFee * 100).toFixed(2) : '';
    const segs = initialData.sellFeeSegments?.length ? initialData.sellFeeSegments : defaultSegments();
    tbody.innerHTML = '';
    segs.forEach(seg => renderSegmentRow(tbody, seg, update, refreshQuickButtons));
    const lastSeg = segs[segs.length - 1];
    if (lastSeg?.unbounded && unboundedInput) {
      const v = initialData.unboundedSellFeeRate != null ? (initialData.unboundedSellFeeRate * 100).toFixed(2) : (lastSeg.rate != null ? (lastSeg.rate * 100).toFixed(2) : '0');
      unboundedInput.value = v;
    }
  } else {
    defaultSegments().forEach(seg => renderSegmentRow(tbody, seg, update, refreshQuickButtons));
  }
  refreshQuickButtons();

  if (unboundedInput) {
    unboundedInput.addEventListener('input', update);
    card.querySelectorAll('.unbounded-rate-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.action === 'clear') {
          unboundedInput.value = '';
        } else {
          const r = parseFloat(btn.dataset.rate);
          unboundedInput.value = (r).toFixed(2);
        }
        update();
      });
    });
  }

  card.querySelector('.segment-add-row').addEventListener('click', () => {
    renderSegmentRow(tbody, { days: '', rate: '' }, update, refreshQuickButtons);
    sortSegmentRows(tbody);
    refreshQuickButtons();
    update();
  });

  card.querySelector('.remove-btn').addEventListener('click', () => {
    card.remove();
    updateChart();
    saveState();
  });

  card.querySelectorAll('input').forEach(inp => inp.addEventListener('input', update));

  return card;
}

/** 添加基金卡片 */
function addFundCard(initialData) {
  const container = document.getElementById('fund-cards');
  // 按基金代码去重：同一代码只保留一张卡片（无代码则不校验）
  const code = initialData && (initialData.code ?? initialData.fundCode);
  if (code && String(code).trim()) {
    const target = String(code).trim();
    const exists = container && Array.from(container.querySelectorAll('.fund-card'))
      .some(c => (c.dataset.fundCode || '').trim() === target);
    if (exists) return;
  }
  const count = container.querySelectorAll('.fund-card').length;
  const color = getColorForIndex(count);
  container.appendChild(createFundCard(count, color, initialData));
  updateChart();
  saveState();
}

/** 根据基金代码移除对应卡片 */
function removeCardByFundCode(code) {
  const target = String(code || '').trim();
  if (!target) return;
  const card = document.querySelector(`.fund-card[data-fund-code="${target}"]`);
  if (card) {
    card.remove();
    updateChart();
    saveState();
  }
}

/** 根据暂存恢复页面 */
function restoreState(state) {
  const calcDaysMinEl = document.getElementById('calc-days-min');
  const calcDaysMaxEl = document.getElementById('calc-days-max');
  if (calcDaysMinEl) calcDaysMinEl.value = state.calcDaysMin ?? '';
  if (calcDaysMaxEl) calcDaysMaxEl.value = state.calcDaysMax ?? state.calcDays ?? '';
  const buyFeeDiscountEl = document.getElementById('buy-fee-discount');
  if (buyFeeDiscountEl && state.buyFeeDiscount != null) {
    buyFeeDiscountEl.value = String(state.buyFeeDiscount);
  }
  // 同步折扣因子
  if (buyFeeDiscountEl) {
    const n = parseFloat(buyFeeDiscountEl.value);
    buyFeeDiscountFactor = !isNaN(n) && n >= 0 ? n : 1;
  } else {
    buyFeeDiscountFactor = 1;
  }
  const skipFirst7El = document.getElementById('skip-first-7');
  if (skipFirst7El && state.skipFirst7 != null) skipFirst7El.checked = !!state.skipFirst7;
  const showTooltipEl = document.getElementById('show-tooltip');
  // 恢复状态，若无状态则默认：小屏关闭，大屏开启
  if (showTooltipEl) {
    if (state.showTooltip !== undefined) {
      showTooltipEl.checked = state.showTooltip !== false;
    } else {
      showTooltipEl.checked = window.innerWidth >= 900;
    }
  }
  const penetrateFeederEl = document.getElementById('penetrate-linked');
  if (penetrateFeederEl && state.penetrateFeeder != null) penetrateFeederEl.checked = !!state.penetrateFeeder;
  const container = document.getElementById('fund-cards');
  if (!container) return;
  container.innerHTML = '';
  (state.funds || []).forEach((fund, i) => {
    const color = getColorForIndex(i);
    container.appendChild(createFundCard(i, color, fund));
  });
  updateChart();
}

/** 收集所有基金配置（颜色按当前卡片顺序统一分配，保证与图表一致且不重复直到用尽） */
function collectFunds() {
  const cards = document.querySelectorAll('.fund-card');
  const funds = Array.from(cards).map((card, i) => {
    const fund = readFundFromCard(card);
    fund.color = getColorForIndex(i);
    const code = String(fund.code || '').trim();
    fund._id = code || ('__custom_' + i);
    return fund;
  });
  const allIds = new Set(funds.map(f => f._id));
  // 清除已不存在的 id
  activeChartFundCodes.forEach(id => {
    if (!allIds.has(id)) activeChartFundCodes.delete(id);
  });
  if (knownChartFundCodes.size === 0 && activeChartFundCodes.size === 0) {
    const idsArr = Array.from(allIds);
    const limit = idsArr.length > 30 ? 30 : idsArr.length;
    for (let i = 0; i < limit; i++) activeChartFundCodes.add(idsArr[i]);
  } else {
    allIds.forEach(id => {
      if (!knownChartFundCodes.has(id)) {
        if (showAllFundsActive || allIds.size <= 30) {
          activeChartFundCodes.add(id);
        }
      }
    });
  }
  knownChartFundCodes = new Set(allIds);
  return funds;
}

/** 将卡片上的颜色点与当前 fund.color 同步，保证卡片与图表颜色一致 */
function syncCardColors(funds) {
  const cards = document.querySelectorAll('.fund-card');
  cards.forEach((card, i) => {
    const dot = card.querySelector('.color-dot');
    if (dot && funds[i]) dot.style.background = funds[i].color;
  });
}

/** 渲染图表右侧基金参与列表，并绑定点击开关逻辑 */
function renderChartFundList(funds) {
  const listEl = document.getElementById('chart-fund-list');
  const hintEl = document.getElementById('chart-fund-list-hint');
  const showAllBtn = document.getElementById('chart-fund-list-show-all');
  const hideAllBtn = document.getElementById('chart-fund-list-hide-all');
  if (!listEl) return;
  // 辅助无障碍：标记列表角色
  listEl.setAttribute('role', 'list');
  listEl.innerHTML = '';
  if (!funds || funds.length === 0) {
    listEl.innerHTML = '<p class="modal-hint">当前没有可参与图表的基金。</p>';
    return;
  }
  const allIds = funds.map(f => f._id).filter(Boolean);
  const totalCount = allIds.length;
  const allActive = totalCount > 0 && allIds.every(id => activeChartFundCodes.has(id));
  const noneActive = totalCount > 0 && !allIds.some(id => activeChartFundCodes.has(id));

  // 同步 showAllFundsActive 与实际状态
  if (allActive) showAllFundsActive = true;
  if (!allActive && showAllFundsActive) showAllFundsActive = false;

  if (hintEl) {
    hintEl.textContent = (totalCount > 30 && !allActive) ? '基金过多，仅默认高亮前 30 只。' : '';
  }
  if (showAllBtn) {
    showAllBtn.classList.toggle('chart-fund-list-show-all-active', showAllFundsActive);
    showAllBtn.onclick = () => {
      showAllFundsActive = !showAllFundsActive;
      if (showAllFundsActive) {
        allIds.forEach(id => activeChartFundCodes.add(id));
      } else if (totalCount > 30) {
        const keep = new Set(allIds.slice(0, 30));
        allIds.forEach(id => { if (!keep.has(id)) activeChartFundCodes.delete(id); });
      }
      updateChart();
    };
  }
  if (hideAllBtn) {
    hideAllBtn.classList.toggle('chart-fund-list-show-all-active', noneActive);
    hideAllBtn.onclick = () => {
      if (noneActive && hideAllSnapshot) {
        hideAllSnapshot.forEach(id => activeChartFundCodes.add(id));
        hideAllSnapshot = null;
      } else {
        hideAllSnapshot = new Set(allIds.filter(id => activeChartFundCodes.has(id)));
        allIds.forEach(id => activeChartFundCodes.delete(id));
      }
      showAllFundsActive = false;
      updateChart();
    };
  }

  funds.forEach((fund, i) => {
    const id = fund._id;
    const code = String(fund.code || '').trim();
    const name = fund.name || (code ? `基金${code}` : '未命名基金');
    const color = fund.color || getColorForIndex(i);
    const active = activeChartFundCodes.has(id);
    const row = document.createElement('div');
    row.className = 'chart-fund-list-item' + (active ? ' chart-fund-list-item-active' : '');
    row.dataset.fundId = id;
    row.setAttribute('role', 'listitem');
    row.innerHTML = `
      <div class="chart-fund-list-item-left">
        <span class="chart-fund-list-color" style="color:${color};background:${color};"></span>
        <span class="chart-fund-list-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
      </div>
      ${code ? `<span class="chart-fund-list-code">${code}</span>` : ''}
    `;
    listEl.appendChild(row);
  });

  // 收起态色点
  const toggleBtn = document.getElementById('chart-fund-list-toggle');
  if (toggleBtn) {
    let dotsWrap = toggleBtn.querySelector('.chart-collapsed-dots');
    if (dotsWrap) dotsWrap.remove();
    dotsWrap = document.createElement('span');
    dotsWrap.className = 'chart-collapsed-dots';
    funds.forEach((fund, i) => {
      const color = fund.color || getColorForIndex(i);
      const active = activeChartFundCodes.has(fund._id);
      const dot = document.createElement('span');
      dot.className = 'chart-collapsed-dot' + (active ? ' active' : '');
      dot.style.color = color;
      dot.style.background = color;
      dotsWrap.appendChild(dot);
    });
    toggleBtn.appendChild(dotsWrap);
  }

  // 使用事件委托处理列表项点击，避免为每项单独绑定监听器
  if (!listEl.dataset.boundClick) {
    listEl.addEventListener('click', (e) => {
      const row = e.target.closest('.chart-fund-list-item');
      if (!row) return;
      const id = row.dataset.fundId;
      if (!id) return;
      if (activeChartFundCodes.has(id)) {
        activeChartFundCodes.delete(id);
        row.classList.remove('chart-fund-list-item-active');
      } else {
        activeChartFundCodes.add(id);
        row.classList.add('chart-fund-list-item-active');
      }
      updateChart();
    });
    listEl.dataset.boundClick = '1';
  }
}

/** 初始化收起/展开按钮 */
function initChartFundListToggle() {
  const toggleBtn = document.getElementById('chart-fund-list-toggle');
  const aside = document.getElementById('chart-main-right');
  if (!toggleBtn || !aside) return;

  // 无障碍属性：指示收起/展开状态
  toggleBtn.setAttribute('aria-controls', 'chart-fund-list');
  toggleBtn.setAttribute('aria-expanded', aside.classList.contains('collapsed') ? 'false' : 'true');
  toggleBtn.addEventListener('click', () => {
    const collapsed = aside.classList.toggle('collapsed');
    const arrow = toggleBtn.querySelector('.chart-fund-list-toggle-arrow');
    if (arrow) arrow.textContent = collapsed ? '›' : '‹';
    toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });
}

/** 读取显示区间：{ min: number|null, max: number|null }，都为空时返回 { min: null, max: null } */
function getDisplayRange() {
  const minVal = parseDaysInput(document.getElementById('calc-days-min')?.value);
  const maxVal = parseDaysInput(document.getElementById('calc-days-max')?.value);
  return { min: minVal, max: maxVal };
}

/** 是否勾选「去除前7天」 */
function getSkipFirst7() {
  return !!document.getElementById('skip-first-7')?.checked;
}

/** 是否显示数据悬浮窗 */
function getShowTooltip() {
  return !!document.getElementById('show-tooltip')?.checked;
}

/** 是否开启联接基金穿透（年化费率 = 联接年化 + 母基金年化）。ETF 联接不存在双重收费，功能保留但默认不启用，开关已隐藏。 */
function getPenetrateFeeder() {
  return false;
}

/** 图表与悬浮窗中显示的基金名：已穿透的联接基金后加「(穿透)」标注 */
function getFundDisplayName(fund) {
  const name = fund && fund.name ? String(fund.name).trim() : '';
  if (fund && fund.__penetrationInfo) return name ? name + ' (穿透)' : '(穿透)';
  return name || '基金';
}

/** 图表下方纵向表格：按代码缓存的基金详情（与基金列表同源字段），用于补全 fundType、跟踪标的等 */
let chartFundDetailCache = {};
/** 上次参与表格渲染的基金列表，供异步拉取详情后重绘使用 */
let lastRenderedChartFunds = [];

/** 格式化卖出费率分段，与基金列表页一致 */
function formatSellFeeSegmentsForTable(segs) {
  if (!Array.isArray(segs) || !segs.length) return '-';
  const sorted = segs.slice().sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  const parts = sorted.map(s => {
    const label = s.unbounded ? `≥${s.days}天` : `${s.days}天`;
    const pct = (s.rate != null ? s.rate * 100 : 0).toFixed(2) + '%';
    return `${label}:${pct}`;
  });
  const maxParts = 4;
  return parts.length > maxParts ? parts.slice(0, maxParts).join('，') + '，…' : parts.join('，');
}

/** 格式化交易状态，与基金列表页一致 */
function formatTradingStatusForTable(status) {
  if (!status || (!status.subscribe && !status.redeem)) return '-';
  const parts = [];
  if (status.subscribe) parts.push(`申购：${status.subscribe}`);
  if (status.redeem) parts.push(`赎回：${status.redeem}`);
  return parts.join('，');
}

/**
 * 渲染图表下方纵向表格：第一行为各基金名称（带颜色），以下每行为一个字段（与基金列表一致）
 * @param {Array<{_id:string,name:string,code?:string,color:string,buyFee?:number,annualFee?:number,sellFeeSegments?:Array}>} funds 当前显示在图表中的基金
 */
function renderChartFundTable(funds) {
  const section = document.getElementById('chart-fund-table-section');
  const wrap = document.getElementById('chart-fund-table-wrap');
  const tbody = document.getElementById('chart-fund-table-tbody');
  if (!section || !tbody) return;

  lastRenderedChartFunds = funds || [];

  if (!funds || funds.length === 0) {
    section.setAttribute('aria-hidden', 'true');
    tbody.innerHTML = '';
    return;
  }

  section.setAttribute('aria-hidden', 'false');

  const getDetail = (fund) => {
    const code = fund && (fund.code || '').trim();
    return (code && chartFundDetailCache[code]) || null;
  };

  const rowLabels = ['代码', '名称', '基金类型', '买入费率', '年化费率', '卖出费率分段', '跟踪标的', '业绩基准', '基金公司', '交易状态', '更新时间'];
  const getCell = (fund, rowKey) => {
    const d = getDetail(fund);
    const code = (fund.code || '').trim();
    const name = (fund.name || '').trim() || '-';
    switch (rowKey) {
      case '代码': return code || '-';
      case '名称': return name;
      case '基金类型': return (d && (d.fundType || d.fundtype)) || '-';
      case '买入费率': return fund.buyFee != null ? (fund.buyFee * 100).toFixed(2) + '%' : '-';
      case '年化费率': return fund.annualFee != null ? (fund.annualFee * 100).toFixed(2) + '%' : '-';
      case '卖出费率分段': return formatSellFeeSegmentsForTable(fund.sellFeeSegments);
      case '跟踪标的': return (d && (d.trackingTarget || d.trackingIndex)) || '-';
      case '业绩基准': return (d && d.performanceBenchmark) || '-';
      case '基金公司': return (d && d.fundManager) || '-';
      case '交易状态': return (d && d.tradingStatus) ? formatTradingStatusForTable(d.tradingStatus) : '-';
      case '更新时间': return (d && d.updatedAt) || '-';
      default: return '-';
    }
  };

  let html = '';
  const headerCells = funds.map(f => {
    const name = getFundDisplayName(f);
    const color = f.color || getColorForIndex(0);
    return `<th class="chart-fund-table-th-name" scope="col"><span class="chart-fund-table-name-dot" style="background:${color}"></span>${escapeHtml(name)}</th>`;
  });
  html += '<tr><th class="chart-fund-table-th-label" scope="row">项目</th>' + headerCells.join('') + '</tr>';

  rowLabels.forEach(label => {
    const cells = funds.map(f => escapeHtml(getCell(f, label)));
    html += `<tr><th class="chart-fund-table-th-label" scope="row">${escapeHtml(label)}</th>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
  });

  tbody.innerHTML = html;

  funds.forEach((fund) => {
    const code = (fund.code || '').trim();
    if (code.length !== 6) return;
    if (chartFundDetailCache[code]) return;
    fetch(`data/allfund/funds/${code}.json`).then(r => r.ok ? r.json() : null).then(data => {
      if (!data) return;
      chartFundDetailCache[code] = data;
      renderChartFundTable(lastRenderedChartFunds);
    }).catch(() => {});
  });
}

/** 联接/母基金索引缓存 */
let feederIndexCache = null;
async function ensureFeederIndex() {
  if (feederIndexCache) return feederIndexCache;
  feederIndexCache = await fetchFeederIndexFromAPI();
  return feederIndexCache;
}

/**
 * 对联接基金做年化费率穿透：年化 = 联接年化 + 母基金年化，买入/卖出费率不变。
 * 为被穿透的基金附加 __penetrationInfo 供图例展示。
 * @param {Array<{code?:string, annualFee?:number, [k:string]:any}>} funds
 * @returns {Promise<typeof funds>} 同一数组（已就地修改）
 */
async function applyFeederPenetration(funds) {
  const { codeToFeeder } = await ensureFeederIndex();
  if (!codeToFeeder || Object.keys(codeToFeeder).length === 0) return funds;
  for (const fund of funds) {
    const code = fund.code && String(fund.code).trim();
    if (!code || code.length !== 6) continue;
    const info = codeToFeeder[code];
    if (!info || !info.isFeeder || !info.masterCode) continue;
    const master = await fetchFundFeeFromAPI(info.masterCode);
    const originalAnnual = fund.annualFee ?? 0;
    const masterAnnual = (master && typeof master.annualFee === 'number') ? master.annualFee : 0;
    const penetratedAnnual = originalAnnual + masterAnnual;
    fund.annualFee = penetratedAnnual;
    fund.__penetrationInfo = {
      masterName: info.masterName || `母基金${info.masterCode}`,
      masterCode: info.masterCode,
      originalAnnual,
      masterAnnual,
      penetratedAnnual
    };
  }
  return funds;
}

/** 未指定显示区间时，在 [1, CALC_EXTENDED_DAYS] 内算交叉点，显示结束 = max(365, dynamic)，dynamic = max(表格最大天数+100, 最后交叉点+50)；表格最大天数取各分段 days 的最大值（含无上限段的起算天数，如 730、1000） */
const CALC_EXTENDED_DAYS = 7300;
function getEffectiveMaxDays(funds) {
  const maxSegmentDays = funds.reduce((acc, f) => {
    const segs = f.sellFeeSegments ?? [];
    const m = segs.length ? Math.max(...segs.map(s => s.days)) : 0;
    return Math.max(acc, m);
  }, 0);
  const crossovers = findAllCrossovers(funds, CALC_EXTENDED_DAYS);
  const lastCrossover = crossovers.length ? Math.max(...crossovers.map(c => c.days)) : 0;
  const dynamic = Math.max(maxSegmentDays + 100, lastCrossover + 50);
  return Math.max(365, Math.min(dynamic, CALC_EXTENDED_DAYS));
}

/** 十字线 overlay：仅创建一次并绑定 canvas 事件 */
function setupCrosshair(canvas) {
  if (!canvas) return;
  const wrapper = canvas.parentElement;
  if (!wrapper) return;
  let overlay = document.getElementById('chart-crosshair-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'chart-crosshair-overlay';
    overlay.className = 'chart-crosshair-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="chart-crosshair-v" id="chart-crosshair-v"></div>
      <div class="chart-crosshair-h" id="chart-crosshair-h"></div>
      <div class="chart-crosshair-label-x" id="chart-crosshair-label-x"></div>
      <div class="chart-crosshair-label-y" id="chart-crosshair-label-y"></div>
      <div class="chart-crosshair-info" id="chart-crosshair-info"></div>
    `;
    wrapper.appendChild(overlay);
    const labelX = overlay.querySelector('#chart-crosshair-label-x');
    const labelY = overlay.querySelector('#chart-crosshair-label-y');
    const lineV = overlay.querySelector('#chart-crosshair-v');
    const lineH = overlay.querySelector('#chart-crosshair-h');
    const infoEl = overlay.querySelector('#chart-crosshair-info');
    canvas.addEventListener('mousemove', (e) => {
      if (!chartInstance) {
        overlay.classList.remove('visible');
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const scaleX = chartInstance.scales.x;
      const scaleY = chartInstance.scales.y;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let dataX = scaleX.getValueForPixel(x);
      let dataY = scaleY.getValueForPixel(y);
      const minX = scaleX.min;
      const maxX = scaleX.max;
      const minY = scaleY.min;
      const maxY = scaleY.max;
      dataX = Math.max(minX, Math.min(maxX, dataX));
      dataY = Math.max(minY, Math.min(maxY, dataY));
      const dayInt = Math.floor(dataX);
      const pixelX = scaleX.getPixelForValue(dayInt);
      const pixelY = scaleY.getPixelForValue(dataY);
      lineV.style.left = pixelX + 'px';
      lineH.style.top = pixelY + 'px';
      labelX.style.left = pixelX + 'px';
      labelX.textContent = dayInt + '天';
      labelY.style.top = pixelY + 'px';
      labelY.textContent = dataY.toFixed(2) + '%';
      if (infoEl && lastFundsForCrosshair.length > 0) {
        // 控制固定数据悬浮窗显示与位置（由“数据悬浮窗”开关控制）
        if (getShowTooltip()) {
          const lines = ['持有天数: ' + dayInt];
          lastFundsForCrosshair.forEach((fund, i) => {
            const rate = calcTotalFeeRate(fund, dayInt) * 100;
            const color = fund.color || getColorForIndex(i);
            const displayName = getFundDisplayName(fund);
            lines.push('<span class="chart-crosshair-info-fund" style="color:' + color + '">' + escapeHtml(displayName) + ': ' + rate.toFixed(2) + '%</span>');
          });
          infoEl.innerHTML = lines.join('<br>');
          infoEl.style.display = 'block';
          // 鼠标在图表右半边时，把固定悬浮窗移到左侧，避免遮挡
          const isRightHalf = x > rect.width / 2;
          if (isRightHalf) {
            infoEl.style.right = '';
            infoEl.style.left = '20px';
          } else {
            infoEl.style.left = '';
            infoEl.style.right = '8px';
          }
        } else {
          infoEl.innerHTML = '';
          infoEl.style.display = 'none';
        }
      }
      overlay.classList.add('visible');
    });
    canvas.addEventListener('mouseleave', () => overlay.classList.remove('visible'));
  }
}

/** 更新图表（开启联接穿透时为异步：会拉取母基金费率） */
async function updateChart() {
  const allFunds = collectFunds();
  // 渲染右侧列表时使用全部基金（含未高亮的），确保列表始终完整
  renderChartFundList(allFunds);
  // 按右侧选择列表过滤参与图表计算的基金
  let funds = allFunds.filter(f => activeChartFundCodes.has(f._id));
  const canvas = document.getElementById('chart-canvas');
  const legendEl = document.getElementById('crossover-legend');

  if (getPenetrateFeeder() && funds.length > 0) {
    funds = await applyFeederPenetration(funds);
  }

  if (funds.length === 0) {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    const crosshairEl = document.getElementById('chart-crosshair-overlay');
    if (crosshairEl) crosshairEl.classList.remove('visible');
    legendEl.innerHTML = '<p class="none">请添加基金并填写费率</p>';
    renderChartFundTable([]);
    return;
  }

  syncCardColors(funds);
  renderChartFundTable(funds);

  const skipFirst7 = getSkipFirst7();
  const defaultMinDay = skipFirst7 ? 8 : 0;
  const range = getDisplayRange();
  let displayMin, displayMax;
  if (range.min === null && range.max === null) {
    displayMin = defaultMinDay;
    displayMax = getEffectiveMaxDays(funds);
  } else if (range.max === null) {
    const x = range.min;
    if (skipFirst7 && x > 7) {
      const minEl = document.getElementById('calc-days-min');
      const maxEl = document.getElementById('calc-days-max');
      if (minEl) minEl.value = 8;
      if (maxEl) maxEl.value = String(x);
      displayMin = 8;
      displayMax = x;
      saveState();
    } else {
      displayMin = 0;
      displayMax = x;
    }
  } else if (range.min === null) {
    const x = range.max;
    if (skipFirst7 && x > 7) {
      const minEl = document.getElementById('calc-days-min');
      if (minEl) minEl.value = 8;
      displayMin = 8;
      displayMax = x;
      saveState();
    } else {
      displayMin = 0;
      displayMax = x;
    }
  } else {
    displayMin = Math.min(range.min, range.max);
    displayMax = Math.max(range.min, range.max);
  }
  const displayDays = Math.max(0, displayMax - displayMin + 1);

  // 优化：动态步长，减少大跨度下的计算与渲染压力
  let step = 1;
  if (displayDays > 3650) step = 10;
  else if (displayDays > 1825) step = 7;
  else if (displayDays > 1095) step = 5;
  else if (displayDays > 730) step = 3;
  else if (displayDays > 365) step = 2;
  
  lastFundsForCrosshair = funds;

  const datasets = funds.map((fund, i) => {
    const curve = calcFeeCurve(fund, displayMax, step);
    const points = curve.filter(p => p.days >= displayMin && p.days <= displayMax).map(p => ({ x: p.days, y: p.feeRate * 100 }));
    return {
      label: getFundDisplayName(fund),
      data: points,
      borderColor: fund.color,
      backgroundColor: fund.color + '20',
      borderWidth: 2,
      fill: false,
      tension: 0.1,
      pointRadius: 0,
      pointHoverRadius: 6,
      pointHitRadius: 20,
      // 优化：大数据量时禁用解析，提高性能
      parsing: displayDays > 1000 ? false : undefined,
      normalized: true,
      spanGaps: true
    };
  });

  function getOptimalFundIndex(atDay) {
    let minFee = Infinity, idx = 0;
    funds.forEach((f, i) => {
      const fee = calcTotalFeeRate(f, atDay);
      if (fee < minFee) { minFee = fee; idx = i; }
    });
    return idx;
  }

  // 合并同一天的多个交叉点为全局最优切换点
  let rawCrossovers = findAllCrossovers(funds, displayMax);
  rawCrossovers = rawCrossovers.filter(c => c.days >= displayMin);
  const uniqueCrossDays = [...new Set(rawCrossovers.map(c => c.days))].sort((a, b) => a - b);
  const optimalSwitches = [];
  let prevOptIdx = getOptimalFundIndex(displayMin);
  for (const day of uniqueCrossDays) {
    const nextDay = day + 1;
    const optIdx = getOptimalFundIndex(nextDay);
    if (optIdx !== prevOptIdx) {
      const fee = calcTotalFeeRate(funds[optIdx], nextDay);
      optimalSwitches.push({
        days: day,
        fundIndex: optIdx,
        prevFundIndex: prevOptIdx,
        beforeCross: funds[prevOptIdx].name,
        afterCross: funds[optIdx].name,
        feeRate: fee,
        annualizedFeeRate: toAnnualizedFeeRate(fee, nextDay)
      });
      prevOptIdx = optIdx;
    }
  }

  // 交叉点以空心圆环显示在交叉日往后一天，“第二天更低”的那条曲线上，描边加厚，悬停时发光
  optimalSwitches.forEach((s) => {
    const dayNext = s.days + 1;
    const yNext = calcTotalFeeRate(funds[s.fundIndex], dayNext) * 100;
    const color = funds[s.fundIndex].color || getColorForIndex(s.fundIndex);
    datasets.push({
      crossover: s,
      label: '\u200b',
      data: [{ x: dayNext, y: yNext }],
      borderColor: color,
      backgroundColor: '#1c2636',
      borderWidth: 3,
      pointRadius: 6,
      pointHoverRadius: 14,
      pointHoverBorderWidth: 5,
      pointHitRadius: 28,
      pointStyle: 'circle',
      showLine: false,
      order: -1
    });
  });

  // 色带时段：按天计算每段费率最优的基金并合并连续段（仅 [displayMin, displayMax]）
  const bandStep = Math.max(1, Math.floor(displayDays / 400));
  const bandSegments = [];
  let prevWinner = -1, segStart = displayMin;
  for (let d = displayMin; d <= displayMax; d += bandStep) {
    let winner = 0;
    let minF = calcTotalFeeRate(funds[0], d);
    for (let i = 1; i < funds.length; i++) {
      const f = calcTotalFeeRate(funds[i], d);
      if (f < minF) { minF = f; winner = i; }
    }
    if (winner !== prevWinner) {
      if (prevWinner >= 0) bandSegments.push({ start: segStart, end: d - 1, fundIndex: prevWinner });
      segStart = d;
      prevWinner = winner;
    }
  }
  if (prevWinner >= 0) bandSegments.push({ start: segStart, end: displayMax, fundIndex: prevWinner });

  // 当且仅当所有基金的 7 天卖出费率均为 1.5% 时，0–7 日色带标红（惩罚期）
  const allFunds7DaySellRate15 = !skipFirst7 && funds.length > 0 && funds.every(f => getSellFeeRate(7, f.sellFeeSegments) === 0.015);
  const displaySegments = [];
  bandSegments.forEach(seg => {
    const overlaps07 = seg.start <= 7 && seg.end >= 1;
    if (allFunds7DaySellRate15 && overlaps07) {
      if (seg.start <= 7) displaySegments.push({ start: seg.start, end: Math.min(7, seg.end), fundIndex: seg.fundIndex, redNoText: true });
      if (seg.end > 7) displaySegments.push({ start: Math.max(8, seg.start), end: seg.end, fundIndex: seg.fundIndex, redNoText: false });
    } else {
      displaySegments.push({ ...seg, redNoText: false });
    }
  });

  if (chartInstance) chartInstance.destroy();

  const Chart = window.Chart;
  const gridColor = 'rgba(37, 48, 68, 0.6)';
  const tickColor = '#94a3b8';
  const titleColor = '#94a3b8';
  const chartFont = { family: "'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif" };

  chartInstance = new Chart(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // 优化：当数据集或点数较多时，禁用动画以提升响应速度
      animation: (datasets.length > 20 || displayDays > 1000) ? false : { duration: 400 },
      layout: { padding: { left: 0, right: 8, top: 4, bottom: 0 } },
      interaction: { intersect: true, mode: 'nearest' },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            filter: (item, chart) => !chart.datasets[item.datasetIndex].crossover,
            color: tickColor,
            font: { ...chartFont, size: 12, weight: '500' },
            padding: 16,
            usePointStyle: true,
            pointStyle: 'circle',
            boxWidth: 8,
            boxHeight: 8
          }
        },
        tooltip: {
          // 恢复 Chart.js 自带的曲线悬浮窗
          enabled: true,
          backgroundColor: '#1c2636',
          borderColor: '#3a4d6a',
          borderWidth: 1,
          titleColor: '#e8edf4',
          bodyColor: '#94a3b8',
          titleFont: { ...chartFont, weight: '600' },
          bodyFont: { ...chartFont, size: 12 },
          padding: 10,
          cornerRadius: 8,
          displayColors: true,
          usePointStyle: true,
          boxPadding: 4,
          callbacks: {
            title: (items) => {
              if (!items.length) return '';
              const ctx = items[0];
              const c = ctx.dataset.crossover;
              if (c) return `${Math.round(c.days)}天`;
              return `持有 ${ctx.parsed.x} 天`;
            },
            label: (ctx) => {
              const c = ctx.dataset.crossover;
              if (c) {
                return `${c.beforeCross}<${c.afterCross}`;
              }
              const days = ctx.parsed.x;
              const feePct = ctx.parsed.y;
              const annualized = days > 0 ? (feePct / 100) * (365 / days) * 100 : 0;
              return `${ctx.dataset.label}: 累计 ${feePct.toFixed(2)}%，年化约 ${annualized.toFixed(2)}%`;
            },
            labelPointStyle: (ctx) => {
              if (ctx.dataset.crossover) {
                return { pointStyle: 'crossRot', rotation: 0 };
              }
              return { pointStyle: 'circle', rotation: 0 };
            },
            labelColor: (ctx) => {
              const ds = ctx.dataset;
              if (ds.crossover) {
                return { borderColor: ds.borderColor, backgroundColor: '#1c2636', borderWidth: 2 };
              }
              return { borderColor: ds.borderColor, backgroundColor: '#1c2636', borderWidth: 2 };
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: '持有天数（天）', color: titleColor, font: { ...chartFont, size: 12 } },
          type: 'linear',
          min: displayMin,
          max: displayMax,
          offset: false,
          grid: { color: gridColor, lineWidth: 0.5 },
          ticks: { color: tickColor, font: { ...chartFont, size: 11 } }
        },
        y: {
          title: { display: true, text: '累计费率（%）', color: titleColor, font: { ...chartFont, size: 12 } },
          beginAtZero: true,
          grid: { color: gridColor, lineWidth: 0.5 },
          ticks: {
            color: tickColor,
            font: { ...chartFont, size: 11 },
            callback: v => v + '%'
          }
        }
      }
    },
  });

  setupCrosshair(canvas);

  // 底部色带：左右各收缩 100px 与图表对齐，悬停/点击段时在下方显示气泡
  const bandEl = document.getElementById('optimal-band');
  if (bandEl) {
    bandEl.innerHTML = '';
    if (optimalSwitches.length > 0) {
      bandEl.style.display = 'block';
      bandEl.style.marginLeft = '60px';
      bandEl.style.marginRight = '15px';
      const strip = document.createElement('div');
      strip.className = 'optimal-band-strip';
      let pinnedSegment = null;
      displaySegments.forEach(seg => {
        const widthPct = ((seg.end - seg.start + 1) / displayDays * 100).toFixed(2) + '%';
        const segDiv = document.createElement('div');
        segDiv.className = 'optimal-band-segment';
        segDiv.style.width = widthPct;
        segDiv.style.backgroundColor = seg.redNoText ? 'var(--danger)' : (funds[seg.fundIndex].color || getColorForIndex(seg.fundIndex));
        const tooltip = document.createElement('div');
        tooltip.className = 'optimal-band-segment-tooltip';
        tooltip.textContent = seg.redNoText ? '惩罚期' : getFundDisplayName(funds[seg.fundIndex]);
        tooltip.setAttribute('aria-hidden', 'true');
        segDiv.appendChild(tooltip);
        const showTip = () => { tooltip.classList.add('visible'); };
        const hideTip = () => { if (pinnedSegment !== segDiv) tooltip.classList.remove('visible'); };
        segDiv.addEventListener('mouseenter', showTip);
        segDiv.addEventListener('mouseleave', hideTip);
        segDiv.addEventListener('click', (e) => {
          e.preventDefault();
          if (pinnedSegment === segDiv) {
            pinnedSegment = null;
            tooltip.classList.remove('visible');
          } else {
            if (pinnedSegment) pinnedSegment.querySelector('.optimal-band-segment-tooltip')?.classList.remove('visible');
            pinnedSegment = segDiv;
            tooltip.classList.add('visible');
          }
        });
        strip.appendChild(segDiv);
      });
      bandEl.appendChild(strip);
      // 使用交叉点数据标注天数，与图表横轴一致，避免大显示天数时因分段舍入产生偏移
      if (optimalSwitches.length > 0) {
        const labelsRow = document.createElement('div');
        labelsRow.className = 'optimal-band-labels';
        optimalSwitches.forEach(s => {
          const leftPct = ((s.days - displayMin) / displayDays * 100).toFixed(2) + '%';
          const span = document.createElement('span');
          span.className = 'optimal-band-boundary-label';
          span.style.left = leftPct;
          span.textContent = s.days;
          labelsRow.appendChild(span);
        });
        bandEl.appendChild(labelsRow);
      }
    } else {
      bandEl.style.display = 'none';
      bandEl.style.marginLeft = '';
      bandEl.style.marginRight = '';
    }
  }

  // 交叉点图例 / 全程最优（区间格式）
  const penetrationList = funds.filter(f => f.__penetrationInfo);
  if (optimalSwitches.length === 0) {
    const optimalIdx = getOptimalFundIndex(displayMin);
    const color = funds[optimalIdx].color || getColorForIndex(optimalIdx);
    let html = `<p class="optimal-single">费率最低：<strong style="color:${color}">${escapeHtml(funds[optimalIdx].name)}</strong></p>`;
    if (penetrationList.length > 0) {
      html += '<h4 class="penetration-legend-title">联接基金穿透</h4><ul class="penetration-legend-list">' +
        penetrationList.map(f => {
          const p = f.__penetrationInfo;
          const orig = (p.originalAnnual * 100).toFixed(2);
          const master = (p.masterAnnual * 100).toFixed(2);
          const pen = (p.penetratedAnnual * 100).toFixed(2);
          return `<li><span style="color:${f.color || '#94a3b8'}">${escapeHtml(f.name)}</span>：年化 ${orig}% + 母基金${escapeHtml(p.masterName)} ${master}% = 穿透年化 <strong>${pen}%</strong></li>`;
        }).join('') + '</ul>';
    }
    legendEl.innerHTML = html;
  } else {
    const initialIdx = getOptimalFundIndex(displayMin);
    const segments = [];
    const switchDays = optimalSwitches.map(s => s.days);
    segments.push({ rangeStart: 0, rangeEnd: switchDays[0], fundName: funds[initialIdx].name, fundIndex: initialIdx });
    for (let i = 0; i < optimalSwitches.length; i++) {
      const s = optimalSwitches[i];
      const start = switchDays[i];
      const end = i + 1 < switchDays.length ? switchDays[i + 1] : null;
      segments.push({
        rangeStart: start,
        rangeEnd: end,
        fundName: s.afterCross,
        fundIndex: s.fundIndex,
        feeRate: s.feeRate,
        annualizedFeeRate: s.annualizedFeeRate
      });
    }
    let html = `
      <h4>费用</h4>
      <ul>
        ${segments.map(seg => {
          const range = seg.rangeEnd != null ? `${seg.rangeStart}-${seg.rangeEnd} 天` : `${seg.rangeStart}+ 天`;
          const feeInfo = seg.feeRate != null ? `（累计费率 ${formatRate(seg.feeRate)}，年化费率 ${formatRate(seg.annualizedFeeRate)}）` : '';
          const idx = typeof seg.fundIndex === 'number' ? seg.fundIndex : funds.findIndex(f => f.name === seg.fundName);
          const color = idx >= 0 ? (funds[idx].color || getColorForIndex(idx)) : getColorForIndex(0);
          const displayName = idx >= 0 ? getFundDisplayName(funds[idx]) : seg.fundName;
          const nameHtml = `<span style="color:${color}">${escapeHtml(displayName)}</span>`;
          return `<li><strong>${range}</strong>：${nameHtml} ${feeInfo}</li>`;
        }).join('')}
      </ul>
    `;
    if (penetrationList.length > 0) {
      html += '<h4 class="penetration-legend-title">联接基金穿透</h4><ul class="penetration-legend-list">' +
        penetrationList.map(f => {
          const p = f.__penetrationInfo;
          const orig = (p.originalAnnual * 100).toFixed(2);
          const master = (p.masterAnnual * 100).toFixed(2);
          const pen = (p.penetratedAnnual * 100).toFixed(2);
          return `<li><span style="color:${f.color || '#94a3b8'}">${escapeHtml(f.name)}</span>：年化 ${orig}% + 母基金${escapeHtml(p.masterName)} ${master}% = 穿透年化 <strong>${pen}%</strong></li>`;
        }).join('') + '</ul>';
    }
    legendEl.innerHTML = html;
  }
}

/** 基金卡片区域：保留横向拖动条，但滚轮恢复为默认竖向滚动行为 */
function setupFundCardsWheelScroll() {
  // 旧逻辑会在悬停基金卡片区域时，拦截滚轮事件并改为横向滚动。
  // 按当前需求，去除该行为，仅依赖浏览器默认滚动和横向滚动条拖动。
  const el = document.getElementById('fund-cards');
  if (!el) return;
}

function renderImportResultsList(container, items) {
  if (!container) return;
  container.innerHTML = '';
  items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'fund-import-result-item';
    row.dataset.index = String(index);
    row.innerHTML = `
      <div class="fund-import-result-main">
        <div class="fund-import-result-line1">
          <span class="fund-import-result-name">${escapeHtml(item.name || (item.code ? '基金' + item.code : '未命名基金'))}</span>
          ${item.code ? `<span class="fund-import-result-code">${escapeHtml(item.code)}</span>` : ''}
          <span class="fund-import-result-badge">${item.code ? '按代码匹配' : '按名称匹配'}</span>
        </div>
        <div class="fund-import-result-source">来源：${escapeHtml(item.source || '')}</div>
      </div>
      <div class="fund-import-result-actions">
        <button type="button" class="btn btn-sm btn-secondary fund-import-remove-item">删除</button>
      </div>
    `;
    const removeBtn = row.querySelector('.fund-import-remove-item');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        importParsedItems.splice(index, 1);
        renderImportResultsList(container, importParsedItems);
        const emptyHint = document.getElementById('fund-import-empty-hint');
        if (emptyHint) emptyHint.hidden = importParsedItems.length > 0;
      });
    }
    container.appendChild(row);
  });
}

async function applyImportedFunds(items) {
  for (const item of items) {
    if (item.code) {
      const data = await fetchFundFeeFromAPI(item.code);
      if (data) {
        addFundCard(data);
        continue;
      }
    }
    addFundCard({
      name: item.name || (item.code ? `基金${item.code}` : '未命名基金'),
      ...(item.code ? { code: item.code } : {})
    });
  }
}

function setupImportModal() {
  const btn = document.getElementById('import-funds');
  const backdrop = document.getElementById('fund-import-modal');
  const confirmBackdrop = document.getElementById('fund-import-confirm-modal');
  const closeBtn = document.getElementById('fund-import-modal-close');
  const cancelBtn = document.getElementById('fund-import-modal-cancel');
  const startBtn = document.getElementById('fund-import-start');
  const textArea = document.getElementById('fund-import-text');
  const fileInput = document.getElementById('fund-import-file');
  const fileNameEl = document.getElementById('fund-import-file-name');
  const dropzone = document.getElementById('fund-import-dropzone');

  const confirmCloseBtn = document.getElementById('fund-import-confirm-close');
  const confirmCancelBtn = document.getElementById('fund-import-confirm-cancel');
  const confirmApplyBtn = document.getElementById('fund-import-confirm-apply');
  const resultListEl = document.getElementById('fund-import-result-list');
  const emptyHintEl = document.getElementById('fund-import-empty-hint');

  if (!btn || !backdrop || !textArea || !startBtn || !confirmBackdrop || !resultListEl) return;

  function resetImportState() {
    importParsedItems = [];
    if (textArea) textArea.value = '';
    if (fileInput) fileInput.value = '';
    if (fileNameEl) fileNameEl.textContent = '';
    if (resultListEl) resultListEl.innerHTML = '';
    if (emptyHintEl) emptyHintEl.hidden = true;
  }

  btn.addEventListener('click', () => {
    resetImportState();
    openModal(backdrop);
    textArea.focus();
  });

  [closeBtn, cancelBtn].forEach(el => {
    if (!el) return;
    el.addEventListener('click', () => {
      closeModal(backdrop);
    });
  });

  if (confirmCloseBtn) {
    confirmCloseBtn.addEventListener('click', () => {
      closeModal(confirmBackdrop);
    });
  }

  if (confirmCancelBtn) {
    confirmCancelBtn.addEventListener('click', () => {
      // 返回导入弹窗：关闭确认弹窗，重新打开导入弹窗
      closeModal(confirmBackdrop);
      openModal(backdrop);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (confirmBackdrop.classList.contains('modal-visible')) {
        closeModal(confirmBackdrop);
      } else if (backdrop.classList.contains('modal-visible')) {
        closeModal(backdrop);
      }
    }
  });

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!fileNameEl) return;
      if (file) {
        fileNameEl.textContent = `已选择：${file.name}`;
      } else {
        fileNameEl.textContent = '';
      }
    });
  }

  if (dropzone) {
    ['dragenter', 'dragover'].forEach(evt => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('import-file-dragover');
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('import-file-dragover');
      });
    });
    dropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (!dt || !dt.files || dt.files.length === 0 || !fileInput) return;
      const file = dt.files[0];
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      if (fileNameEl) fileNameEl.textContent = `已选择：${file.name}`;
    });
  }

  startBtn.addEventListener('click', async () => {
    const file = fileInput && fileInput.files && fileInput.files[0];
    const rawText = textArea.value || '';
    startBtn.disabled = true;
    try {
      // 1) 优先处理 .ziva 快照导入：直接恢复整个页面状态
      if (file) {
        const nameLower = file.name.toLowerCase();
        if (nameLower.endsWith('.ziva')) {
          try {
            const txt = await readFileAsText(file);
            const parsed = JSON.parse(txt);
            const state = extractStateFromSnapshot(parsed);
            if (state && state.funds) {
              closeModal(backdrop);
              closeModal(confirmBackdrop);
              restoreState(state);
              saveState();
              return;
            }
          } catch (e) {
            // 若解析失败则继续按普通文本/表格逻辑处理
          }
        }
      }

      // 2) 常规导入：文本 / CSV / Excel
      let items = [];
      if (file) {
        const type = file.type || '';
        const nameLower = file.name.toLowerCase();
        if (type.startsWith('text/') || nameLower.endsWith('.txt') || nameLower.endsWith('.csv')) {
          const txt = await readFileAsText(file);
          const lines = normalizeImportText(txt).split('\n').map(line => {
            const first = line.split(/[,;\t]/)[0];
            return first;
          });
          items = await parseImportFromLines(lines, ensureSearchIndex);
        } else if (nameLower.endsWith('.xls') || nameLower.endsWith('.xlsx')) {
          const lines = await readExcelFirstColumn(file);
          items = await parseImportFromLines(lines, ensureSearchIndex);
        }
      }
      if (!file || items.length === 0) {
        const textItems = await parseImportFromText(rawText, ensureSearchIndex);
        if (textItems.length > 0) {
          items = textItems;
        }
      }
      importParsedItems = items;
      closeModal(backdrop);
      if (!items.length) {
        importParsedItems = [];
        resultListEl.innerHTML = '';
        if (emptyHintEl) emptyHintEl.hidden = false;
        openModal(confirmBackdrop);
        return;
      }
      renderImportResultsList(resultListEl, items);
      if (emptyHintEl) emptyHintEl.hidden = items.length > 0;
      openModal(confirmBackdrop);
    } finally {
      startBtn.disabled = false;
    }
  });

  confirmApplyBtn?.addEventListener('click', async () => {
    if (!importParsedItems.length) {
      closeModal(confirmBackdrop);
      return;
    }
    confirmApplyBtn.disabled = true;
    try {
      await applyImportedFunds(importParsedItems);
      importParsedItems = [];
      closeModal(confirmBackdrop);
    } finally {
      confirmApplyBtn.disabled = false;
    }
  });
}

/** 初始化 */
function init() {
  document.getElementById('add-fund').addEventListener('click', () => addFundCard());
  setupImportModal();
  const exportBtn = document.getElementById('export-funds');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      try {
        const snapshot = buildExportSnapshot();
        const json = JSON.stringify(snapshot, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const ts = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const tsStr = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}`;
        a.href = url;
        a.download = `fund-calculator-${tsStr}.ziva`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        // 静默失败，避免打断用户操作
      }
    });
  }
  setupFundCardsWheelScroll();
  const clearBtn = document.getElementById('clear-storage');
  if (clearBtn) clearBtn.addEventListener('click', clearStoredState);
  const clearCalcDaysBtn = document.getElementById('clear-calc-days');
  if (clearCalcDaysBtn) clearCalcDaysBtn.addEventListener('click', () => {
    const minEl = document.getElementById('calc-days-min');
    const maxEl = document.getElementById('calc-days-max');
    if (minEl) minEl.value = '';
    if (maxEl) maxEl.value = '';
    updateChart();
    saveState();
  });
  const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
  ['calc-days-min', 'calc-days-max'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', debounce(() => { updateChart(); saveState(); }, 300));
  });
  const skipFirst7El = document.getElementById('skip-first-7');
  if (skipFirst7El) {
    skipFirst7El.addEventListener('change', () => {
      if (!skipFirst7El.checked) {
        const minEl = document.getElementById('calc-days-min');
        const maxEl = document.getElementById('calc-days-max');
        const minVal = parseDaysInput(minEl?.value);
        const maxVal = parseDaysInput(maxEl?.value);
        if (minVal === 8 && maxVal != null && maxVal > 7) {
          if (minEl) minEl.value = '';
        }
      }
      updateChart();
      saveState();
    });
  }
  const showTooltipEl = document.getElementById('show-tooltip');
  if (showTooltipEl) {
    showTooltipEl.addEventListener('change', () => {
      // 仅控制右上角固定数据悬浮窗，不再控制曲线悬浮窗
      updateChart();
      saveState();
    });
  }
  const penetrateFeederEl = document.getElementById('penetrate-linked');
  if (penetrateFeederEl) {
    penetrateFeederEl.addEventListener('change', () => {
      updateChart();
      saveState();
    });
  }
  const quick60Btn = document.getElementById('calc-days-60');
  const quick365Btn = document.getElementById('calc-days-365');
  const quickMaxBtn = document.getElementById('calc-days-max-btn');
  const calcMaxInput = document.getElementById('calc-days-max');
  const applyQuick = (val) => {
    if (!calcMaxInput) return;
    calcMaxInput.value = String(val);
    updateChart();
    saveState();
  };
  if (quick60Btn) quick60Btn.addEventListener('click', () => applyQuick(60));
  if (quick365Btn) quick365Btn.addEventListener('click', () => applyQuick(365));
  if (quickMaxBtn) quickMaxBtn.addEventListener('click', () => applyQuick(CALC_EXTENDED_DAYS));
  const discountSelect = document.getElementById('buy-fee-discount');
  if (discountSelect) {
    const applyDiscountFromSelect = () => {
      const n = parseFloat(discountSelect.value);
      buyFeeDiscountFactor = !isNaN(n) && n >= 0 ? n : 1;
    };
    discountSelect.addEventListener('change', () => {
      applyDiscountFromSelect();
      updateChart();
      saveState();
    });
    applyDiscountFromSelect();
  }
  const demoBtn = document.getElementById('demo-btn');
  if (demoBtn) {
    demoBtn.addEventListener('click', async () => {
      demoBtn.disabled = true;
      const results = await Promise.all(DEMO_FUND_CODES.map(c => fetchFundFeeFromAPI(c)));
      const funds = results.filter(Boolean);
      demoBtn.disabled = false;
      if (funds.length > 0) {
        restoreState({ funds });
        saveState();
      }
    });
  }
  async function handleRandomDataClick(btn) {
    if (!btn) return;
    btn.disabled = true;
    const codes = await fetchFundCodesFromAPI();
    if (codes.length < 3) {
      btn.disabled = false;
      return;
    }
    const count = Math.min(3 + Math.floor(Math.random() * 6), codes.length);
    const picked = shuffle(codes).slice(0, count);
    const results = await Promise.all(picked.map(c => fetchFundFeeFromAPI(c)));
    const funds = results.filter(Boolean);
    btn.disabled = false;
    if (funds.length > 0) {
      restoreState({ funds });
      saveState();
    }
  }
  const randomDataBtn = document.getElementById('random-data');
  if (randomDataBtn) {
    randomDataBtn.addEventListener('click', () => handleRandomDataClick(randomDataBtn));
  }
  const randomDataBottomBtn = document.getElementById('random-data-bottom');
  if (randomDataBottomBtn) {
    randomDataBottomBtn.addEventListener('click', () => handleRandomDataClick(randomDataBottomBtn));
  }

  setupIndexPickerModal({ addFundCard });
  initChartFundListToggle();
  const searchInput = document.getElementById('fund-search-input');
  const searchDropdown = document.getElementById('fund-search-dropdown');
  let searchHighlightIndex = -1;

  function isFundAddedByCode(code) {
    const cards = document.querySelectorAll('.fund-card');
    const target = String(code || '').trim();
    if (!target) return false;
    return Array.from(cards).some(c => (c.dataset.fundCode || '').trim() === target);
  }

  function markSearchItemAddedByCode(code) {
    if (!searchDropdown) return;
    const target = String(code || '').trim();
    if (!target) return;
    searchDropdown.querySelectorAll('.fund-search-add-btn').forEach(btn => {
      if (btn.dataset.code === target) {
        btn.classList.add('added');
        btn.textContent = '✓';
        btn.title = '已添加';
      }
    });
  }

  let lastSearchItems = [];

  function showDropdown(items) {
    if (!searchDropdown) return;
    searchHighlightIndex = -1;
    searchDropdown.innerHTML = '';
    if (!items || items.length === 0) {
      lastSearchItems = [];
      searchDropdown.setAttribute('aria-hidden', 'true');
      searchDropdown.classList.remove('fund-search-dropdown-visible');
      return;
    }
    lastSearchItems = items;
    items.forEach((item, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.index = String(i);
      li.dataset.code = item.code;
      li.dataset.name = item.name;
      const added = isFundAddedByCode(item.code);
      li.innerHTML = `
        <span class="fund-search-code">${item.code}</span>
        <span class="fund-search-name">${item.name}</span>
        <button type="button" class="fund-search-add-btn ${added ? 'added' : ''}" data-code="${item.code}" title="${added ? '已添加，点击移除' : '添加到卡片'}">
          ${added ? '✓' : '+'}
        </button>
      `;
      li.addEventListener('click', (e) => {
        if (e.target && e.target.classList.contains('fund-search-add-btn')) return;
        selectSearchItem(item);
      });
      const addBtn = li.querySelector('.fund-search-add-btn');
      if (addBtn) {
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (added) {
            removeCardByFundCode(item.code);
            showDropdown(lastSearchItems);
          } else {
            selectSearchItem(item, true);
          }
        });
      }
      searchDropdown.appendChild(li);
    });
    searchDropdown.setAttribute('aria-hidden', 'false');
    searchDropdown.classList.add('fund-search-dropdown-visible');
  }

  function selectSearchItem(item, fromAddButton = false) {
    if (!item || !item.code) return;
    (async () => {
      const data = await fetchFundFeeFromAPI(item.code);
      const payload = data || { name: item.name || `基金${item.code}`, code: item.code };
      addFundCard(payload);
      // 不收起下拉：用当前列表刷新一次，更新「+ / ✓」状态
      if (lastSearchItems.length) showDropdown(lastSearchItems);
    })();
  }

  function highlightSearchItem(index, items) {
    const options = searchDropdown.querySelectorAll('[role="option"]');
    options.forEach((el, i) => el.classList.toggle('fund-search-item-active', i === index));
    searchHighlightIndex = index;
    if (index >= 0 && items[index]) {
      const opt = options[index];
      if (opt) opt.scrollIntoView({ block: 'nearest' });
    }
  }

  if (searchInput && searchDropdown) {
    let searchDebounceTimer;
    searchInput.addEventListener('focus', () => ensureSearchIndex());
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(async () => {
        const list = await ensureSearchIndex();
        const q = searchInput.value;
        const items = filterSearchIndex(list, q);
        showDropdown(items);
      }, SEARCH_DEBOUNCE_MS);
    });
    searchInput.addEventListener('keydown', (e) => {
      const options = searchDropdown.querySelectorAll('[role="option"]');
      const items = Array.from(options).map(el => ({ code: el.dataset.code, name: el.dataset.name }));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = searchHighlightIndex < items.length - 1 ? searchHighlightIndex + 1 : 0;
        highlightSearchItem(next, items);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = searchHighlightIndex <= 0 ? items.length - 1 : searchHighlightIndex - 1;
        highlightSearchItem(next, items);
        return;
      }
      if (e.key === 'Enter' && items.length > 0) {
        e.preventDefault();
        const idx = searchHighlightIndex >= 0 ? searchHighlightIndex : 0;
        selectSearchItem({ code: items[idx].code, name: items[idx].name });
        return;
      }
      if (e.key === 'Escape') {
        showDropdown([]);
        searchInput.blur();
      }
    });
    searchDropdown.addEventListener('mousedown', (e) => e.preventDefault());
    document.addEventListener('click', (e) => {
      if (searchDropdown.classList.contains('fund-search-dropdown-visible') && !searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
        showDropdown([]);
      }
    });
  }
  const state = loadState();
  if (state && state.funds && state.funds.length > 0) {
    restoreState(state);
  } else {
    // 无缓存状态时，根据屏幕宽度设置默认悬浮窗开关
    const showTooltipEl = document.getElementById('show-tooltip');
    if (showTooltipEl) {
      showTooltipEl.checked = window.innerWidth >= 900;
    }
  }
}

init();
