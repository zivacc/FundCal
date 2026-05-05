/**
 * 净值比较页 (NAV Compare)
 *
 * 依赖：
 * - window.echarts (CDN 全局)
 * - data/nav-api.js  ：NAV 数据接口（取数、周期换算）
 * - domain/nav-align.js     ：多基金日期并集对齐 + 前向填充
 * - domain/nav-statistics.js：MA / 回撤 / Y 轴模式变换
 * - data/fund-api.js ：复用搜索索引接口
 */

import { createTypeahead } from '../../components/typeahead.js';
import { fetchNavCompareCached, periodToRange } from '../../data/nav-api.js';
import { fetchSearchIndexFromAPI } from '../../data/fund-api.js';
import { loadTradeCalendar, isTradingDay } from '../../data/trade-calendar.js';
import { alignSeriesToDates } from '../../domain/nav-align.js';
import {
  transformByMode,
  computeYAxisBounds,
  pickLogBase,
} from '../../domain/nav-statistics.js';
import { computeRangeStats } from '../../domain/nav-range-stats.js';
import {
  INDICATORS_LIST,
  getEnabledIndicators,
  getActiveSubplots,
  getSubplotIndexMap,
  getIndicatorAxisIndex,
  getEnabledRangeStatsIndicators,
} from './indicators.js';

const COLORS = ['#c47a3d', '#2a8e6c', '#3f6cc4', '#b8732d', '#c0412d', '#7e6cc4', '#5d8aa8', '#9b6b3f'];

const state = {
  selected: [],   // [{code, name, color}]
  period: 'COMMON', // 仅用于 period 按钮的高亮；不再驱动 fetch
  viewStart: null, // YYYY-MM-DD; null = data start
  viewEnd: null,   // YYYY-MM-DD; null = data end
  valueMode: 'pct',  // 'nav' | 'pct'  —— "用什么数 plot"
  axisScale: 'linear', // 'linear' | 'log' —— "怎么 plot"，与 valueMode 正交
  baseline: null, // YYYY-MM-DD; null = 自动跟随视图起点
  // 指标启用标志 —— 由 indicators.js 注册表驱动，这里只是存储位。
  // 新增指标要做的：在 indicators.js 里声明 persist.key，然后在这里加同名字段。
  // （字段名与注册表 persist.key 严格一致 — persist / restore / UI 全部走注册表循环。）
  showMA20: false,
  showMA60: false,
  showDD: true,
  // 通过点击自定义 legend 被隐藏的基金 code 集合；不影响 state.selected（chip 还在）
  hiddenCodes: new Set(),
  data: null,     // last compare response (始终是 MAX 数据)
  chart: null,
  searchIndex: null,
  // 防止 datazoom 反向同步导致的事件回环
  _suppressZoomSync: false,
  // dataZoom 当前窗口快照：mousemove 热路径只读这里，避开 chart.getOption() 的深克隆
  _currentDataZoom: { startPct: 0, endPct: 100 },
  // renderChart 期间预算的对齐 + MA 数据：区间统计 panel 拖动时直接复用，避免重算
  _renderCache: null,
};

/* ========== 持久化（localStorage）========== */

const STORAGE_KEY = 'nav-compare-state';
const STORAGE_VERSION = 1;
let _persistTimer = null;

/**
 * 把可重建的 UI/视图状态写入 localStorage（debounce 100ms 避免高频抖动）。
 * 不持久化 data / chart / searchIndex / 临时 flag —— 数据每次 fetch 重拉，
 * 颜色由 selected index 派生。
 */
function persist() {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    try {
      const payload = {
        v: STORAGE_VERSION,
        selected: state.selected.map(f => ({ code: f.code, name: f.name })),
        period: state.period,
        viewStart: state.viewStart,
        viewEnd: state.viewEnd,
        valueMode: state.valueMode,
        axisScale: state.axisScale,
        baseline: state.baseline,
        hiddenCodes: [...state.hiddenCodes],
      };
      // 指标字段按注册表全量写入，加指标不用改这里
      for (const ind of INDICATORS_LIST) {
        payload[ind.persist.key] = state[ind.persist.key];
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (_) { /* 配额满 / 隐身模式禁用，忽略 */ }
  }, 100);
}

/**
 * 从 localStorage 恢复 state。pageInit 里一次性调用，调用完再 setupEvents。
 */
function loadPersistedState() {
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (_) { return; }
  if (!raw) return;
  let saved;
  try { saved = JSON.parse(raw); } catch (_) { return; }
  if (!saved || saved.v !== STORAGE_VERSION) return;

  if (Array.isArray(saved.selected)) {
    state.selected = saved.selected
      .filter(f => f && typeof f.code === 'string')
      .map((f, i) => ({ code: f.code, name: f.name || f.code, color: COLORS[i % COLORS.length] }));
  }
  if (typeof saved.period === 'string' || saved.period === null) state.period = saved.period;
  if (typeof saved.viewStart === 'string' || saved.viewStart === null) state.viewStart = saved.viewStart;
  if (typeof saved.viewEnd === 'string' || saved.viewEnd === null) state.viewEnd = saved.viewEnd;
  if (saved.valueMode === 'pct' || saved.valueMode === 'nav') state.valueMode = saved.valueMode;
  if (saved.axisScale === 'linear' || saved.axisScale === 'log') state.axisScale = saved.axisScale;
  if (typeof saved.baseline === 'string' || saved.baseline === null) state.baseline = saved.baseline;
  // 指标字段按注册表还原（不认识的 key 自动忽略）
  for (const ind of INDICATORS_LIST) {
    const k = ind.persist.key;
    if (typeof saved[k] === 'boolean') state[k] = saved[k];
  }
  if (Array.isArray(saved.hiddenCodes)) {
    state.hiddenCodes = new Set(saved.hiddenCodes.filter(c => typeof c === 'string'));
  }
}

/**
 * 把 state 同步到 UI 控件的 active class / checked / value。
 * setupEvents 之后、fetchAndRender 之前调用，让按钮状态先就位。
 */
function applyStateToUI() {
  document.querySelectorAll('.nav-period-btn').forEach(b => {
    b.classList.toggle('nav-period-btn-active', b.dataset.period === state.period);
  });
  document.querySelectorAll('#nav-value-mode .nav-toggle-btn').forEach(b => {
    b.classList.toggle('nav-toggle-btn-active', b.dataset.value === state.valueMode);
  });
  document.querySelectorAll('#nav-axis-scale .nav-toggle-btn').forEach(b => {
    b.classList.toggle('nav-toggle-btn-active', b.dataset.value === state.axisScale);
  });
  // 指标 checkbox 按注册表同步（回 checked 状态）
  for (const ind of INDICATORS_LIST) {
    const el = document.getElementById(ind.ui.checkboxId);
    if (el) el.checked = !!state[ind.persist.key];
  }
  syncRangeInputs();
}

/* ========== 日期工具 ========== */

function ymdToISO(s) {
  if (!s || s.length < 8) return '';
  return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
}

function isoToYMD(iso) {
  return String(iso || '').replace(/-/g, '');
}

/**
 * 由 period 预设算出视图窗口（基于已有数据的最后一天往前推）。
 * @param {string} period         '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y' | '10Y' | 'MAX' | 'COMMON'
 * @param {string[]} allDatesYMD  紧凑 YYYYMMDD（升序）
 * @param {Array} [series]        COMMON 下用，以取各基金齐步走起点
 * @returns {{start: string|null, end: string|null}}  ISO YYYY-MM-DD
 */
function viewWindowFromPeriod(period, allDatesYMD, series) {
  if (!allDatesYMD || !allDatesYMD.length) return { start: null, end: null };
  const lastYMD = allDatesYMD[allDatesYMD.length - 1];
  const endISO = ymdToISO(lastYMD);
  // 同区间：多基金取各基金首日的 max；单基金降级等同 MAX
  if (period === 'COMMON') {
    const cs = commonStartISO(series);
    return { start: cs || ymdToISO(allDatesYMD[0]), end: endISO };
  }
  if (period === 'MAX') return { start: ymdToISO(allDatesYMD[0]), end: endISO };
  const days = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365, '3Y': 365 * 3, '5Y': 365 * 5, '10Y': 365 * 10 }[period] || 365;
  // 数据最后一天 - days，找数据中第一个 >= 该日期的点
  const lastDate = new Date(parseInt(lastYMD.slice(0,4)), parseInt(lastYMD.slice(4,6)) - 1, parseInt(lastYMD.slice(6,8)));
  const target = new Date(lastDate.getTime() - days * 86400000);
  const targetYMD = `${target.getFullYear()}${String(target.getMonth()+1).padStart(2,'0')}${String(target.getDate()).padStart(2,'0')}`;
  const found = allDatesYMD.findIndex(d => d >= targetYMD);
  const startIdx = found === -1 ? 0 : found;
  return { start: ymdToISO(allDatesYMD[startIdx]), end: endISO };
}

/**
 * 把 viewStart/viewEnd（ISO）映射为 dataZoom 的 start/end 百分比 [0,100]。
 * @param {string[]} allDatesYMD  数据日期（紧凑 YYYYMMDD）
 * @param {string|null} sISO
 * @param {string|null} eISO
 * @returns {{start: number, end: number}}
 */
function viewToZoomPct(allDatesYMD, sISO, eISO) {
  const len = allDatesYMD?.length || 0;
  if (len < 2) return { start: 0, end: 100 };
  const sYMD = isoToYMD(sISO);
  const eYMD = isoToYMD(eISO);
  let sIdx = 0;
  let eIdx = len - 1;
  if (sYMD) {
    const f = allDatesYMD.findIndex(d => d >= sYMD);
    sIdx = f === -1 ? 0 : f;
  }
  if (eYMD) {
    // 找 <= eYMD 的最后一个 idx；二分代价不大，线性即可
    let last = sIdx;
    for (let i = len - 1; i >= 0; i--) {
      if (allDatesYMD[i] <= eYMD) { last = i; break; }
    }
    eIdx = Math.max(sIdx, last);
  }
  const startPct = (sIdx / (len - 1)) * 100;
  const endPct = (eIdx / (len - 1)) * 100;
  return { start: startPct, end: endPct };
}

/**
 * dataZoom 反向：百分比 → ISO 日期对。
 * @param {string[]} allDatesYMD
 * @param {number} startPct  0..100
 * @param {number} endPct    0..100
 * @returns {{start: string, end: string}}
 */
