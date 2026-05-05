/**
 * 净值比较页 (NAV Compare)
 * 依赖：window.echarts (CDN 全局)
 */

const COLORS = ['#c47a3d', '#2a8e6c', '#3f6cc4', '#b8732d', '#c0412d', '#7e6cc4', '#5d8aa8', '#9b6b3f'];

function resolveFundApiBase() {
  if (typeof window !== 'undefined' && window.FUND_FEE_API_BASE) {
    const b = window.FUND_FEE_API_BASE;
    return b.replace(/\/api\/fund\/?$/, '/api');
  }
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3457/api';
    if (h.endsWith('.github.io')) return null;
    return '/api';
  }
  return null;
}

const state = {
  selected: [],   // [{code, name, color}]
  period: '1Y',
  yMode: 'pct',
  baseline: null, // YYYY-MM-DD; null = first day of range
  showMA20: false,
  showMA60: false,
  showDD: true,
  data: null,     // last compare response
  chart: null,
  searchIndex: null,
};

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

function periodToRange(period) {
  const now = new Date();
  const end = ymd(now);
  if (period === 'MAX') return { start: '19980101', end };
  const map = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365, '3Y': 365 * 3, '5Y': 365 * 5 };
  const days = map[period] || 365;
  const start = new Date(now.getTime() - days * 86400000);
  return { start: ymd(start), end };
}

function pickInterval(period) {
  if (period === '5Y' || period === 'MAX') return 'weekly';
  return 'daily';
}

async function loadSearchIndex() {
  if (state.searchIndex) return state.searchIndex;
  const base = resolveFundApiBase();
  try {
    const r = await fetch(`${base}/fund/search-index`);
    if (r.ok) state.searchIndex = await r.json();
  } catch {}
  if (!state.searchIndex) {
    try {
      const r = await fetch('data/allfund/search-index.json');
      if (r.ok) state.searchIndex = await r.json();
    } catch {}
  }
  return state.searchIndex || [];
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

function renderChips() {
  const wrap = document.getElementById('nav-selected-chips');
  if (!wrap) return;
  if (!state.selected.length) {
    wrap.innerHTML = '<span class="nav-chips-empty">尚未选择基金</span>';
    return;
  }
  wrap.innerHTML = state.selected.map((f, i) => `
    <span class="nav-chip" style="--chip-color:${f.color}">
      <span class="nav-chip-dot"></span>
      <span class="nav-chip-code">${f.code}</span>
      <span class="nav-chip-name">${escapeHtml(f.name)}</span>
      <button type="button" class="nav-chip-remove" data-idx="${i}" aria-label="移除">×</button>
    </span>
  `).join('');
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

function showSearchDropdown(items, inputEl, ddEl) {
  ddEl.innerHTML = '';
  if (!items.length) { ddEl.classList.remove('fund-search-dropdown-visible'); return; }
  for (const r of items) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.code = r.code;
    li.dataset.name = r.name;
    li.innerHTML = `<span class="fund-search-code">${r.code}</span> <span class="fund-search-name">${escapeHtml(r.name)}</span>`;
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      addFund({ code: r.code, name: r.name });
      inputEl.value = '';
      ddEl.classList.remove('fund-search-dropdown-visible');
    });
    ddEl.appendChild(li);
  }
  ddEl.classList.add('fund-search-dropdown-visible');
}

async function addFund(f) {
  if (state.selected.find(x => x.code === f.code)) return;
  if (state.selected.length >= 10) {
    alert('一次最多对比 10 只基金');
    return;
  }
  const color = COLORS[state.selected.length % COLORS.length];
  state.selected.push({ code: f.code, name: f.name, color });
  renderChips();
  await fetchAndRender();
}

