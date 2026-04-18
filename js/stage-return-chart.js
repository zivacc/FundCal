/**
 * 业绩比较图表（基于各基金的阶段收益数据）
 *
 * - X 轴：时间节点（成立来 / 近5年 / 近3年 / ... / 近1周 / 今天）按大致持有天数排序
 * - 「今年来」位置根据最新的数据更新时间（stageReturnsAsOf）动态决定
 * - Y 轴：以基准点为 0% 的累计涨跌幅（根据阶段收益反推 NAV 后归一化）
 * - 点击任意节点（含 今天 / 成立来）可切换所有基金的基准
 * - 默认基准 = 所有当前基金都有数据的最早节点（不含成立来 / 今天）
 */

import { getColorForIndex, escapeHtml } from './utils.js';

const TODAY_LABEL = '今天';

/** 已知节点的近似持有天数（越大越靠历史，排在 X 轴左侧） */
const PERIOD_DAYS_BASE = {
  '近5年': 1825,
  '近3年': 1095,
  '近2年': 730,
  '近1年': 365,
  '近6月': 180,
  '近3月': 90,
  '近1月': 30,
  '近1周': 7,
};
const KNOWN_PERIODS = Object.keys(PERIOD_DAYS_BASE).concat(['今年来', '成立来']);

/** 默认基准挑选时要跳过的节点（成立来各基金起点不同；今天本身 r=0 失去参考意义） */
const DEFAULT_BASELINE_SKIP = new Set(['成立来', TODAY_LABEL]);

let chartInstance = null;
let currentBaseline = null;
let lastPeriodsKey = '';