function zoomPctToView(allDatesYMD, startPct, endPct) {
  const len = allDatesYMD?.length || 0;
  if (!len) return { start: null, end: null };
  const sIdx = Math.max(0, Math.min(len - 1, Math.round(startPct / 100 * (len - 1))));
  const eIdx = Math.max(0, Math.min(len - 1, Math.round(endPct / 100 * (len - 1))));
  return { start: ymdToISO(allDatesYMD[sIdx]), end: ymdToISO(allDatesYMD[eIdx]) };
}

async function loadSearchIndex() {
  if (state.searchIndex) return state.searchIndex;
  const list = await fetchSearchIndexFromAPI();
  state.searchIndex = Array.isArray(list) ? list : [];
  return state.searchIndex;
}

function filterIndex(list, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return [];
  const num = s.replace(/\D/g, '');
  const score = (r) => {
    const code = (r.code || '').toLowerCase();
    const nm = (r.name || '').toLowerCase();
    const init = (r.initials || '').toLowerCase();
    if (num && code.startsWith(num)) return 0;
    if (num && code.includes(num)) return 1;
    if (nm.startsWith(s)) return 2;
    if (init.startsWith(s)) return 3;
    if (nm.includes(s)) return 4;
    return 99;
  };
  return list
    .map(r => ({ r, s: score(r) }))
    .filter(x => x.s < 99 && !x.r.needsCrawl)
    .sort((a, b) => a.s - b.s)
    .slice(0, 12)
    .map(x => x.r);
}

/* ========== UI ========== */

/**
 * 在 #nav-chart-header 内重建自定义 legend（取代 ECharts 自带 legend 和上方 chips 区）。
 * 每个 item：dot + code + name + NAV + chg% + × 删除按钮，全走 CSS 变量 → 暗色自动适配。
 * 点 item 主体 → 切换显示/隐藏；点 × → 移除该基金。两种交互在 onLegendToggleClick 里分流。
 * 本函数只负责"结构"；NAV/chg 文字由 updateChartLegend 填。
 */
function renderChartLegend() {
  // 静态 HTML 里已经预建 #nav-chart-legend（nav-chart-header 内）；
  // 这段 fallback 只为向后兼容——若元素缺失，挂到 header 或 wrap 上。
  let el = document.getElementById('nav-chart-legend');
  if (!el) {
    const host = document.getElementById('nav-chart-header')
                 || document.getElementById('nav-chart-wrap');
    if (!host) return;
    el = document.createElement('div');
    el.id = 'nav-chart-legend';
    el.className = 'nav-chart-legend';
    host.appendChild(el);
  }
  if (!state.selected.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = state.selected.map((f, i) => {
    const hidden = state.hiddenCodes.has(f.code);
    return `
      <span class="nav-chart-legend-item${hidden ? ' is-hidden' : ''}"
            data-code="${f.code}"
            data-idx="${i}"
            role="button"
            tabindex="0"
            title="点击切换显示/隐藏">
        <span class="nav-chart-legend-dot" style="background:${f.color}"></span>
        <span class="nav-chart-legend-code">${f.code}</span>
        <span class="nav-chart-legend-name">${escapeHtml(f.name)}</span>
        <span class="nav-chart-legend-nav"></span>
        <span class="nav-chart-legend-chg"></span>
        <button type="button" class="nav-chart-legend-remove" data-action="remove" data-idx="${i}" aria-label="移除该基金" title="移除">×</button>
      </span>
    `;
  }).join('');
  // 事件委托只挂一次（renderChartLegend 可能被多次调，用 dataset flag 防止重复绑定）
  if (!el.dataset.toggleBound) {
    el.addEventListener('click', onLegendToggleClick);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLegendToggleClick(e); }
    });
    el.dataset.toggleBound = '1';
  }
  updateChartLegend(null);
}

/**
 * 自定义 legend 点击：切换对应基金的显示/隐藏。
 * 教 renderChart 知道这个 code 要 skip。保持 state.selected 不变—— chip 及范围统计依然计在内（
 * 只是从图上消失）。与原版 ECharts legend 行为一致。
 */
function onLegendToggleClick(e) {
  const target = e.target instanceof HTMLElement ? e.target : null;
  if (!target) return;

  // × 删除按钮：优先级高于 item 切换，命中即走 removeFund
  const removeBtn = target.closest('.nav-chart-legend-remove');
  if (removeBtn) {
    e.stopPropagation();
    const idx = parseInt(removeBtn.dataset.idx, 10);
    if (!Number.isNaN(idx)) removeFund(idx);
    return;
  }

  // 普通 item 点击：切换显示/隐藏
  const item = target.closest('.nav-chart-legend-item');
  if (!item) return;
  const code = item.dataset.code;
  if (!code) return;
  if (state.hiddenCodes.has(code)) state.hiddenCodes.delete(code);
  else state.hiddenCodes.add(code);
  renderChartLegend();
  renderChart();
}

/**
 * 增量刷新自定义 legend 行尾部的"当日净值"文字位。
 * - hoverIdx 为有效索引 → 显示该日净值（前向填充对齐后取 cache）
 * - hoverIdx == null   → 回落到"最新非空净值"（视图末点）
 * - 缓存或 legend 未建时静默 no-op
 *
 * 不重建 DOM；只改 .nav-chart-legend-nav 的 textContent。hover mousemove 高频调用也廉价。
 */
function updateChartLegend(hoverIdx) {
  const el = document.getElementById('nav-chart-legend');
  if (!el) return;
  const cache = state._renderCache;
  const alignedByCode = cache?.alignedByCode;
  if (!alignedByCode) return;

  const items = el.querySelectorAll('.nav-chart-legend-item');
  for (const item of items) {
    const code = item.dataset.code;
    if (!code) continue;
    const arr = alignedByCode.get(code);
    const navEl = item.querySelector('.nav-chart-legend-nav');
    const chgEl = item.querySelector('.nav-chart-legend-chg');
    if (!navEl) continue;
    // 当前点的净值 v 及其索引 idxUsed（后续取 arr[idxUsed-1] 算涨跌）
    let v = null;
    let idxUsed = -1;
    if (arr && arr.length) {
      if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < arr.length) {
        v = arr[hoverIdx];
        idxUsed = hoverIdx;
      } else {
        for (let k = arr.length - 1; k >= 0; k--) {
          if (arr[k] != null && Number.isFinite(arr[k])) { v = arr[k]; idxUsed = k; break; }
        }
      }
    }
    navEl.textContent = (v != null && Number.isFinite(v)) ? v.toFixed(2) : '';

    // 当日涨跌幅：与前一交易日比。all-dates 轴是各基金交易日的并集，
    // aligned 数组已前向填充：该基金未交易日上 arr[idx]==arr[idx-1] → pct=0（符合预期）。
    if (chgEl) {
      let pct = null;
      if (arr && Number.isFinite(v) && idxUsed > 0) {
        const prev = arr[idxUsed - 1];
        if (Number.isFinite(prev) && prev !== 0) {
          pct = (v - prev) / prev * 100;
        }
      }
      if (pct == null || !Number.isFinite(pct)) {
        chgEl.textContent = '';
        chgEl.classList.remove('is-pos', 'is-neg');
      } else {
        const sign = pct > 0 ? '+' : '';
        chgEl.textContent = `${sign}${pct.toFixed(2)}%`;
        chgEl.classList.toggle('is-pos', pct > 0);
        chgEl.classList.toggle('is-neg', pct < 0);
      }
    }
  }
}

function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = String(t || '');
  return d.innerHTML;
}

function setStatusEmpty(show) {
  const empty = document.getElementById('nav-chart-empty');
  if (empty) empty.style.display = show ? '' : 'none';
}

async function addFund(f) {
  if (state.selected.find(x => x.code === f.code)) return;
  if (state.selected.length >= 10) {
    alert('一次最多对比 10 只基金');
    return;
  }
  const color = COLORS[state.selected.length % COLORS.length];
  state.selected.push({ code: f.code, name: f.name, color });
  renderChartLegend();
  persist();
  await fetchAndRender();
}

function removeFund(idx) {
  const removed = state.selected[idx];
  state.selected.splice(idx, 1);
  // 重新分配颜色
  state.selected.forEach((f, i) => f.color = COLORS[i % COLORS.length]);
  // 同步清理 hiddenCodes 里的孤儿 —— 防止再次添加同一基金时继承上次"被隐藏"态
  if (removed && removed.code) state.hiddenCodes.delete(removed.code);
  renderChartLegend();
  persist();
  fetchAndRender();
}

/* ========== Data fetch ========== */

async function fetchAndRender() {
  if (!state.selected.length) {
    setStatusEmpty(true);
    if (state.chart) state.chart.clear();
    renderStatsTable([]);
    return;
  }
  setStatusEmpty(false);
  const codes = state.selected.map(f => f.code);
  // 始终拉 MAX 范围、daily 粒度。缩放/区间的责任全部下放给前端 dataZoom。
  // P1.B IDB 缓存 + P1.C ETag 让重复访问几乎零成本。
  const { start, end } = periodToRange('MAX');
  try {
    // 并行：数据拉取 + 交易日历（后者命中内存缓存时几乎是 noop）
    const [data] = await Promise.all([
      fetchNavCompareCached({ codes, start, end, interval: 'daily' }),
      loadTradeCalendar(),
    ]);
    if (!data) { alert('当前无后端 API'); return; }
    state.data = data;

    // 数据到达后：若视图未指定（首次加载），按当前 period 推一个；
    // 已存在的 viewStart/End 保留（用户已选过区间或拖过 zoom）。
    if (!state.viewStart && !state.viewEnd) {
      const allDatesYMD = collectAllDatesYMD(data);
      const { start: vs, end: ve } = viewWindowFromPeriod(state.period || 'COMMON', allDatesYMD, data.series);
      state.viewStart = vs;
      state.viewEnd = ve;
      syncRangeInputs();
    }

    renderChart();
    renderStatsTable(state.data.stats || []);
  } catch (e) {
    console.error('compare 请求失败', e);
    alert('数据请求失败：' + e.message);
  }
}

/**
 * 多基金 series 的日期并集（紧凑 YYYYMMDD，升序），并按 SSE 交易日历过滤。
 * A 股 ~250 交易日/年；源数据并集可能含周末/节假日（数据源偶发错误或基金
 * 在非交易日特殊报净值）。日历未加载时 isTradingDay 保守返回 true，不过滤。
 */
function collectAllDatesYMD(data) {
  const set = new Set();
  for (const s of data?.series || []) {
    for (const d of s.dates || []) if (isTradingDay(d)) set.add(d);
  }
  return [...set].sort();
}

/**
 * 多基金"齐步走"起点：所有基金都已经有数据的最早日期 = 各基金首个日期的 max。
 * 单基金或空返回 null（让调用方走 viewStart 兜底）。
 */
