/**
 * 基金费率计算器 - 主应用
 */
import { calcFeeCurve, calcTotalFeeRate, findAllCrossovers, toAnnualizedFeeRate, getSellFeeRate } from '../../domain/fee-calculator.js';
import { fetchFundFeeFromAPI, fetchFundCodesFromAPI, fetchSearchIndexFromAPI } from '../../data/fund-api.js';
import { getColorForIndex } from '../../utils/color.js';
import { parseRate, formatRate, escapeHtml, shuffle, parseDaysInput } from '../../utils/format.js';
import { getChartTheme } from '../../core/theme.js';
import { DEMO_FUND_CODES } from '../../domain/calc-defaults.js';
import { SEARCH_DEBOUNCE_MS, filterSearchIndex } from '../../utils/search.js';
import { setupIndexPickerModal } from './index-picker-modal.js';
import { setupImportModal } from './import-modal.js';
import {
  CALC_EXTENDED_DAYS,
  syncCardColors,
  getFundDisplayName,
  ensureFeederIndex,
  applyFeederPenetration,
  getEffectiveMaxDays,
} from './funds-collector.js';
import {
  createExportSnapshot,
  saveStateToStorage,
  loadStateFromStorage,
  clearStorageState,
  consumeCompareFromCacheSession,
} from './state.js';
import { renderFundDetailTable } from '../../components/fund-detail-table.js';
import { renderStageReturnChart, resetStageReturnChartState } from '../../components/stage-return-chart.js';
import { createTypeahead } from '../../components/typeahead.js';
import { createFundCardFactory } from './fund-card.js';

// 卡片工厂：注入 updateChart / saveState / ensureSearchIndex 三个页面级闭包，避免循环 import。
// updateChart / saveState / ensureSearchIndex 都是 function declaration，受提升保护，可在此处提前引用。
const { createFundCard, addFundCard, removeCardByFundCode } = createFundCardFactory({
  updateChart: () => updateChart(),
  saveState:   () => saveState(),
  ensureSearchIndex: () => ensureSearchIndex(),
});

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

/** 全局搜索索引缓存，供顶部搜索、卡片名称联想、批量导入共用 */
let searchIndexCache = null;

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
  const segments = [];
  card.querySelectorAll('.segment-row').forEach(row => {
    const rate = parseRate(row.querySelector('.input-rate')?.value);
    if (row.dataset.unbounded === 'true') {
      segments.push({ to: null, rate });
    } else {
      const days = parseInt(row.querySelector('.input-days')?.value, 10);
      if (!isNaN(days) && days > 0) segments.push({ to: days, rate });
    }
  });
  segments.sort((a, b) => (a.to ?? Infinity) - (b.to ?? Infinity));
  const fund = { name, buyFee, _rawBuyFee, sellFeeSegments: segments, annualFee };
  if (code) fund.code = code;
  return fund;
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
  return createExportSnapshot(getStateFromDOM());
}

/** 暂存当前页面状态到 localStorage（防抖由调用方保证） */
function saveState() {
  saveStateToStorage(getStateFromDOM());
}

/**
 * 若存在数据库列表页传来的选中基金，则清空当前页与本地暂存并加载这些基金（与搜索添加一致走 API）
 * @returns {Promise<boolean>} 是否已应用并应跳过 restoreState
 */
async function applyCompareFromCacheSession() {
  const list = consumeCompareFromCacheSession();
  if (!list) return false;
  clearStoredState();
  for (const item of list) {
    const code = String(item?.code ?? '').trim();
    if (!code) continue;
    const data = await fetchFundFeeFromAPI(code);
    const payload = data || { name: item.name || `基金${code}`, code };
    addFundCard(payload);
  }
  return true;
}

/** 清除所有卡片并清除本地暂存 */
function clearStoredState() {
  clearStorageState();
  const container = document.getElementById('fund-cards');
  if (!container) return;
  container.innerHTML = '';
  const buyFeeDiscountEl = document.getElementById('buy-fee-discount');
  if (buyFeeDiscountEl) buyFeeDiscountEl.value = '0.1';
  buyFeeDiscountFactor = 0.1;
  updateChart();
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
    if (arrow) arrow.textContent = collapsed ? '‹' : '›';
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
    canvas.addEventListener('mouseleave', () => {
      overlay.classList.remove('visible');
      hideChartHoverTooltip();
    });
  }
}

/** 确保图表曲线悬停框（HTML）存在于 chart wrapper 中 */
function ensureChartHoverTooltip(wrapper) {
  if (!wrapper) return null;
  let el = wrapper.querySelector('#chart-hover-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chart-hover-tooltip';
    el.className = 'chart-hover-tooltip';
    el.setAttribute('aria-hidden', 'true');
    wrapper.appendChild(el);
  }
  return el;
}

/** 隐藏曲线悬停框 */
function hideChartHoverTooltip() {
  const el = document.getElementById('chart-hover-tooltip');
  if (!el) return;
  el.classList.remove('visible');
  el.innerHTML = '';
}

