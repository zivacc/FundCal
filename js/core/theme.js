/**
 * 主题相关工具：CSS 变量读取 + Chart.js 配色
 *
 * 注意：data-theme 属性的读写与切换按钮逻辑在 ./theme-toggle.js（全局 IIFE）
 * 中处理；此文件仅暴露主题色读取的 ESM 接口供模块化页面使用。
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