function commonStartISO(series) {
  if (!series || series.length < 2) return null;
  let maxFirst = '';
  for (const s of series) {
    const first = s?.dates?.[0];
    if (!first) continue;
    if (first > maxFirst) maxFirst = first;
  }
  return maxFirst ? ymdToISO(maxFirst) : null;
}

/**
 * 把 state.viewStart/End（ISO）写回页面上的 nav-view-start / nav-view-end 输入框。
 * 用 _suppressZoomSync 防止 input change 与 datazoom 事件互相回弹。
 */
function syncRangeInputs() {
  const sEl = document.getElementById('nav-view-start');
  const eEl = document.getElementById('nav-view-end');
  if (sEl) sEl.value = state.viewStart || '';
  if (eEl) eEl.value = state.viewEnd || '';
}

/* ========== Chart ========== */

function ensureChart() {
  if (state.chart) return state.chart;
  const canvas = document.getElementById('nav-chart-canvas');
  if (!canvas || !window.echarts) return null;
  state.chart = window.echarts.init(canvas, null, { renderer: 'canvas' });
  // 容器尺寸变化：先 resize 再重渲染（baseline panel 走绝对像素）
  window.addEventListener('resize', () => {
    if (!state.chart) return;
    state.chart.resize();
    if (state.data) renderChart();
  });
  ensureBaselinePanel();
  setupRangeSelection();
  // 注：dataZoom 事件不在这里挂；那是 renderChart 内的 'datazoom' 处理器的活，
  // 在那里同时更新 _currentDataZoom 快照并同步持久区间，避免和 chart.off('datazoom') 起冲突。

  // 鼠标离开图表区 → legend 回落到"最新净值"。悬停时的当日值由 tooltip.formatter
  // 作为 side-channel 直接调用 updateChartLegend（透明 tooltip 在视觉上不可见）。
  // ensureChart 只跑一次，所以监听器无需 off/on。
  try { state.chart.getZr().on('globalout', () => updateChartLegend(null)); } catch (_) {}
  return state.chart;
}

function readThemeColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (n, fb) => css.getPropertyValue(n).trim() || fb;
  return {
    text:      v('--text-primary',   '#1a1918'),
    text2:     v('--text-secondary', '#54514b'),
    text3:     v('--text-tertiary',  '#8a867d'),
    rule:      v('--rule',           '#ebe8e1'),
    ruleStrong:v('--rule-strong',    '#d9d5cc'),
    bgRaised:  v('--bg-raised',      '#ffffff'),
    bgSubtle:  v('--bg-subtle',      '#f5f3ec'),
    accent:    v('--accent',         '#c47a3d'),
    accentSub: v('--accent-subtle',  'rgba(196,122,61,0.08)'),
  };
}

/* ---------- 数值/坐标格式化 ---------- */

function pctFormatter(ratio) {
  // r=1.0 → 0%；r=1.234 → 23.4%；保留 1 位小数避免视觉抖动
  return `${((ratio - 1) * 100).toFixed(1)}%`;
}

function navFormatter(v) {
  // 净值常落在 0.5–10 区间，4 位有效位足够；尾零会被 .replace 修剪
  return Number(v).toFixed(4).replace(/\.?0+$/, '');
}

function yAxisLabelFormatter(valueMode) {
  return valueMode === 'pct' ? pctFormatter : navFormatter;
}

function yAxisName(valueMode, axisScale) {
  const base = valueMode === 'pct' ? '累计收益' : '净值';
  // 用 '·' 作为对数标注前缀：toVerticalName 按字符拆分时会单独占一行，
  // 比 '(对数)' 更利于竖排（原先括号段被整体保留会导致横排混入竖排）。
  return axisScale === 'log' ? `${base}·对数` : base;
}

/**
 * 把字符串按字符堆叠成竖排显示（ECharts name 支持 \n 换行）。
 * 先去掉所有空白避免产生空行，然后逐字符拆。
 */
function toVerticalName(str) {
  return String(str || '').replace(/\s+/g, '').split('').join('\n');
}

