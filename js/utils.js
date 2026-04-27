/**
 * 基金费率计算器 - 通用工具函数和常量
 */

/** 读取文档根节点的 CSS 自定义属性，随 data-theme 实时切换 */
export function cssVar(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v ? v.trim() : '';
}

/** 当前主题下 Chart.js 使用的通用颜色字典 */
export function getChartTheme() {
  return {
    textPrimary: cssVar('--text-primary'),
    textSecondary: cssVar('--text-secondary'),
    textTertiary: cssVar('--text-tertiary'),
    bgBase: cssVar('--bg-base'),
    bgElevated: cssVar('--bg-elevated'),
    grid: cssVar('--chart-grid'),
    rule: cssVar('--rule'),
    ruleStrong: cssVar('--rule-strong'),
    accent: cssVar('--accent'),
    accentHover: cssVar('--accent-hover'),
    warm: cssVar('--warm'),
    crossFill: cssVar('--chart-cross-fill'),
    crossStroke: cssVar('--chart-cross-stroke'),
  };
}

export const CHART_COLORS = [
  '#4e8ce6', '#34d399', '#fbbf24', '#f472b6',
  '#22d3ee', '#f4367c', '#c084fc', '#ffdeff', '#f87171'
];

/** 按索引分配颜色：前 N 个（N≤预设数量）互不重复，用尽后才循环复用 */
export function getColorForIndex(index) {
  return CHART_COLORS[index % CHART_COLORS.length];
}

/** 示例数据使用的基金代码（004400, 004401, 023910） */
export const DEMO_FUND_CODES = ['004400', '004401', '023910'];

/** 默认分段：7/30/365 + 永久（含义：(prev.to, to]，to=null 表 (prev.to,+∞)） */
export const DEFAULT_SEGMENTS = [
  { to: 7, rate: 0.015 },
  { to: 30, rate: 0 },
  { to: 365, rate: 0 },
  { to: null, rate: 0 }
];

/** 可选快捷分段天数：表格中不存在该天数时显示对应按钮 */
export const QUICK_SEGMENT_DAYS = [7, 30, 90, 180, 365, 730];

export function defaultSegments() {
  return DEFAULT_SEGMENTS.map(s => ({ ...s }));
}

/** 解析百分比输入为小数 */
export function parseRate(val) {
  if (val === '' || val == null) return 0;
  const n = parseFloat(String(val).replace('%', ''));
  return isNaN(n) ? 0 : n / 100;
}

/** 格式化为百分比显示 */
export function formatRate(rate) {
  return (rate * 100).toFixed(2) + '%';
}

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/** 打乱数组（Fisher–Yates） */
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 解析天数输入，空或无效返回 null */
export function parseDaysInput(val) {
  if (val == null || String(val).trim() === '') return null;
  const n = parseInt(String(val).trim(), 10);
  if (isNaN(n) || n < 0) return null;
  return n;
}

export function openModal(backdrop) {
  if (!backdrop) return;
  backdrop.classList.add('modal-visible');
  backdrop.setAttribute('aria-hidden', 'false');
}

export function closeModal(backdrop) {
  if (!backdrop) return;
  backdrop.classList.remove('modal-visible');
  backdrop.setAttribute('aria-hidden', 'true');
}
