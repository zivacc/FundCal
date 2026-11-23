import { seriesColors } from '../core/chart-palette.js';

/** 按索引分配颜色：前 N 个（N≤预设数量）互不重复，用尽后才循环复用 */
export function getColorForIndex(index) {
  const colors = seriesColors(globalThis.document?.documentElement.dataset.theme === 'dark');
  return colors[index % colors.length];
}