function renderChart() {
  const chart = ensureChart();
  if (!chart || !state.data) return;
  const { series } = state.data;
  if (!series || !series.length) { chart.clear(); return; }

  const theme = readThemeColors();
  const valueMode = state.valueMode;
  const axisScale = state.axisScale;

  // 指标注册表驱动：当前启用的指标 + 由此衍生的副图集合
  const enabledIndicators = getEnabledIndicators(state);
  const activeSubplots = getActiveSubplots(state);
  const subplotIdxMap = getSubplotIndexMap(activeSubplots);
  const hasSubplot = activeSubplots.length > 0;

  // 公共日期轴 = union of trading days across series（collectAllDatesYMD 内已
  // 按交易日历过滤），然后把每只基金的净值前向填充对齐到这条轴上。
  const allDates = collectAllDatesYMD(state.data);
  const allDatesYMD = allDates.slice();
  const alignedByCode = new Map();
  for (const s of series) {
    if (!s || !s.code) continue;
    alignedByCode.set(s.code, alignSeriesToDates(allDates, s));
  }
  const mainSeries = [];
  const subplotSeries = [];
  const transformedAll = []; // 用于推算 yAxis bounds

  // 基准日决策：
  //   1) 用户手动拖过 (state.baseline 非空)
  //      a) 仍在当前显示区间 → 用 state.baseline（不刷新）
  //      b) 已被划出区间   → 弃用，走自动兜底
  //   2) 从未拖过        → 自动兜底
  // 自动兜底：
  //   - 单基金：viewStart
  //   - 多基金：max(viewStart, commonStart) ——
  //     即所有基金都有数据的最早日，且不早于当前视图起点（保证 marker 在视图内）
  let effectiveBaseline = state.baseline || null;
  if (effectiveBaseline) {
    const inView = (!state.viewStart || effectiveBaseline >= state.viewStart)
                && (!state.viewEnd   || effectiveBaseline <= state.viewEnd);
    if (!inView) effectiveBaseline = null;
  }
  if (!effectiveBaseline) {
    const cs = commonStartISO(series);
    if (cs && state.viewStart) effectiveBaseline = cs > state.viewStart ? cs : state.viewStart;
    else effectiveBaseline = cs || state.viewStart || null;
  }

  // 视图窗口对应的 [sIdx..eIdx]，用于把 markPoint 的极值搜索限定在可见范围内。
  // 关键：state.viewStart/End 是 ISO；这里转回紧凑 YYYYMMDD 与 allDates 比较。
  const winStartYMD = isoToYMD(state.viewStart);
  const winEndYMD = isoToYMD(state.viewEnd);
  const sIdx = winStartYMD ? Math.max(0, allDates.findIndex(d => d >= winStartYMD)) : 0;
  let eIdx = allDates.length - 1;
  if (winEndYMD) {
    for (let k = allDates.length - 1; k >= 0; k--) {
      if (allDates[k] <= winEndYMD) { eIdx = k; break; }
    }
  }

  // 极值点搜索起点：基准日索引 vs 视图起点，取较大的。
  // 仅 pct 模式下基准有"归一起点"语义；nav 模式下基准无意义，不用它约束极值。
  const baselineYMD = valueMode === 'pct' ? isoToYMD(effectiveBaseline || '') : '';
  let extremaStartIdx = sIdx;
  if (baselineYMD) {
    const found = allDates.findIndex(d => d >= baselineYMD);
    if (found !== -1) extremaStartIdx = Math.max(sIdx, found);
  }

  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    // legend 点击隐藏的基金：不出线、不计极值、不参与 yAxis bound
    if (state.hiddenCodes.has(s.code)) continue;
    const sel = state.selected.find(f => f.code === s.code);
    const color = sel?.color || COLORS[i % COLORS.length];
    const aligned = alignedByCode.get(s.code) || new Array(allDates.length).fill(null);
    const transformed = transformByMode(allDates, aligned, valueMode, effectiveBaseline);
    transformedAll.push(transformed);

    // 当前视图窗口内的 max/min 显式索引；避开 ECharts type:'max' 在
    // 前向填充平台上落点不准、且不受窗口约束的两个老坑。
    let maxI = -1, minI = -1;
    let maxV = -Infinity, minV = Infinity;
    for (let k = extremaStartIdx; k <= eIdx; k++) {
      const v = transformed[k];
      if (v == null || !Number.isFinite(v)) continue;
      if (v > maxV) { maxV = v; maxI = k; }
      if (v < minV) { minV = v; minI = k; }
    }
    // 显式 value，避免 ECharts 解析成 undefined 导致 formatter 算 NaN。
    // 每个点自带 label.position：最高在曲线上方，最低在曲线下方。
    const markPointData = [];
    if (maxI >= 0) {
      markPointData.push({
        name: '最高', coord: [maxI, maxV], value: maxV,
        label: { position: 'top' },
      });
    }
    if (minI >= 0 && minI !== maxI) {
      markPointData.push({
        name: '最低', coord: [minI, minV], value: minV,
        label: { position: 'bottom' },
      });
    }

    // 主线：附 max/min 标记点（仅当前视图窗口内的极值，仅显示数值）
    mainSeries.push({
      name: `${s.code} ${s.name}`,
      type: 'line',
      data: transformed,
      showSymbol: false,
      lineStyle: { width: 1.5, color },
      itemStyle: { color },
      smooth: false,
      sampling: 'lttb',
      xAxisIndex: 0,
      yAxisIndex: 0,
      connectNulls: true,
      markPoint: markPointData.length ? {
        // 用 1px 完全透明的 circle 取代 symbol:'none' —— ECharts 5.5.x 在 'none'
        // 时会连带把 label 一起隐藏，circle+opacity:0 才能稳定保留文字标签
        symbol: 'circle',
        symbolSize: 1,
        silent: true,
        itemStyle: { color: 'rgba(0,0,0,0)', borderColor: 'rgba(0,0,0,0)' },
        label: {
          show: true,
          color, fontSize: 13, fontWeight: 600,
          formatter: (p) => {
            const v = Array.isArray(p.value) ? p.value[1] : p.value;
            return yAxisLabelFormatter(valueMode)(v);
          },
        },
        data: markPointData,
      } : undefined,
    });
    // 指标注册表驱动：每个启用指标根据其 panel（main / 副图）到主图或副图列。
    // 指标自己管理计算方式、样式、极值 markPoint 等—— renderChart 完全不知道“MA”或“回撤”存在。
    // 新增指标 = indicators.js 里添一行，不用改这里。
    for (const ind of enabledIndicators) {
      const axisIdx = getIndicatorAxisIndex(ind, subplotIdxMap);
      const entries = ind.build({
        code: s.code,
        name: s.name,
        color,
        aligned,
        transformed,
        winEIdx: eIdx,
        extremaStartIdx,
        xAxisIndex: axisIdx,
        yAxisIndex: axisIdx,
      });
      const target = ind.panel === 'main' ? mainSeries : subplotSeries;
      for (const entry of entries) target.push(entry);
    }
  }

  // 主图 Y 轴边界：仅按 *可视窗口内* 的值算 → 任何缩放级别都"撑满"
  // 之前用 transformedAll 全集，导致 1Y/3Y 视图下曲线挤在 y 轴中间一小段。
  const transformedInView = transformedAll.map(arr => arr.slice(sIdx, eIdx + 1));
  const { min: yMin, max: yMax } = computeYAxisBounds(transformedInView, axisScale);

  // 布局：无副图时主图占满；有副图时主图压缩到 56%，副图由自己的 grid 声明接下来。
  // 多副图不调主图高度（进一步的分配算法留到实际需要第二个副图时再做，YAGNI）。
  const grids = hasSubplot
    ? [
        { left: 72, right: 30, top: 50, height: '56%' },
        ...activeSubplots.map(sp => ({ ...sp.grid })),
      ]
    : [{ left: 72, right: 30, top: 50, bottom: 72 }];

  // 主图 X 轴在 DD 副图打开时不显示日期，避免与下方 "回撤" 轴名碰撞
  // axisLabel 只展示 YYYY-MM；tooltip 仍用完整 YYYY-MM-DD（数据未改）。
  const xAxisCommon = (gridIndex, showLabel) => ({
    type: 'category',
    data: allDates.map(formatDate),
    gridIndex,
    axisLabel: {
      color: theme.text2, fontSize: 13, show: showLabel,
      formatter: (val) => String(val).slice(2, 7),
    },
    axisLine: { lineStyle: { color: theme.rule } },
    axisTick: { lineStyle: { color: theme.rule }, show: showLabel },
    splitLine: { show: false },
  });
  // 主图 X 轴在任何副图打开时不显示日期（避免和副图上方的轴名碰撞）；副图都显示。
  const xAxes = hasSubplot
    ? [xAxisCommon(0, false), ...activeSubplots.map((_, i) => xAxisCommon(i + 1, true))]
    : [xAxisCommon(0, true)];

  const yMain = {
    type: axisScale === 'log' ? 'log' : 'value',
    name: toVerticalName(yAxisName(valueMode, axisScale)),
    nameTextStyle: { color: theme.text2, fontSize: 13, lineHeight: 14 },
    nameLocation: 'middle',
    nameGap: 54,
    nameRotate: 0,
    gridIndex: 0,
    axisLabel: { color: theme.text2, fontSize: 13, formatter: yAxisLabelFormatter(valueMode) },
    axisLine: { lineStyle: { color: theme.rule } },
    splitLine: { lineStyle: { color: theme.rule, opacity: 0.5 } },
    scale: axisScale !== 'log',
    min: yMin, max: yMax,
    // 对数轴密度自适应：默认 logBase=10 在金融净值范围（0.5..3）只有 1 个 split；
    // pickLogBase 按 ratio 选 base 让 tick 数 ≈ 6，与线性观感一致。
    ...(axisScale === 'log' ? { logBase: pickLogBase(transformedInView) } : {}),
  };
  // 副图 yAxis 由 SUBPLOTS 条目的 buildYAxis 生成；名称样式在这里统一套（用 toVerticalName 竖排）
  const subplotYAxes = activeSubplots.map((sp, i) => ({
    name: sp.yAxisName ? toVerticalName(sp.yAxisName) : undefined,
    nameTextStyle: { color: theme.text2, fontSize: 13, lineHeight: 14 },
    nameLocation: 'middle',
    nameGap: 54,
    nameRotate: 0,
    ...sp.buildYAxis(theme, i + 1),
  }));
  const yAxes = hasSubplot ? [yMain, ...subplotYAxes] : [yMain];

  const option = {
    backgroundColor: 'transparent',
    animation: false,
    // ECharts 自带 legend 关掉 —— 在暗色模式下它的白圆点 icon 与主题不协调，也难细化样式。
    // 由 renderChartLegend 在 #nav-chart-wrap 内贴同一位置绘制纯 DOM legend，全走 CSS 变量。
    legend: { show: false },
    // tooltip 弹框设为完全透明（不可见但仍跑 formatter）→ 把 hover 的 dataIndex
    // 旁路给 updateChartLegend，让自定义 legend 显示当日净值。
    // 注：axisPointer.type='cross' 必须挂在 tooltip 下；放 top-level 会触发 ECharts
    // 的 makeElOption 报 "wN[s] is not a function"（cross 不是顶层 axisPointer 的合法 type）。
    tooltip: {
      trigger: 'axis',
      show: true,
      axisPointer: {
        type: 'cross',
        label: { backgroundColor: theme.text, color: theme.bgRaised },
        crossStyle: { color: theme.text2 },
        lineStyle: { color: theme.text2, opacity: 0.4 },
      },
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      padding: 0,
      textStyle: { color: 'transparent', fontSize: 0 },
      extraCssText: 'box-shadow: none !important; pointer-events: none;',
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : (params ? [params] : []);
        const idx = arr.length ? arr[0].dataIndex : null;
        if (typeof idx === 'number') updateChartLegend(idx);
        return '';
      },
    },
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    // top-level axisPointer 仅做多 grid 之间的联动（任何副图打开时主图 + 副图共一根十字）。
    // 注意这里不能写 type，否则会和 tooltip.axisPointer 冲突 / 触发 cross 注册查找。
    axisPointer: { link: hasSubplot ? [{ xAxisIndex: 'all' }] : undefined },
    dataZoom: (() => {
      const { start: startPct, end: endPct } = viewToZoomPct(allDatesYMD, state.viewStart, state.viewEnd);
      const dzAxisIndices = hasSubplot
        ? [0, ...activeSubplots.map((_, i) => i + 1)]
        : [0];
      return [
        { type: 'inside', xAxisIndex: dzAxisIndices, filterMode: 'none', start: startPct, end: endPct },
        {
          type: 'slider', xAxisIndex: dzAxisIndices,
          start: startPct, end: endPct,
          height: 18, bottom: 6, filterMode: 'none',
          backgroundColor: theme.bgSubtle,
          dataBackground: { lineStyle: { color: theme.text3, opacity: 0.5 }, areaStyle: { color: theme.text3, opacity: 0.15 } },
          selectedDataBackground: { lineStyle: { color: theme.accent }, areaStyle: { color: theme.accent, opacity: 0.25 } },
          fillerColor: theme.accentSub,
          borderColor: theme.rule,
          handleStyle: { color: theme.bgRaised, borderColor: theme.accent },
          moveHandleStyle: { color: theme.accent, opacity: 0.5 },
          textStyle: { color: theme.text2 },
        },
      ];
    })(),
    // ECharts toolbox 移除：改用 .nav-chart-toolbar 里的自定义 DOM 按钮（见 index.html 和 setupChartToolbar）。
    // 原因：ECharts toolbox 只能画在 canvas 内，会和 markPoint 标签重叠。
    series: [...mainSeries, ...subplotSeries],
  };

  // dataZoom 拖动 / 滚轮缩放 → 反向同步到 state.viewStart/End + 区间输入框
  // 并且 debounce 触发 renderChart：让 markPoint 极值跟随可视窗口刷新。
  chart.off('datazoom');
  chart.on('datazoom', () => {
    if (state._suppressZoomSync) return;
    const opt = chart.getOption();
    const dz = opt.dataZoom && opt.dataZoom[0];
    if (!dz) return;
    const startPct = typeof dz.start === 'number' ? dz.start : 0;
    const endPct = typeof dz.end === 'number' ? dz.end : 100;
    // 维护 mousemove 快照 + 让持久区间在滑块拖动期间实时跟手（不等 200ms debounce）
    state._currentDataZoom = { startPct, endPct };
    syncPersistentRange();
    const { start, end } = zoomPctToView(allDatesYMD, startPct, endPct);
    state.viewStart = start;
    state.viewEnd = end;
    syncRangeInputs();
    state.period = null;
    document.querySelectorAll('.nav-period-btn').forEach(b => b.classList.remove('nav-period-btn-active'));

    // 200ms debounce：拖动期间不重渲染，停下后再算极值
    if (state._zoomDebounceTimer) clearTimeout(state._zoomDebounceTimer);
    state._zoomDebounceTimer = setTimeout(() => {
      state._zoomDebounceTimer = null;
      state._suppressZoomSync = true;
      try { renderChart(); } finally {
        // renderChart -> setOption 会再触发 datazoom 事件；下一帧再放开
        setTimeout(() => { state._suppressZoomSync = false; }, 0);
      }
    }, 200);
  });

  chart.setOption(option, true);

  // 基准日 marker：在 setOption 之后用 graphic 实现一根可拖动的竖线（仅 pct 模式）
  attachBaselineMarker(chart, allDatesYMD, effectiveBaseline, theme);

  // 性能：把"算过的"东西存到 state，让区间统计 panel 拖动时复用，不再重做
  // 1) dataZoom 当前窗口快照 —— 替代 mousemove 路径里的 chart.getOption()
  {
    const { start: zStart, end: zEnd } = viewToZoomPct(allDatesYMD, state.viewStart, state.viewEnd);
    state._currentDataZoom = { startPct: zStart, endPct: zEnd };
  }
  // 2) 对齐数据缓存 —— 替代 showPersistentRangeStats 内的 alignSeriesToDates 全量调用
  state._renderCache = { allDates: allDatesYMD, alignedByCode };

  // 自定义 legend 的"当日净值"文字位：默认显示最新；悬停时由 tooltip.formatter 切换为当日值
  // 首次数据到达时 legend 可能还没建（selection 添加时是第一次建），这里再确保一次
  renderChartLegend();

  // 持久区间选择 overlay/控制 panel/统计 panel —— 轴变了要跟着动
  syncPersistentRange();

  // 任何能走到这里的 state 变更都会被 debounce 保存
  persist();
}

function formatDate(s) {
  if (!s || s.length < 8) return s;
  return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
}

/**
 * 把 effectiveBaseline 落到 allDatesYMD 上的索引。找不到时回退到 0。
 */
function baselineIndex(allDatesYMD, baselineISO) {
  if (!baselineISO) return 0;
  const target = isoToYMD(baselineISO);
  const found = allDatesYMD.findIndex(d => d >= target);
  return found === -1 ? 0 : found;
}

