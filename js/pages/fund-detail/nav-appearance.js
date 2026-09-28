import { seriesColors } from '../../core/chart-palette.js';

// 只更新外观，不触碰数据、缩放窗口或用户选择的时间区间。
export function navAppearance(theme, dark) {
  return {
    color: seriesColors(dark).slice(0, 2),
    textStyle: { color: theme.textSecondary },
    tooltip: { backgroundColor: theme.bgElevated, borderColor: theme.ruleStrong,
      textStyle: { color: theme.textPrimary }, confine: true },
    legend: { textStyle: { color: theme.textSecondary } },
    xAxis: { axisLabel: { color: theme.textSecondary, hideOverlap: true }, axisLine: { lineStyle: { color: theme.rule } } },
    yAxis: { axisLabel: { color: theme.textSecondary }, splitLine: { lineStyle: { color: theme.grid } } },
  };
}