function getStageReturnNumber(item) {
  if (!item) return null;
  if (typeof item.returnPct === 'number' && Number.isFinite(item.returnPct)) return item.returnPct;
  const txt = String(item.returnText || '').trim();
  const m = txt.match(/(-?[\d.]+)\s*%/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

function buildReturnMap(stageReturns) {
  const map = {};
  if (!Array.isArray(stageReturns)) return map;
  stageReturns.forEach(item => {
    const p = String(item?.period || '').replace(/\s+/g, '').trim();
    if (!KNOWN_PERIODS.includes(p)) return;
    const n = getStageReturnNumber(item);
    if (n != null) map[p] = n;
  });
  return map;
}

/**
 * 计算「今年来」在 X 轴上对应的近似天数
 * 取 metas 中最新的 stageReturnsAsOf 作为参考日期，回推到当年 1 月 1 日。
 * 无有效日期时回退到当前日期。
 */
function computeYtdDays(metas) {
  let refDateStr = null;
  for (const m of metas || []) {
    const s = m?.stageReturnsAsOf;
    if (s && !refDateStr) refDateStr = s;
    if (s && refDateStr && s > refDateStr) refDateStr = s;
  }
  const refDate = refDateStr ? new Date(refDateStr) : new Date();
  if (isNaN(refDate.getTime())) return 75;
  const year = refDate.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const days = Math.round((refDate - jan1) / 86400000);
  return Math.max(1, Math.min(365, days));
}

/** 按大致持有天数降序排列（左侧最老，右侧最新） */
function orderedPeriods(ytdDays) {
  const entries = [
    ...Object.entries(PERIOD_DAYS_BASE),
    ['今年来', ytdDays],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return ['成立来', ...entries.map(e => e[0])];
}

function pickDefaultBaseline(orderedPresentPeriods, returnMaps) {
  for (const p of orderedPresentPeriods) {
    if (DEFAULT_BASELINE_SKIP.has(p)) continue;
    if (returnMaps.every(m => m[p] != null)) return p;
  }
  for (const p of orderedPresentPeriods) {
    if (DEFAULT_BASELINE_SKIP.has(p)) continue;
    if (returnMaps.some(m => m[p] != null)) return p;
  }
  return null;
}

function computeRelative(rp, rB) {
  if (rp == null || rB == null) return null;
  const denom = 1 + rp / 100;
  if (Math.abs(denom) < 1e-9) return null;
  return ((1 + rB / 100) / denom - 1) * 100;
}

/** 基准收益：今天视为 0；其它节点使用各基金在该节点的实际收益 */
function getBaselineReturn(rMap, baseline) {
  if (baseline === TODAY_LABEL) return 0;
  const v = rMap[baseline];
  return v == null ? null : v;
}

function buildDatasets(funds, returnMaps, labels, baseline) {
  return funds.map((fund, i) => {
    const name = fund.name || (fund.code ? `基金${fund.code}` : '未命名基金');
    const color = fund.color || getColorForIndex(i);
    const rMap = returnMaps[i] || {};
    const rB = getBaselineReturn(rMap, baseline);
    const data = labels.map(lbl => {
      if (lbl === TODAY_LABEL) {
        return rB != null ? rB : null;
      }
      const rp = rMap[lbl];
      if (rp == null || rB == null) return null;
      return computeRelative(rp, rB);
    });
    return {
      label: name,
      code: fund.code || '',
      data,
      borderColor: color,
      backgroundColor: color + '22',
      borderWidth: 2,
      tension: 0.25,
      pointRadius: 0,
      pointHoverRadius: 6,
      pointHoverBorderWidth: 2,
      pointHoverBackgroundColor: color,
      pointHoverBorderColor: '#f5f0eb',
      pointHitRadius: 16,
      spanGaps: true,
      fill: false,
    };
  });
}

function formatPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return sign + n.toFixed(2) + '%';
}

function updateBaselineHint(baseline, isDefault, defaultBaseline) {
  const el = document.getElementById('stage-return-baseline-hint');
  if (!el) return;
  if (!baseline) {
    el.textContent = '';
    return;
  }
  const tag = isDefault ? '（默认）' : (defaultBaseline ? `｜默认：${escapeHtml(defaultBaseline)}` : '');
  el.innerHTML = `当前基准：<b>${escapeHtml(baseline)}</b>${tag}`;
}

function destroyChart() {
  if (chartInstance) {
    try { chartInstance.destroy(); } catch { /* ignore */ }
    chartInstance = null;
  }
}

export function resetStageReturnChartState() {
  currentBaseline = null;
  lastPeriodsKey = '';
  destroyChart();
}

/**
 * 渲染业绩比较图表
 * @param {Array} funds - 与主图表相同的 funds 列表（包含 color / name / code）
 * @param {Array} metas - 与 funds 下标一一对应的 meta 数据（含 stageReturns / stageReturnsAsOf）
 */
export function renderStageReturnChart(funds, metas) {
  const container = document.getElementById('stage-return-chart-container');
  const canvas = document.getElementById('stage-return-canvas');
  if (!container || !canvas) return;

  const returnMaps = (funds || []).map((_, i) => buildReturnMap(metas?.[i]?.stageReturns));
  const hasAny = returnMaps.some(m => Object.keys(m).length > 0);

  if (!funds?.length || !hasAny) {
    container.hidden = true;
    destroyChart();
    return;
  }

  const ytdDays = computeYtdDays(metas);
  const fullOrder = orderedPeriods(ytdDays);

  // 仅保留当前基金实际拥有数据的节点
  const present = new Set();
  returnMaps.forEach(m => Object.keys(m).forEach(k => present.add(k)));
  const periods = fullOrder.filter(p => present.has(p));
  if (!periods.length) {
    container.hidden = true;
    destroyChart();
    return;
  }
  container.hidden = false;
  const labels = [...periods, TODAY_LABEL];

  const periodsKey = periods.join('|') + '::' + funds.map(f => f._id || f.code || f.name).join(',');
  if (periodsKey !== lastPeriodsKey) {
    currentBaseline = null;
    lastPeriodsKey = periodsKey;
  }
  const defaultBaseline = pickDefaultBaseline(periods, returnMaps);
  const allowable = new Set([...periods, TODAY_LABEL]);
  if (!currentBaseline || !allowable.has(currentBaseline)) {
    currentBaseline = defaultBaseline;
  }
  const isDefault = currentBaseline === defaultBaseline;
  updateBaselineHint(currentBaseline, isDefault, defaultBaseline);

  const datasets = buildDatasets(funds, returnMaps, labels, currentBaseline);

  destroyChart();

  const Chart = window.Chart;
  if (!Chart) return;

  const textPrimary = '#f5f0eb';
  const textSecondary = '#c7b8a8';
  const gridColor = 'rgba(185, 28, 28, 0.14)';
  const chartFont = { family: "'LXGW WenKai', 'Noto Serif SC', 'Songti SC', 'PingFang SC', 'Microsoft YaHei', serif" };

  const baselineIdx = labels.indexOf(currentBaseline);
  const defaultIdx = defaultBaseline ? labels.indexOf(defaultBaseline) : -1;

  const annotations = {};
  // 默认基准标记（仅在与当前基准不同时显示，用铜金色区分）
  if (defaultIdx >= 0 && defaultIdx !== baselineIdx) {
    annotations.defaultBaselineLine = {
      type: 'line',
      xMin: defaultIdx,
      xMax: defaultIdx,
      borderColor: 'rgba(184, 115, 51, 0.55)',
      borderWidth: 1,
      borderDash: [2, 3],
      label: {
        display: true,
        content: `默认 ${defaultBaseline}`,
        position: 'end',
        backgroundColor: 'rgba(184, 115, 51, 0.85)',
        color: '#fff',
        font: { ...chartFont, size: 11, weight: '600' },
        padding: { x: 6, y: 3 },
        yAdjust: 4,
      }
    };
  }
  if (baselineIdx >= 0) {
    annotations.baselineLine = {
      type: 'line',
      xMin: baselineIdx,
      xMax: baselineIdx,
      borderColor: 'rgba(220, 38, 38, 0.65)',
      borderWidth: 1.5,
      borderDash: [4, 4],
      label: {
        display: true,
        content: `基准 ${currentBaseline}`,
        position: 'start',
        backgroundColor: 'rgba(185, 28, 28, 0.9)',
        color: '#fff',
        font: { ...chartFont, size: 12, weight: '700' },
        padding: { x: 6, y: 3 },
        yAdjust: -4,
      }
    };
  }
  annotations.zeroLine = {
    type: 'line',
    yMin: 0,
    yMax: 0,
    borderColor: 'rgba(199, 184, 168, 0.35)',
    borderWidth: 1,
    borderDash: [2, 4],
  };

  chartInstance = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      layout: { padding: { left: 2, right: 12, top: 8, bottom: 4 } },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'category',
          grid: { color: gridColor, drawTicks: true },
          border: { color: 'rgba(185, 28, 28, 0.3)' },
          ticks: {
            color: (ctx) => {
              const label = ctx?.tick?.label;
              if (label === currentBaseline) return '#fff';
              if (label === defaultBaseline) return '#e8c79a';
              return textPrimary;
            },
            font: (ctx) => {
              const label = ctx?.tick?.label;
              const isBaseline = label === currentBaseline;
              const isDefaultMark = label === defaultBaseline && label !== currentBaseline;
              return {
                ...chartFont,
                size: isBaseline ? 15 : 14,
                weight: (isBaseline || isDefaultMark) ? '700' : '500'
              };
            },
            padding: 6,
            callback: function(value) {
              const label = this.getLabelForValue(value);
              if (label === defaultBaseline && label !== currentBaseline) {
                return '★ ' + label;
              }
              return label;
            }
          }
        },
        y: {
          grid: { color: gridColor },
          border: { color: 'rgba(185, 28, 28, 0.3)' },
          ticks: {
            color: textPrimary,
            font: { ...chartFont, size: 13 },
            callback: (v) => `${v}%`
          },
          title: {
            display: true,
            text: `相对基准「${currentBaseline || ''}」累计收益`,
            color: textSecondary,
            font: { ...chartFont, size: 12 }
          }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: textPrimary,
            font: { ...chartFont, size: 13, weight: '600' },
            padding: 14,
            boxWidth: 14,
            boxHeight: 14,
            usePointStyle: true,
          }
        },
        tooltip: {
          backgroundColor: 'rgba(20, 16, 14, 0.95)',
          borderColor: 'rgba(185, 28, 28, 0.55)',
          borderWidth: 1,
          titleColor: textPrimary,
          bodyColor: textPrimary,
          titleFont: { ...chartFont, size: 13, weight: '600' },
          bodyFont: { ...chartFont, size: 13 },
          padding: 10,
          callbacks: {
            title: (items) => {
              if (!items?.length) return '';
              const lbl = items[0].label;
              return lbl === currentBaseline ? `${lbl}（基准）` : lbl;
            },
            label: (ctx) => {
              const v = ctx.parsed.y;
              const fundLabel = ctx.dataset.label || '';
              return `${fundLabel}: ${formatPct(v)}`;
            }
          }
        },
        annotation: { annotations }
      },
      onClick: (evt, _els, chart) => {
        const xScale = chart.scales.x;
        if (!xScale) return;
        const x = typeof evt.x === 'number' ? evt.x : evt.native?.offsetX;
        if (x == null) return;
        const idx = xScale.getValueForPixel(x);
        if (idx == null) return;
        const rounded = Math.round(idx);
        if (rounded < 0 || rounded >= labels.length) return;
        const label = labels[rounded];
        if (!label || label === currentBaseline) return;
        currentBaseline = label;
        renderStageReturnChart(funds, metas);
      }
    }
  });

  const resetBtn = document.getElementById('stage-return-reset');
  if (resetBtn) {
    resetBtn.onclick = () => {
      if (!defaultBaseline || currentBaseline === defaultBaseline) return;
      currentBaseline = defaultBaseline;
      renderStageReturnChart(funds, metas);
    };
    resetBtn.disabled = !defaultBaseline || currentBaseline === defaultBaseline;
    resetBtn.style.opacity = resetBtn.disabled ? '0.5' : '';
  }
}