/**
 * 基准日视觉 = 图表里一根被动的虚线 + 图表上方一个 DOM 拖动 panel。
 * 拖动逻辑全部交给 panel 的 DOM 事件（见 ensureBaselinePanel），完全绕开
 * zrender 事件栈，不再与 inside dataZoom 抢鼠标。
 *
 * 注：必须在 chart.setOption 之后调用——要拿到 convertToPixel + grid getRect。
 */
function attachBaselineMarker(chart, allDatesYMD, effectiveBaseline, theme) {
  const panel = document.getElementById('nav-baseline-panel');
  const noMarker = state.valueMode !== 'pct' || !allDatesYMD || !allDatesYMD.length;
  if (noMarker) {
    try { chart.setOption({ graphic: [] }); } catch (_) {}
    if (panel) panel.hidden = true;
    return;
  }

  const idx = baselineIndex(allDatesYMD, effectiveBaseline);
  let pxX, gridRect;
  try {
    pxX = chart.convertToPixel({ xAxisIndex: 0 }, idx);
    gridRect = chart.getModel().getComponent('grid', 0).coordinateSystem.getRect();
  } catch (_) { return; }
  if (!Number.isFinite(pxX) || !gridRect) return;

  // 图表里只画一根被动虚线
  try {
    chart.setOption({
      graphic: [{
        id: 'baseline-line',
        type: 'line',
        x: pxX, y: gridRect.y,
        shape: { x1: 0, y1: 0, x2: 0, y2: gridRect.height },
        style: { stroke: theme.accent, lineWidth: 1.2, lineDash: [4, 4], opacity: 0.85 },
        silent: true, z: 100,
      }],
    });
  } catch (_) {}

  // 定位 DOM panel（canvas 相对 wrap 的偏移 + pxX）
  if (panel) {
    const canvas = document.getElementById('nav-chart-canvas');
    const wrap = document.getElementById('nav-chart-wrap');
    if (canvas && wrap) {
      const cR = canvas.getBoundingClientRect();
      const wR = wrap.getBoundingClientRect();
      const offsetX = cR.left - wR.left;
      panel.style.left = `${offsetX + pxX}px`;
      panel.style.top = `${(cR.top - wR.top) + Math.max(0, gridRect.y - 26)}px`;
      const label = panel.querySelector('.nav-baseline-panel-label');
      if (label) label.textContent = `基准 ${formatDate(allDatesYMD[idx] || '')}`;
      panel.hidden = false;
    }
  }
}

/**
 * 注入 baseline 拖动 panel（一次性）：一个绝对定位的小色标，挂在 .nav-chart-wrap
 * 内部。DOM-level mousedown/move/up 驱动；松手时 convertFromPixel 反解出日期，
 * 写入 state.baseline 并 renderChart。
 */
function ensureBaselinePanel() {
  if (document.getElementById('nav-baseline-panel')) return;
  const wrap = document.getElementById('nav-chart-wrap');
  if (!wrap) return;

  const panel = document.createElement('div');
  panel.id = 'nav-baseline-panel';
  panel.className = 'nav-baseline-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <span class="nav-baseline-panel-label">基准</span>
    <button type="button" class="nav-baseline-panel-reset"
            title="恢复默认基准" aria-label="恢复默认基准">↺</button>
  `;
  wrap.appendChild(panel);

  // 复位按钮：清掉手动 baseline，让自动兜底逻辑接管。
  // mousedown 级别阻断冒泡，否则会把整个 panel 拉进拖动状态。
  const resetBtn = panel.querySelector('.nav-baseline-panel-reset');
  if (resetBtn) {
    resetBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.baseline = null;
      persist();
      if (state.data) renderChart();
    });
  }

  // 读取 grid 在 wrap 里的像素边界 + canvas 偏移，一并返回
  const getBounds = () => {
    const chart = state.chart;
    const canvas = document.getElementById('nav-chart-canvas');
    const wrapEl = document.getElementById('nav-chart-wrap');
    if (!chart || !canvas || !wrapEl) return null;
    let g;
    try { g = chart.getModel().getComponent('grid', 0).coordinateSystem.getRect(); }
    catch (_) { return null; }
    const cR = canvas.getBoundingClientRect();
    const wR = wrapEl.getBoundingClientRect();
    const offsetX = cR.left - wR.left;
    return {
      offsetX,
      leftLimit: offsetX + g.x,
      rightLimit: offsetX + g.x + g.width,
      gridRect: g,
    };
  };

  let dragging = false;
  let dragStartClientX = 0;
  let dragStartLeft = 0;
  // 拖动期间缓存的 bounds —— 避免每次 mousemove 调 ECharts coordinateSystem
  // + 2 次 getBoundingClientRect。拖动中 grid 几何不变；setOption(graphic) 不
  // 触发坐标系重算，缓存安全。
  let dragBounds = null;
  // rAF 节流状态：高频 mousemove 时只在每帧落一次 setOption
  let pendingNewLeft = null;
  let rafId = 0;

  const flushDragFrame = () => {
    rafId = 0;
    if (!dragging || pendingNewLeft == null || !dragBounds) return;
    try {
      state.chart.setOption({ graphic: [{ id: 'baseline-line', x: pendingNewLeft - dragBounds.offsetX }] });
    } catch (_) {}
    pendingNewLeft = null;
  };

  panel.addEventListener('mousedown', (e) => {
    dragging = true;
    dragStartClientX = e.clientX;
    dragStartLeft = parseFloat(panel.style.left || '0');
    dragBounds = getBounds();   // 一次性测量，拖动期间复用
    panel.classList.add('is-dragging');
    // 关掉当前可能还在显示的 tooltip —— panel mousedown 在 canvas 之外，
    // ECharts 自己的隐藏逻辑不会跑；下面 mousemove 里的 setOption 会触发
    // tooltip._keepShow 去重新测量 DOM，目标元素此刻是 null 就会 crash。
    try { state.chart && state.chart.dispatchAction({ type: 'hideTip' }); } catch (_) {}
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const b = dragBounds;
    if (!b) return;
    const dx = e.clientX - dragStartClientX;
    const newLeft = Math.max(b.leftLimit, Math.min(b.rightLimit, dragStartLeft + dx));
    // CSS left 立刻应用 —— DOM 更新本身廉价，视觉跟手
    panel.style.left = `${newLeft}px`;
    // 图表竖线同步走 rAF 节流：120Hz 鼠标也只跑 ~60 次/秒 setOption
    pendingNewLeft = newLeft;
    if (!rafId) rafId = requestAnimationFrame(flushDragFrame);
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('is-dragging');
    // 取消尚未跑的 rAF（避免松手后还有一帧延迟刷竖线）
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    pendingNewLeft = null;
    // 用 mouseup 时实测的 bounds 兜底（页面若在拖动中滚动过，缓存可能略偏）
    const b = getBounds() || dragBounds;
    dragBounds = null;
    if (!b || !state.chart || !state.data) return;

    // canvas 像素 → 数据 idx：手算，绕开 convertFromPixel
    // （后者在某些 zoom 状态下会静默返回 NaN，是上一版没起作用的真凶）
    const pxX = parseFloat(panel.style.left || '0') - b.offsetX;
    const ratio = Math.max(0, Math.min(1, (pxX - b.gridRect.x) / b.gridRect.width));

    const opt = state.chart.getOption();
    const dz = (opt && opt.dataZoom && opt.dataZoom[0]) || {};
    const startPct = typeof dz.start === 'number' ? dz.start : 0;
    const endPct = typeof dz.end === 'number' ? dz.end : 100;

    const allDatesYMD = collectAllDatesYMD(state.data);
    const len = allDatesYMD.length;
    if (len < 2) return;
    const startIdx = Math.round((startPct / 100) * (len - 1));
    const endIdx = Math.round((endPct / 100) * (len - 1));
    const dataIdx = Math.round(startIdx + ratio * (endIdx - startIdx));
    const clamped = Math.max(0, Math.min(len - 1, dataIdx));
    const dropISO = ymdToISO(allDatesYMD[clamped]);
    if (!dropISO) return;
    state.baseline = dropISO;
    renderChart();
  });
}

/* ========== Stats table ========== */

function renderStatsTable(stats) {
  const tbody = document.getElementById('nav-stats-tbody');
  if (!tbody) return;
  if (!stats.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="cached-funds-empty">暂无数据</td></tr>`;
    return;
  }
  const fmt = (v, suffix = '') => v == null || isNaN(v) ? '-' : `${v.toFixed(2)}${suffix}`;
  const fmtPct = (v) => v == null || isNaN(v) ? '-' : `${(v * 100).toFixed(2)}%`;
  tbody.innerHTML = stats.map(s => {
    const sel = state.selected.find(f => f.code === s.code);
    const dotColor = sel?.color || '#999';
    const totalCls = s.totalReturn != null ? (s.totalReturn >= 0 ? 'nav-stats-pos' : 'nav-stats-neg') : '';
    const cagrCls = s.cagr != null ? (s.cagr >= 0 ? 'nav-stats-pos' : 'nav-stats-neg') : '';
    return `
      <tr>
        <td><span class="nav-stats-dot" style="background:${dotColor}"></span>${escapeHtml(s.name || '')}</td>
        <td class="mono">${escapeHtml(s.code)}</td>
        <td class="mono">${fmt(s.startNav, '')}</td>
        <td class="mono">${fmt(s.endNav, '')}</td>
        <td class="mono ${totalCls}">${fmtPct(s.totalReturn)}</td>
        <td class="mono ${cagrCls}">${fmtPct(s.cagr)}</td>
        <td class="mono nav-stats-neg">${fmtPct(s.maxDrawdown)}</td>
        <td class="mono">${fmtPct(s.volatility)}</td>
        <td class="mono">${fmt(s.sharpe)}</td>
      </tr>
    `;
  }).join('');
}

/* ========== Events ========== */