/** 渲染 Chart.js 曲线悬停框（HTML，层级高于十字线信息窗） */
function renderChartHoverTooltip(context) {
  const { chart, tooltip } = context || {};
  if (!chart || !tooltip) return;
  const wrapper = chart.canvas?.parentElement;
  const el = ensureChartHoverTooltip(wrapper);
  if (!el) return;

  if (tooltip.opacity === 0 || !tooltip.dataPoints || tooltip.dataPoints.length === 0) {
    el.classList.remove('visible');
    return;
  }

  const title = (() => {
    const ctx = tooltip.dataPoints[0];
    if (!ctx) return '';
    const c = ctx.dataset && ctx.dataset.crossover;
    if (c) return `${Math.round(c.days)}天`;
    return `持有 ${ctx.parsed.x} 天`;
  })();

  const lines = tooltip.dataPoints.map((ctx) => {
    const c = ctx.dataset && ctx.dataset.crossover;
    if (c) {
      return `${escapeHtml(c.beforeCross)}&lt;${escapeHtml(c.afterCross)}`;
    }
    const days = ctx.parsed.x;
    const feePct = ctx.parsed.y;
    const annualized = days > 0 ? (feePct / 100) * (365 / days) * 100 : 0;
    return `${escapeHtml(ctx.dataset.label || '基金')}: 累计 ${feePct.toFixed(2)}%，年化约 ${annualized.toFixed(2)}%`;
  });

  el.innerHTML = `
    <div class="chart-hover-tooltip-title">${title}</div>
    <div class="chart-hover-tooltip-body">${lines.map(line => `<div>${line}</div>`).join('')}</div>
  `;

  // 相对 chart wrapper 定位
  const x = tooltip.caretX;
  const y = tooltip.caretY;
  const wrapperWidth = wrapper.clientWidth || 0;
  const wrapperHeight = wrapper.clientHeight || 0;
  // 先粗略放置，再根据自身尺寸微调，尽量不越界
  let left = x + 12;
  let top = y - 12;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.classList.add('visible');

  const rect = el.getBoundingClientRect();
  const w = rect.width || 0;
  const h = rect.height || 0;
  if (left + w > wrapperWidth - 8) left = Math.max(8, x - w - 12);
  if (top + h > wrapperHeight - 8) top = Math.max(8, wrapperHeight - h - 8);
  if (top < 8) top = 8;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
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
    hideChartHoverTooltip();
    legendEl.innerHTML = '<p class="none">请添加基金并填写费率</p>';
    renderFundDetailTableForMainPage([]);
    resetStageReturnChartState();
    return;
  }

  syncCardColors(funds);

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
  const theme = getChartTheme();
  const gridColor = theme.grid;
  const tickColor = theme.textSecondary;
  const titleColor = theme.textPrimary;
  const chartFont = { family: "'LXGW WenKai', 'Noto Serif SC', 'Songti SC', 'PingFang SC', 'Microsoft YaHei', serif" };

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
            font: { ...chartFont, size: 14, weight: '600' },
            padding: 18,
            usePointStyle: true,
            pointStyle: 'circle',
            boxWidth: 8,
            boxHeight: 8
          }
        },
        tooltip: {
          // 改为 HTML 外置悬浮窗，保证层级高于十字线信息窗与坐标刻度窗
          enabled: false,
          external: renderChartHoverTooltip
        }
      },
      scales: {
        x: {
          title: { display: true, text: '持有天数（天）', color: titleColor, font: { ...chartFont, size: 15, weight: '600' } },
          type: 'linear',
          min: displayMin,
          max: displayMax,
          offset: false,
          grid: { color: gridColor, lineWidth: 0.5 },
          ticks: { color: tickColor, font: { ...chartFont, size: 14, weight: '500' } }
        },
        y: {
          title: { display: true, text: '累计费率（%）', color: titleColor, font: { ...chartFont, size: 15, weight: '600' } },
          beginAtZero: true,
          grid: { color: gridColor, lineWidth: 0.5 },
          ticks: {
            color: tickColor,
            font: { ...chartFont, size: 14, weight: '500' },
            callback: v => v + '%'
          }
        }
      }
    },
  });

  setupCrosshair(canvas);

  // 底部色带：与图表横轴对齐，每段直接显示对应基金名称
  const bandEl = document.getElementById('optimal-band');
  if (bandEl) {
    bandEl.innerHTML = '';
    if (optimalSwitches.length > 0) {
      bandEl.style.display = 'block';
      bandEl.style.marginLeft = '60px';
      bandEl.style.marginRight = '15px';
      const strip = document.createElement('div');
      strip.className = 'optimal-band-strip';
      displaySegments.forEach(seg => {
        const segDays = seg.end - seg.start + 1;
        const widthPct = (segDays / displayDays * 100).toFixed(2) + '%';
        const color = seg.redNoText ? 'var(--danger)' : (funds[seg.fundIndex].color || getColorForIndex(seg.fundIndex));
        const labelText = seg.redNoText ? '惩罚期' : getFundDisplayName(funds[seg.fundIndex]);
        const segDiv = document.createElement('div');
        segDiv.className = 'optimal-band-segment';
        segDiv.style.width = widthPct;
        segDiv.style.backgroundColor = color;
        // 仅宽度足够时显示文字（占比 > 4% 或绝对天数 > 20天）
        const showLabel = (segDays / displayDays) > 0.04 || segDays > 20;
        if (showLabel) {
          const label = document.createElement('span');
          label.className = 'optimal-band-segment-label';
          label.textContent = labelText;
          segDiv.appendChild(label);
        }
        strip.appendChild(segDiv);
      });
      bandEl.appendChild(strip);
      // 交叉点天数标注行，与图表横轴对齐
      const labelsRow = document.createElement('div');
      labelsRow.className = 'optimal-band-labels';
      optimalSwitches.forEach(s => {
        const leftPct = ((s.days - displayMin) / displayDays * 100).toFixed(2) + '%';
        const span = document.createElement('span');
        span.className = 'optimal-band-boundary-label';
        span.style.left = leftPct;
        span.textContent = s.days + '天';
        labelsRow.appendChild(span);
      });
      bandEl.appendChild(labelsRow);
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

  renderFundDetailTableForMainPage(funds);
}



const _fundMetaCache = {};

async function renderFundDetailTableForMainPage(funds) {
  const wrap = document.getElementById('fund-detail-table-wrap');
  const tbody = document.getElementById('fund-detail-tbody');
  if (!wrap || !tbody) return;

  // 一次性拉取 metas，复用给详情表与业绩比较图表
  const metas = await Promise.all((funds || []).map(async (f) => {
    const code = String(f?.code || '').trim();
    if (!code) return {};
    if (_fundMetaCache[code]) return _fundMetaCache[code];
    try {
      const data = await fetchFundFeeFromAPI(code);
      if (data) { _fundMetaCache[code] = data; return data; }
    } catch { /* ignore */ }
    return {};
  }));

  renderStageReturnChart(funds, metas);

  await renderFundDetailTable(tbody, funds, {
    wrapEl: wrap,
    metas,
    showDiscountedBuyFee: true,
    onDelete: (f, code) => {
      if (code) {
        removeCardByFundCode(code);
      } else {
        const cards = document.querySelectorAll('.fund-card');
        const allFunds = collectFunds();
        const idx = allFunds.indexOf(f);
        if (idx >= 0 && cards[idx]) {
          cards[idx].remove();
          updateChart();
          saveState();
        }
      }
    }
  });
}

/** 初始化 */
function init() {
  document.getElementById('add-fund').addEventListener('click', () => addFundCard());
  setupImportModal({ addFundCard, restoreState, saveState, ensureSearchIndex });
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

  function isFundAddedByCode(code) {
    const cards = document.querySelectorAll('.fund-card');
    const target = String(code || '').trim();
    if (!target) return false;
    return Array.from(cards).some(c => (c.dataset.fundCode || '').trim() === target);
  }

  async function selectSearchItem(item) {
    if (!item || !item.code) return;
    const data = await fetchFundFeeFromAPI(item.code);
    const payload = data || { name: item.name || `基金${item.code}`, code: item.code };
    addFundCard(payload);
    // 不收起下拉，刷新一次以更新「+ / ✓」状态
    fundSearchTypeahead?.rerender();
  }

  let fundSearchTypeahead = null;
  if (searchInput && searchDropdown) {
    fundSearchTypeahead = createTypeahead({
      inputEl: searchInput,
      dropdownEl: searchDropdown,
      debounceMs: SEARCH_DEBOUNCE_MS,
      closeOnSelect: false,
      clearOnSelect: false,
      search: async (q) => {
        const list = await ensureSearchIndex();
        return filterSearchIndex(list, q);
      },
      renderItem: (item, { rerender }) => {
        const wrap = document.createElement('div');
        wrap.className = 'fund-search-item-content';
        const added = isFundAddedByCode(item.code);
        wrap.innerHTML = `
          <span class="fund-search-code">${item.code}</span>
          <span class="fund-search-name">${item.name}</span>
          <button type="button" class="fund-search-add-btn ${added ? 'added' : ''}" data-typeahead-skip data-code="${item.code}" title="${added ? '已添加，点击移除' : '添加到卡片'}">
            ${added ? '✓' : '+'}
          </button>
        `;
        const btn = wrap.querySelector('.fund-search-add-btn');
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (added) {
            removeCardByFundCode(item.code);
            rerender();
          } else {
            selectSearchItem(item);
          }
        });
        return wrap;
      },
      onSelect: (item) => { selectSearchItem(item); },
    });
  }
  (async () => {
    const appliedCompare = await applyCompareFromCacheSession();
    if (appliedCompare) return;
    const state = loadStateFromStorage();
    if (state && state.funds && state.funds.length > 0) {
      restoreState(state);
    } else {
      // 无缓存状态时，根据屏幕宽度设置默认悬浮窗开关
      const showTooltipEl = document.getElementById('show-tooltip');
      if (showTooltipEl) {
        showTooltipEl.checked = window.innerWidth >= 900;
      }
    }
  })();
}

export function pageInit() {
  init();
  window.addEventListener('fundcal-theme-change', () => { updateChart(); });
}
