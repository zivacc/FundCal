/**
 * 图表与卡片用色工具
 */

export const CHART_COLORS = [
  '#4e8ce6', '#34d399', '#fbbf24', '#f472b6',
  '#22d3ee', '#f4367c', '#c084fc', '#ffdeff', '#f87171'
];

/** 按索引分配颜色：前 N 个（N≤预设数量）互不重复，用尽后才循环复用 */
export function getColorForIndex(index) {
  return CHART_COLORS[index % CHART_COLORS.length];
}