function setupEvents() {
  // 搜索框
  const searchInput = document.getElementById('nav-fund-search');
  const dropdown = document.getElementById('nav-fund-search-dropdown');
  if (searchInput && dropdown) {
    createTypeahead({
      inputEl: searchInput,
      dropdownEl: dropdown,
      debounceMs: 150,
      clearOnSelect: true,
      search: async (q) => {
        if (!q || !q.trim()) return [];
        const list = await loadSearchIndex();
        return filterIndex(list, q);
      },
      renderItem: (r) => `<span class="fund-search-code">${r.code}</span> <span class="fund-search-name">${escapeHtml(r.name)}</span>`,
      onSelect: (r) => addFund({ code: r.code, name: r.name }),
    });
  }

  // 移除基金：改由 legend item 的 × 按钮接管（见 onLegendToggleClick）。
  // 以前的 #nav-selected-chips 区域已从 HTML 移除，这里不再绑定。

  // 清空
  document.getElementById('nav-clear-funds')?.addEventListener('click', () => {
    state.selected = [];
    state.baseline = null;
    renderChartLegend();
    persist();
    fetchAndRender();
  });

  // 周期按钮：仅修改视图窗口（不触发数据重拉）
  document.querySelectorAll('.nav-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-period-btn').forEach(b => b.classList.remove('nav-period-btn-active'));
      btn.classList.add('nav-period-btn-active');
      state.period = btn.dataset.period;

      if (state.data) {
        const allDatesYMD = collectAllDatesYMD(state.data);
        const { start, end } = viewWindowFromPeriod(state.period, allDatesYMD, state.data.series);
        state.viewStart = start;
        state.viewEnd = end;
        syncRangeInputs();
        // setOption 会触发 datazoom 事件 → 防止反向同步把 period 又清掉
        state._suppressZoomSync = true;
        renderChart();
        // datazoom 事件是异步派发；下一帧再放开
        setTimeout(() => { state._suppressZoomSync = false; }, 0);
      } else {
        // 数据还没到：交给 fetchAndRender 用 state.period 给一个默认窗口
        fetchAndRender();
      }
    });
  });

  // 区间输入：自由窗口
  const onRangeInputChange = () => {
    const sEl = document.getElementById('nav-view-start');
    const eEl = document.getElementById('nav-view-end');
    state.viewStart = sEl?.value || null;
    state.viewEnd = eEl?.value || null;
    state.period = null;
    document.querySelectorAll('.nav-period-btn').forEach(b => b.classList.remove('nav-period-btn-active'));
    state._suppressZoomSync = true;
    renderChart();
    setTimeout(() => { state._suppressZoomSync = false; }, 0);
  };
  document.getElementById('nav-view-start')?.addEventListener('change', onRangeInputChange);
  document.getElementById('nav-view-end')?.addEventListener('change', onRangeInputChange);

  // 点击 date input 直接弹日历（自带的小图标已 CSS 隐藏，整框承担点击面）
  // showPicker() 是 Chromium 99+/Safari 16+/Firefox 101+ 的标准方法；不支持时静默降级
  ['nav-view-start', 'nav-view-end'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', () => {
      try { el.showPicker && el.showPicker(); } catch (_) {}
    });
  });

  // 数值模式（pct / nav）：分段按钮组
  document.getElementById('nav-value-mode')?.addEventListener('click', (e) => {
    const btn = e.target instanceof HTMLElement ? e.target.closest('.nav-toggle-btn') : null;
    if (!btn) return;
    state.valueMode = btn.dataset.value;
    btn.parentElement.querySelectorAll('.nav-toggle-btn').forEach(b => b.classList.remove('nav-toggle-btn-active'));
    btn.classList.add('nav-toggle-btn-active');
    renderChart();
  });

  // 坐标刻度（linear / log）：分段按钮组
  document.getElementById('nav-axis-scale')?.addEventListener('click', (e) => {
    const btn = e.target instanceof HTMLElement ? e.target.closest('.nav-toggle-btn') : null;
    if (!btn) return;
    state.axisScale = btn.dataset.value;
    btn.parentElement.querySelectorAll('.nav-toggle-btn').forEach(b => b.classList.remove('nav-toggle-btn-active'));
    btn.classList.add('nav-toggle-btn-active');
    renderChart();
  });

  // 指标：按注册表绑 checkbox change，单一代码路径，新增指标此处无需改动。
  for (const ind of INDICATORS_LIST) {
    document.getElementById(ind.ui.checkboxId)?.addEventListener('change', (e) => {
      state[ind.persist.key] = e.target.checked;
      renderChart();
    });
  }

  // 主题切换：监听 data-theme 变化重绘
  const observer = new MutationObserver(() => {
    if (state.chart) renderChart();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

/* ========== 区间统计：右键拖选 → 持久区间 + 两个可拖动 panel ==========
 * 设计要点：
 *  - 选区以"数据索引" (sIx/eIx) 为唯一真源：切换周期、缩放、主题都不会丢失。
 *    overlay 矩形只是视觉表现，每次 renderChart / dataZoom 后由 syncPersistentRange()
 *    根据当前 gridRect + dataZoom 窗口重新算像素位置。
 *  - 控制 panel (nav-range-control-panel)：贴在 overlay 顶部居中，外框 accent 主题色，
 *    内含拖动把手 + ⊞/× 按钮。mousedown 命中按钮时短路，不触发拖动；
 *    其它区域 mousedown → 整段区间平移（类似基准 marker 的 DOM 拖动模式）。
 *  - 统计 panel (nav-range-stats-panel)：抓 header 自由拖动；拖过一次后位置锁定
 *    (panelLeft/panelTop)，图表刷新不会再自动重定位，直到下一次开新选区。
 *  - 区间变化（创建 / 平移）→ showPersistentRangeStats() 立刻重算 + 重渲染内容。
 *  - 单基金 → 双列 grid；多基金 → 紧凑表格。激活的指标（MA20/MA60）自动出现。
 */

const rangeSel = {
  phase: 'idle',  // 'idle' | 'creating' | 'resting' | 'moving' | 'panel-dragging'
  sIx: null, eIx: null,  // 数据空间锚点（持久）
  startPx: 0, curPx: 0,  // creating 阶段 transient
  canvasOffsetX: 0, canvasOffsetY: 0, canvasH: 0,
  dragStartClientX: 0, origSIx: 0, origEIx: 0,  // control panel 平移 transient
  panelLeft: null, panelTop: null,  // stats panel 用户自定义位置
  panelDragDX: 0, panelDragDY: 0,
};

function rangeGetBounds() {
  const chart = state.chart;
  const canvas = document.getElementById('nav-chart-canvas');
  const wrap = document.getElementById('nav-chart-wrap');
  if (!chart || !canvas || !wrap) return null;
  let gridRect;
  try { gridRect = chart.getModel().getComponent('grid', 0).coordinateSystem.getRect(); }
  catch (_) { return null; }
  const cR = canvas.getBoundingClientRect();
  const wR = wrap.getBoundingClientRect();
  return {
    gridRect,
    canvasOffsetX: cR.left - wR.left,
    canvasOffsetY: cR.top - wR.top,
    canvasWidth: cR.width,
    canvasHeight: cR.height,
  };
}

// 直接读 state 快照；快照由 renderChart 末尾 + 'datazoom' 监听器维护。
// 之前每次 mousemove 都 chart.getOption() 深克隆整棵 option 树是性能杀手。
function rangeGetZoomWindow() {
  return state._currentDataZoom;
}

function rangePxToDataIdx(pxCanvas) {
  const b = rangeGetBounds();
  if (!b) return null;
  const dates = collectAllDatesYMD(state.data);
  if (!dates || dates.length < 2) return null;
  const dz = rangeGetZoomWindow();
  if (!dz) return null;
  const last = dates.length - 1;
  const startIdx = (dz.startPct / 100) * last;
  const endIdx = (dz.endPct / 100) * last;
  const ratio = Math.max(0, Math.min(1, (pxCanvas - b.gridRect.x) / Math.max(1, b.gridRect.width)));
  return startIdx + ratio * (endIdx - startIdx);
}

function rangeDataIdxToPx(dataIdx) {
  const b = rangeGetBounds();
  if (!b) return null;
  const dates = collectAllDatesYMD(state.data);
  if (!dates || dates.length < 2) return null;
  const dz = rangeGetZoomWindow();
  if (!dz) return null;
  const last = dates.length - 1;
  const startIdx = (dz.startPct / 100) * last;
  const endIdx = (dz.endPct / 100) * last;
  const denom = (endIdx - startIdx) || 1;
  return b.gridRect.x + ((dataIdx - startIdx) / denom) * b.gridRect.width;
}

function ensureRangeOverlay() {
  let el = document.getElementById('nav-range-select-overlay');
  if (el) return el;
  const wrap = document.getElementById('nav-chart-wrap');
  if (!wrap) return null;
  el = document.createElement('div');
  el.id = 'nav-range-select-overlay';
  el.className = 'nav-range-select-overlay';
  el.hidden = true;
  wrap.appendChild(el);
  return el;
}

function ensureRangeControlPanel() {
  let panel = document.getElementById('nav-range-control-panel');
  if (panel) return panel;
  const wrap = document.getElementById('nav-chart-wrap');
  if (!wrap) return null;
  panel = document.createElement('div');
  panel.id = 'nav-range-control-panel';
  panel.className = 'nav-range-control-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <span class="nav-range-grip-bars" aria-hidden="true" title="拖动以移动区间"></span>
    <button type="button" class="nav-range-ctrl-btn" data-action="zoom" title="放大到该区域">⊞</button>
    <button type="button" class="nav-range-ctrl-btn" data-action="close" title="关闭">×</button>
  `;
  wrap.appendChild(panel);
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-range-ctrl-btn');
    if (!btn) return;
    if (btn.dataset.action === 'close') clearPersistentRange();
    else if (btn.dataset.action === 'zoom') zoomToPersistentRange();
  });
  panel.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    // 命中按钮 → 不启动拖动（让 click 自然触发）
    if (e.target.closest('.nav-range-ctrl-btn')) return;
    if (rangeSel.sIx == null || rangeSel.eIx == null) return;
    rangeSel.phase = 'moving';
    rangeSel.dragStartClientX = e.clientX;
    rangeSel.origSIx = rangeSel.sIx;
    rangeSel.origEIx = rangeSel.eIx;
    panel.classList.add('is-dragging');
    try { state.chart && state.chart.dispatchAction({ type: 'hideTip' }); } catch (_) {}
    e.preventDefault();
  });
  return panel;
}

function ensureRangeStatsPanel() {
  let panel = document.getElementById('nav-range-stats-panel');
  if (panel) return panel;
  const wrap = document.getElementById('nav-chart-wrap');
  if (!wrap) return null;
  panel = document.createElement('div');
  panel.id = 'nav-range-stats-panel';
  panel.className = 'nav-range-stats-panel';
  panel.hidden = true;
  wrap.appendChild(panel);
  // 抓 header 拖 panel；innerHTML 会被反复替换，但 mousedown 挂在 panel 本体
  panel.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const header = e.target.closest('.nav-range-stats-header');
    if (!header) return;
    if (e.target.closest('.nav-range-stats-btn')) return;
    const pR = panel.getBoundingClientRect();
    rangeSel.phase = 'panel-dragging';
    rangeSel.panelDragDX = e.clientX - pR.left;
    rangeSel.panelDragDY = e.clientY - pR.top;
    panel.classList.add('is-dragging');
    e.preventDefault();
  });
  return panel;
}

function setupRangeSelection() {
  const canvas = document.getElementById('nav-chart-canvas');
  const wrap = document.getElementById('nav-chart-wrap');
  if (!canvas || !wrap || canvas._navRangeSetup) return;
  canvas._navRangeSetup = true;
  ensureRangeOverlay();
  ensureRangeControlPanel();
  ensureRangeStatsPanel();

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // 初始右键拖选：开始
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
    e.preventDefault();
    clearPersistentRange();
    const cR = canvas.getBoundingClientRect();
    const wR = wrap.getBoundingClientRect();
    rangeSel.phase = 'creating';
    rangeSel.startPx = e.clientX - cR.left;
    rangeSel.curPx = rangeSel.startPx;
    rangeSel.canvasOffsetX = cR.left - wR.left;
    rangeSel.canvasOffsetY = cR.top - wR.top;
    rangeSel.canvasH = cR.height;
    drawCreatingOverlay();
  });

  // mousemove 高频事件 → 用 rAF 折叠到 60Hz，只处理每帧最后一次坐标。
  // 'creating' 阶段轻量（只画矩形），不节流；'moving' / 'panel-dragging' 涉及对齐/MA/getBCR 等
  // 较重操作，必须节流，否则一次拖动几百毫秒堆积上千次回调会卡得明显。
  let _rangeRafScheduled = false;
  let _rangeLastEvt = null;
  document.addEventListener('mousemove', (e) => {
    if (rangeSel.phase === 'creating') {
      const cR = canvas.getBoundingClientRect();
      rangeSel.curPx = Math.max(0, Math.min(cR.width, e.clientX - cR.left));
      drawCreatingOverlay();
      return;
    }
    if (rangeSel.phase !== 'moving' && rangeSel.phase !== 'panel-dragging') return;
    // 只保留最新一次坐标；rAF 触发时再处理
    _rangeLastEvt = { clientX: e.clientX, clientY: e.clientY };
    if (_rangeRafScheduled) return;
    _rangeRafScheduled = true;
    requestAnimationFrame(() => {
      _rangeRafScheduled = false;
      const ev = _rangeLastEvt;
      if (!ev) return;
      if (rangeSel.phase === 'moving') onControlPanelMove(ev);
      else if (rangeSel.phase === 'panel-dragging') onStatsPanelMove(ev);
    });
  });

  document.addEventListener('mouseup', () => {
    if (rangeSel.phase === 'creating') {
      const dx = Math.abs(rangeSel.curPx - rangeSel.startPx);
      if (dx < 5) { clearPersistentRange(); rangeSel.phase = 'idle'; return; }
      finalizeCreation();
    } else if (rangeSel.phase === 'moving') {
      rangeSel.phase = 'resting';
      const cp = document.getElementById('nav-range-control-panel');
      if (cp) cp.classList.remove('is-dragging');
    } else if (rangeSel.phase === 'panel-dragging') {
      rangeSel.phase = rangeSel.sIx != null ? 'resting' : 'idle';
      const sp = document.getElementById('nav-range-stats-panel');
      if (sp) sp.classList.remove('is-dragging');
    }
  });
}

function drawCreatingOverlay() {
  const el = document.getElementById('nav-range-select-overlay');
  if (!el) return;
  const minPx = Math.min(rangeSel.startPx, rangeSel.curPx);
  const maxPx = Math.max(rangeSel.startPx, rangeSel.curPx);
  el.style.left = `${rangeSel.canvasOffsetX + minPx}px`;
  el.style.top = `${rangeSel.canvasOffsetY}px`;
  el.style.width = `${Math.max(0, maxPx - minPx)}px`;
  el.style.height = `${rangeSel.canvasH}px`;
  el.hidden = false;
}

function finalizeCreation() {
  if (!state.chart || !state.data) { clearPersistentRange(); rangeSel.phase = 'idle'; return; }
  const minPx = Math.min(rangeSel.startPx, rangeSel.curPx);
  const maxPx = Math.max(rangeSel.startPx, rangeSel.curPx);
  const sF = rangePxToDataIdx(minPx);
  const eF = rangePxToDataIdx(maxPx);
  const dates = collectAllDatesYMD(state.data);
  if (sF == null || eF == null || !dates || dates.length < 2) {
    clearPersistentRange(); rangeSel.phase = 'idle'; return;
  }
  const last = dates.length - 1;
  const sIx = Math.max(0, Math.min(last, Math.round(sF)));
  const eIx = Math.max(0, Math.min(last, Math.round(eF)));
  if (eIx <= sIx) { clearPersistentRange(); rangeSel.phase = 'idle'; return; }
  rangeSel.sIx = sIx;
  rangeSel.eIx = eIx;
  rangeSel.phase = 'resting';
  rangeSel.panelLeft = null;  // 新选区 → 解锁 stats panel 位置，回到自动贴边
  rangeSel.panelTop = null;
  syncPersistentRange();
  showPersistentRangeStats();
}

function onControlPanelMove(e) {
  const b = rangeGetBounds();
  if (!b) return;
  const dates = collectAllDatesYMD(state.data);
  if (!dates || dates.length < 2) return;
  const dz = rangeGetZoomWindow();
  if (!dz) return;
  const last = dates.length - 1;
  const startIdx = (dz.startPct / 100) * last;
  const endIdx = (dz.endPct / 100) * last;
  const dIdxPerPx = (endIdx - startIdx) / Math.max(1, b.gridRect.width);
  const dx = e.clientX - rangeSel.dragStartClientX;
  let newS = rangeSel.origSIx + dx * dIdxPerPx;
  let newE = rangeSel.origEIx + dx * dIdxPerPx;
  const width = rangeSel.origEIx - rangeSel.origSIx;
  if (newS < 0) { newS = 0; newE = width; }
  if (newE > last) { newE = last; newS = last - width; }
  const s = Math.max(0, Math.min(last, Math.round(newS)));
  const eIx = Math.max(0, Math.min(last, Math.round(newE)));
  if (eIx <= s) return;
  rangeSel.sIx = s;
  rangeSel.eIx = eIx;
  syncPersistentRange();
  showPersistentRangeStats();
}

function onStatsPanelMove(e) {
  const panel = document.getElementById('nav-range-stats-panel');
  const wrap = document.getElementById('nav-chart-wrap');
  if (!panel || !wrap) return;
  const wR = wrap.getBoundingClientRect();
  const pw = panel.offsetWidth;
  const ph = panel.offsetHeight;
  let left = e.clientX - wR.left - rangeSel.panelDragDX;
  let top = e.clientY - wR.top - rangeSel.panelDragDY;
  left = Math.max(4, Math.min(Math.max(4, wR.width - pw - 4), left));
  top = Math.max(4, Math.min(Math.max(4, wR.height - ph - 4), top));
  rangeSel.panelLeft = left;
  rangeSel.panelTop = top;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function syncPersistentRange() {
  if (rangeSel.phase === 'idle' || rangeSel.sIx == null || rangeSel.eIx == null) return;
  const b = rangeGetBounds();
  if (!b) return;
  const dates = collectAllDatesYMD(state.data);
  if (!dates || dates.length < 2) return;
  const sPx = rangeDataIdxToPx(rangeSel.sIx);
  const ePx = rangeDataIdxToPx(rangeSel.eIx);
  if (sPx == null || ePx == null) return;
  const gLeft = b.gridRect.x;
  const gRight = b.gridRect.x + b.gridRect.width;
  const clipS = Math.max(gLeft, Math.min(gRight, Math.min(sPx, ePx)));
  const clipE = Math.max(gLeft, Math.min(gRight, Math.max(sPx, ePx)));
  const width = Math.max(0, clipE - clipS);

  const overlay = document.getElementById('nav-range-select-overlay');
  const control = document.getElementById('nav-range-control-panel');
  const stats = document.getElementById('nav-range-stats-panel');

  if (width < 1) {
    if (overlay) overlay.hidden = true;
    if (control) control.hidden = true;
  } else {
    if (overlay) {
      overlay.style.left = `${b.canvasOffsetX + clipS}px`;
      overlay.style.top = `${b.canvasOffsetY + b.gridRect.y}px`;
      overlay.style.width = `${width}px`;
      overlay.style.height = `${b.gridRect.height}px`;
      overlay.hidden = false;
    }
    if (control) {
      control.hidden = false;
      const cw = control.offsetWidth || 80;
      const minL = b.canvasOffsetX + gLeft;
      const maxL = b.canvasOffsetX + gRight - cw;
      let left = b.canvasOffsetX + clipS + width / 2 - cw / 2;
      left = Math.max(minL, Math.min(maxL, left));
      control.style.left = `${left}px`;
      control.style.top = `${b.canvasOffsetY + Math.max(0, b.gridRect.y - 26)}px`;
    }
  }

  if (stats && !stats.hidden && rangeSel.panelLeft == null) {
    const pw = stats.offsetWidth || 320;
    let left = b.canvasOffsetX + clipE + 8;
    if (left + pw > b.canvasOffsetX + gRight) {
      left = b.canvasOffsetX + clipS - pw - 8;
    }
    if (left < 8) left = 8;
    stats.style.left = `${left}px`;
    stats.style.top = `${b.canvasOffsetY + b.gridRect.y + 12}px`;
  }
}

function clearPersistentRange() {
  rangeSel.phase = 'idle';
  rangeSel.sIx = null;
  rangeSel.eIx = null;
  rangeSel.panelLeft = null;
  rangeSel.panelTop = null;
  const overlay = document.getElementById('nav-range-select-overlay');
  const control = document.getElementById('nav-range-control-panel');
  const stats = document.getElementById('nav-range-stats-panel');
  if (overlay) overlay.hidden = true;
  if (control) control.hidden = true;
  if (stats) stats.hidden = true;
}

function zoomToPersistentRange() {
  if (rangeSel.sIx == null || rangeSel.eIx == null) return;
  const dates = collectAllDatesYMD(state.data);
  if (!dates || dates.length < 2) return;
  state.viewStart = ymdToISO(dates[rangeSel.sIx]);
  state.viewEnd = ymdToISO(dates[rangeSel.eIx]);
  state.period = null;
  document.querySelectorAll('.nav-period-btn').forEach(b => b.classList.remove('nav-period-btn-active'));
  syncRangeInputs();
  // 放大后选区正好填满视窗 → 隐藏 stats panel，信息已在主图反映
  const stats = document.getElementById('nav-range-stats-panel');
  if (stats) stats.hidden = true;
  renderChart();
}

function showPersistentRangeStats() {
  if (!state.chart || !state.data) return;
  if (rangeSel.sIx == null || rangeSel.eIx == null) return;

  // 优先用 renderChart 期间预算的对齐缓存；缓存未建好时（极端时序）走慢路径兜底
  const cache = state._renderCache;
  const allDates = cache?.allDates || collectAllDatesYMD(state.data);
  if (!allDates.length) return;
  const alignedByCode = cache?.alignedByCode;

  const series = state.data.series || [];
  const rsInds = getEnabledRangeStatsIndicators(state);
  const perFund = series.map(srs => {
    const aligned = alignedByCode?.get(srs.code) || alignSeriesToDates(allDates, srs);
    const stats = computeRangeStats(allDates, aligned, rangeSel.sIx, rangeSel.eIx);
    if (!stats) return null;
    const sel = state.selected.find(f => f.code === srs.code);
    const color = sel?.color || '#888';
    // 指标注册表驱动：当前启用且声明了 rangeStats.single 的指标，取末点值。
    // single 实现一般是 O(period)，高频拖动也不卡。
    const indicators = {};
    for (const ind of rsInds) {
      const v = ind.rangeStats.single(aligned, stats.lastIdx);
      if (v != null && Number.isFinite(v)) indicators[ind.id] = v;
    }
    return { code: srs.code, name: srs.name, color, stats, indicators };
  }).filter(Boolean);

  const panel = ensureRangeStatsPanel();
  if (!panel) return;

  if (!perFund.length) {
    panel.innerHTML = `
      <div class="nav-range-stats-header" title="拖动可移动此面板">
        <span class="nav-range-stats-title">区间内无有效数据</span>
      </div>`;
  } else {
    const days = perFund[0]?.stats?.days ?? 0;
    const headerHTML = `
      <div class="nav-range-stats-header" title="拖动可移动此面板">
        <span class="nav-range-stats-title">${formatDate(allDates[rangeSel.sIx])} — ${formatDate(allDates[rangeSel.eIx])} (${days}日)</span>
      </div>`;
    const bodyHTML = perFund.length === 1
      ? renderSingleFundBody(perFund[0], rsInds)
      : renderMultiFundTable(perFund, rsInds);
    panel.innerHTML = headerHTML + bodyHTML;
  }

  panel.hidden = false;
  if (rangeSel.panelLeft != null) {
    panel.style.left = `${rangeSel.panelLeft}px`;
    panel.style.top = `${rangeSel.panelTop}px`;
  } else {
    syncPersistentRange();
  }
}

function renderSingleFundBody(p, rsInds) {
  const f = (n, dec = 4) => Number.isFinite(n) ? n.toFixed(dec) : '-';
  const pct = (n, dec = 2) => Number.isFinite(n) ? `${n.toFixed(dec)}%` : '-';
  const cls = (n) => Number.isFinite(n) ? (n >= 0 ? 'nav-range-pos' : 'nav-range-neg') : '';
  const s = p.stats;
  const ind = p.indicators || {};
  // 指标 cells 按注册表顺序生成—— 只出现当前 enabled 且有值的
  const indCells = [];
  for (const I of rsInds) {
    const v = ind[I.id];
    if (!Number.isFinite(v)) continue;
    indCells.push(
      `<span class="label">${escapeHtml(I.rangeStats.label)}</span><span class="value mono">${f(v)}</span>`
    );
  }
  // 单数行的指标占位补一个空 cell，保持双列对齐
  if (indCells.length % 2 === 1) {
    indCells.push('<span></span><span></span>');
  }
  return `
    <div class="nav-range-stats-grid">
      <span class="label">涨跌幅</span><span class="value mono ${cls(s.changePct)}">${pct(s.changePct)}</span>
      <span class="label">年化收益率</span><span class="value mono ${cls(s.cagr)}">${pct(s.cagr)}</span>
      <span class="label">涨&nbsp;&nbsp;跌</span><span class="value mono ${cls(s.change)}">${f(s.change)}</span>
      <span class="label">最大回撤</span><span class="value mono nav-range-neg">${pct(s.maxDrawdown)}</span>
      <span class="label">最大上涨</span><span class="value mono nav-range-pos">${pct(s.maxRise)}</span>
      <span class="label">振&nbsp;&nbsp;幅</span><span class="value mono">${pct(s.swing)}</span>
      <span class="label">最高价</span><span class="value mono">${f(s.maxNav)}</span>
      <span class="label">最低价</span><span class="value mono">${f(s.minNav)}</span>
      <span class="label">均&nbsp;&nbsp;价</span><span class="value mono">${f(s.meanNav)}</span>
      ${indCells.join('')}
    </div>`;
}

function renderMultiFundTable(perFund, rsInds) {
  const f = (n, dec = 4) => Number.isFinite(n) ? n.toFixed(dec) : '-';
  const pct = (n, dec = 2) => Number.isFinite(n) ? `${n.toFixed(dec)}%` : '-';
  const cls = (n) => Number.isFinite(n) ? (n >= 0 ? 'nav-range-pos' : 'nav-range-neg') : '';
  const headerCells = [
    '<th>名称</th>',
    '<th>涨跌幅</th>',
    '<th>涨跌</th>',
    '<th>振幅</th>',
    '<th>年化</th>',
    '<th>最大回撤</th>',
  ];
  // 指标列按注册表顺序追加
  for (const I of rsInds) {
    headerCells.push(`<th>${escapeHtml(I.rangeStats.label)}</th>`);
  }
  const rows = perFund.map(p => {
    const s = p.stats;
    const cells = [
      `<td><span class="nav-range-dot" style="background:${p.color}"></span>${escapeHtml(p.code)} ${escapeHtml(p.name)}</td>`,
      `<td class="mono ${cls(s.changePct)}">${pct(s.changePct)}</td>`,
      `<td class="mono ${cls(s.change)}">${f(s.change)}</td>`,
      `<td class="mono">${pct(s.swing)}</td>`,
      `<td class="mono ${cls(s.cagr)}">${pct(s.cagr)}</td>`,
      `<td class="mono nav-range-neg">${pct(s.maxDrawdown)}</td>`,
    ];
    for (const I of rsInds) {
      const v = p.indicators?.[I.id];
      cells.push(`<td class="mono">${f(v)}</td>`);
    }
    return `<tr>${cells.join('')}</tr>`;
  });
  return `
    <table class="nav-range-stats-table">
      <thead><tr>${headerCells.join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
}

/* ========== 自定义图表 toolbar（保存 / 重置） ==========
 * 取代 ECharts 内置 toolbox：内置的渲染在 canvas 内、会和 markPoint 挤位。
 * 改成 header 右侧的 DOM 按钮后，两个 action 在 state/chart 就绪时才生效。
 */
function setupChartToolbar() {
  const saveBtn = document.getElementById('nav-chart-toolbar-save');
  const restoreBtn = document.getElementById('nav-chart-toolbar-restore');

  if (saveBtn && !saveBtn.dataset.bound) {
    saveBtn.dataset.bound = '1';
    saveBtn.addEventListener('click', () => {
      if (!state.chart) return;
      const theme = readThemeColors();
      const dataURL = state.chart.getDataURL({
        type: 'png',
        pixelRatio: 2,
        backgroundColor: theme.bgRaised,
      });
      const a = document.createElement('a');
      a.href = dataURL;
      a.download = `nav-compare-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  if (restoreBtn && !restoreBtn.dataset.bound) {
    restoreBtn.dataset.bound = '1';
    restoreBtn.addEventListener('click', () => {
      if (!state.chart || !state.data) return;
      // 重置视图：清区间锚点 + period 回 MAX；UI 同步后重渲染（带 MAX 的 dataZoom）
      state.viewStart = null;
      state.viewEnd = null;
      state.period = 'MAX';
      document.querySelectorAll('.nav-period-btn').forEach(b => {
        b.classList.toggle('nav-period-btn-active', b.dataset.period === 'MAX');
      });
      syncRangeInputs();
      clearPersistentRange();
      renderChart();
      persist();
    });
  }

  const fullscreenBtn = document.getElementById('nav-chart-toolbar-fullscreen');
  if (fullscreenBtn && !fullscreenBtn.dataset.bound) {
    fullscreenBtn.dataset.bound = '1';
    fullscreenBtn.addEventListener('click', () => toggleNavFullscreen());
  }

  // Esc 退出 + 路由切走时自动退出：document 级只挂一次
  if (!document.body.dataset.navFullscreenEscBound) {
    document.body.dataset.navFullscreenEscBound = '1';
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('is-fullscreen-nav')) {
        toggleNavFullscreen(false);
      }
    });
    window.addEventListener('hashchange', () => {
      // 离开 #/nav 时若还挂着全屏态，清掉—— overlay 不能遮其它页面
      if (!/^#\/nav(\/|$)/.test(window.location.hash)
          && document.body.classList.contains('is-fullscreen-nav')) {
        toggleNavFullscreen(false);
      }
    });
  }
}

/**
 * 切换 nav 页全屏。force=true/false 强制进/退，undefined=toggle。
 * 切换后 rAF×2 再 chart.resize() —— 一帧让 grid 布局 reflow，下一帧 ECharts 按新尺寸重绘。
 */
function toggleNavFullscreen(force) {
  const body = document.body;
  const btn = document.getElementById('nav-chart-toolbar-fullscreen');
  const willEnter = force !== undefined ? !!force : !body.classList.contains('is-fullscreen-nav');
  body.classList.toggle('is-fullscreen-nav', willEnter);
  if (btn) {
    btn.classList.toggle('is-active', willEnter);
    btn.setAttribute('aria-pressed', willEnter ? 'true' : 'false');
    btn.title = willEnter ? '退出全屏' : '全屏';
    btn.setAttribute('aria-label', willEnter ? '退出全屏' : '全屏');
  }
  // 让 grid 布局生效后再 resize chart，否则 ECharts 拿到的还是旧尺寸
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try { state.chart && state.chart.resize(); } catch (_) {}
      // 区间选区 overlay 像素位置依赖 canvas 尺寸，resize 后同步
      try { syncPersistentRange(); } catch (_) {}
    });
  });
}

export function pageInit() {
  loadPersistedState();
  // 交易日历：后台预热，渲染路径里会 await 同一个 Promise，不会重复 fetch
  loadTradeCalendar();
  setupEvents();
  setupChartToolbar();
  applyStateToUI();
  renderChartLegend();
  if (state.selected.length) fetchAndRender();
}