function removeFund(idx) {
  state.selected.splice(idx, 1);
  // 重新分配颜色
  state.selected.forEach((f, i) => f.color = COLORS[i % COLORS.length]);
  renderChips();
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
  const codes = state.selected.map(f => f.code).join(',');
  const { start, end } = periodToRange(state.period);
  const interval = pickInterval(state.period);
  const base = resolveFundApiBase();
  if (!base) { alert('当前无后端 API'); return; }
  try {
    const r = await fetch(`${base}/nav/compare?codes=${codes}&start=${start}&end=${end}&interval=${interval}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    state.data = await r.json();
    renderChart();
    renderStatsTable(state.data.stats || []);
  } catch (e) {
    console.error('compare 请求失败', e);
    alert('数据请求失败：' + e.message);
  }
}

/* ========== 计算 ========== */

function computeMA(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0, count = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    count++;
    if (i >= n) { sum -= values[i - n]; count--; }
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function computeDrawdown(values) {
  const out = new Array(values.length).fill(0);
  let peak = values[0] ?? 1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > peak) peak = values[i];
    out[i] = peak > 0 ? (values[i] / peak - 1) * 100 : 0;
  }
  return out;
}

function transformByMode(dates, navs, mode, baselineDate) {
  if (mode === 'raw') return navs.slice();
  if (mode === 'log') return navs.map(v => v > 0 ? Math.log(v) : null);
  // pct: 相对基准日
  let baseIdx = 0;
  if (baselineDate) {
    const target = baselineDate.replace(/-/g, '');
    baseIdx = dates.findIndex(d => d >= target);
    if (baseIdx === -1) baseIdx = 0;
  }
  const base = navs[baseIdx];
  if (!base) return navs.map(() => null);
  return navs.map(v => v != null ? (v / base - 1) * 100 : null);
}

/* ========== Chart ========== */

function ensureChart() {
  if (state.chart) return state.chart;
  const canvas = document.getElementById('nav-chart-canvas');
  if (!canvas || !window.echarts) return null;
  state.chart = window.echarts.init(canvas, null, { renderer: 'canvas' });
  window.addEventListener('resize', () => state.chart && state.chart.resize());
  // 主题随 [data-theme] 同步背景
  return state.chart;
}

function readThemeColors() {
  const css = getComputedStyle(document.documentElement);
  return {
    text:    css.getPropertyValue('--text-primary').trim() || '#1a1918',
    text2:   css.getPropertyValue('--text-secondary').trim() || '#54514b',
    rule:    css.getPropertyValue('--rule').trim() || '#ebe8e1',
    bgRaised:css.getPropertyValue('--bg-raised').trim() || '#fff',
  };
}

function renderChart() {
  const chart = ensureChart();
  if (!chart || !state.data) return;
  const { series } = state.data;
  if (!series || !series.length) { chart.clear(); return; }

  const theme = readThemeColors();
  const showDD = state.showDD;
  const yMode = state.yMode;

  // 多基金日期对齐：用 union(dates) 排序
  const dateSet = new Set();
  for (const s of series) for (const d of s.dates) dateSet.add(d);
  const allDates = [...dateSet].sort();
  // 每条曲线索引化
  const lineSeries = [];
  const ddSeries = [];
  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    const sel = state.selected.find(f => f.code === s.code);
    const color = sel?.color || COLORS[i % COLORS.length];
    const navByDate = new Map();
    s.dates.forEach((d, idx) => navByDate.set(d, s.adjNavs[idx]));
    const aligned = allDates.map(d => navByDate.get(d) ?? null);
    // 前向填充缺失（避免 null 断线）
    let last = null;
    for (let k = 0; k < aligned.length; k++) {
      if (aligned[k] != null) last = aligned[k];
      else aligned[k] = last;
    }
    const transformed = transformByMode(allDates, aligned, yMode, state.baseline);
    lineSeries.push({
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
    });
    if (state.showMA20 && yMode !== 'log') {
      const ma = computeMA(transformed, 20);
      lineSeries.push({
        name: `${s.code} MA20`,
        type: 'line',
        data: ma,
        showSymbol: false,
        lineStyle: { width: 1, color, type: 'dashed', opacity: 0.6 },
        xAxisIndex: 0, yAxisIndex: 0,
        connectNulls: true,
      });
    }
    if (state.showMA60 && yMode !== 'log') {
      const ma = computeMA(transformed, 60);
      lineSeries.push({
        name: `${s.code} MA60`,
        type: 'line',
        data: ma,
        showSymbol: false,
        lineStyle: { width: 1, color, type: 'dotted', opacity: 0.6 },
        xAxisIndex: 0, yAxisIndex: 0,
        connectNulls: true,
      });
    }
    if (showDD) {
      const dd = computeDrawdown(aligned);
      ddSeries.push({
        name: `${s.code} 回撤`,
        type: 'line',
        data: dd,
        showSymbol: false,
        lineStyle: { width: 1, color },
        areaStyle: { color, opacity: 0.08 },
        xAxisIndex: 1, yAxisIndex: 1,
        sampling: 'lttb',
        connectNulls: true,
      });
    }
  }

  const grids = showDD ? [
    { left: 60, right: 30, top: 50, height: '58%' },
    { left: 60, right: 30, top: '74%', height: '18%' },
  ] : [
    { left: 60, right: 30, top: 50, bottom: 60 },
  ];
  const xAxes = showDD ? [
    { type: 'category', data: allDates.map(formatDate), gridIndex: 0, axisLabel: { color: theme.text2, fontSize: 11 }, axisLine: { lineStyle: { color: theme.rule } }, splitLine: { show: false } },
    { type: 'category', data: allDates.map(formatDate), gridIndex: 1, axisLabel: { color: theme.text2, fontSize: 11 }, axisLine: { lineStyle: { color: theme.rule } }, splitLine: { show: false } },
  ] : [
    { type: 'category', data: allDates.map(formatDate), gridIndex: 0, axisLabel: { color: theme.text2, fontSize: 11 }, axisLine: { lineStyle: { color: theme.rule } }, splitLine: { show: false } },
  ];
  const yAxes = showDD ? [
    { type: yMode === 'log' ? 'log' : 'value', name: yAxisName(yMode), nameTextStyle: { color: theme.text2, fontSize: 11 }, gridIndex: 0, axisLabel: { color: theme.text2, fontSize: 11, formatter: yMode === 'pct' ? (v) => `${v.toFixed(0)}%` : undefined }, splitLine: { lineStyle: { color: theme.rule, opacity: 0.5 } }, scale: true },
    { type: 'value', name: '回撤', nameTextStyle: { color: theme.text2, fontSize: 11 }, gridIndex: 1, max: 0, axisLabel: { color: theme.text2, fontSize: 11, formatter: (v) => `${v.toFixed(0)}%` }, splitLine: { lineStyle: { color: theme.rule, opacity: 0.5 } } },
  ] : [
    { type: yMode === 'log' ? 'log' : 'value', name: yAxisName(yMode), nameTextStyle: { color: theme.text2, fontSize: 11 }, gridIndex: 0, axisLabel: { color: theme.text2, fontSize: 11, formatter: yMode === 'pct' ? (v) => `${v.toFixed(0)}%` : undefined }, splitLine: { lineStyle: { color: theme.rule, opacity: 0.5 } }, scale: true },
  ];

  const option = {
    backgroundColor: 'transparent',
    animation: false,
    legend: { top: 8, left: 'center', textStyle: { color: theme.text2, fontSize: 11 } },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { backgroundColor: theme.text } },
      backgroundColor: theme.bgRaised,
      borderColor: theme.rule,
      textStyle: { color: theme.text, fontSize: 12 },
    },
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    axisPointer: { link: showDD ? [{ xAxisIndex: 'all' }] : undefined },
    dataZoom: [
      { type: 'inside', xAxisIndex: showDD ? [0, 1] : [0], filterMode: 'none' },
      { type: 'slider', xAxisIndex: showDD ? [0, 1] : [0], height: 18, bottom: 12, filterMode: 'none', borderColor: theme.rule },
    ],
    toolbox: {
      right: 12, top: 6, itemSize: 14, iconStyle: { borderColor: theme.text2 },
      feature: {
        saveAsImage: { title: '保存图片', name: 'nav-compare' },
        restore: { title: '重置缩放' },
      },
    },
    series: [...lineSeries, ...ddSeries],
  };

  // 点击 X 轴某点设为基准
  chart.off('click');
  chart.on('click', (params) => {
    if (yMode !== 'pct') return;
    if (params.componentType !== 'series') return;
    const dateStr = allDates[params.dataIndex];
    if (!dateStr) return;
    const iso = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;
    state.baseline = iso;
    const dEl = document.getElementById('nav-baseline-date');
    if (dEl) dEl.value = iso;
    renderChart();
  });

  chart.setOption(option, true);
}

function yAxisName(mode) {
  if (mode === 'pct') return '累计收益 %';
  if (mode === 'log') return '净值 (log)';
  return '净值';
}

function formatDate(s) {
  if (!s || s.length < 8) return s;
  return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
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
    const onInput = debounce(async () => {
      const q = searchInput.value.trim();
      if (!q) { dropdown.classList.remove('fund-search-dropdown-visible'); return; }
      const list = await loadSearchIndex();
      showSearchDropdown(filterIndex(list, q), searchInput, dropdown);
    }, 150);
    searchInput.addEventListener('input', onInput);
    searchInput.addEventListener('focus', onInput);
    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('fund-search-dropdown-visible');
      }
    });
  }

  // 移除 chip
  const chipsWrap = document.getElementById('nav-selected-chips');
  if (chipsWrap) {
    chipsWrap.addEventListener('click', (e) => {
      const btn = e.target instanceof HTMLElement ? e.target.closest('.nav-chip-remove') : null;
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx, 10);
      if (!isNaN(idx)) removeFund(idx);
    });
  }

  // 清空
  document.getElementById('nav-clear-funds')?.addEventListener('click', () => {
    state.selected = [];
    renderChips();
    fetchAndRender();
  });

  // 周期
  document.querySelectorAll('.nav-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-period-btn').forEach(b => b.classList.remove('nav-period-btn-active'));
      btn.classList.add('nav-period-btn-active');
      state.period = btn.dataset.period;
      state.baseline = null; // 切周期后重置基准
      const dEl = document.getElementById('nav-baseline-date');
      if (dEl) dEl.value = '';
      fetchAndRender();
    });
  });

  // Y 模式
  document.getElementById('nav-y-mode')?.addEventListener('change', (e) => {
    state.yMode = e.target.value;
    const wrap = document.getElementById('nav-baseline-wrap');
    if (wrap) wrap.style.display = state.yMode === 'pct' ? '' : 'none';
    renderChart();
  });

  // 基准日期
  document.getElementById('nav-baseline-date')?.addEventListener('change', (e) => {
    state.baseline = e.target.value || null;
    renderChart();
  });
  document.getElementById('nav-baseline-reset')?.addEventListener('click', () => {
    state.baseline = null;
    const dEl = document.getElementById('nav-baseline-date');
    if (dEl) dEl.value = '';
    renderChart();
  });

  // 指标
  document.getElementById('nav-ind-ma20')?.addEventListener('change', (e) => { state.showMA20 = e.target.checked; renderChart(); });
  document.getElementById('nav-ind-ma60')?.addEventListener('change', (e) => { state.showMA60 = e.target.checked; renderChart(); });
  document.getElementById('nav-ind-dd')?.addEventListener('change', (e) => { state.showDD = e.target.checked; renderChart(); });

  // 主题切换：监听 data-theme 变化重绘
  const observer = new MutationObserver(() => {
    if (state.chart) renderChart();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

export function pageInit() {
  setupEvents();
  renderChips();
  // 不自动加载，等用户添加基金
}
