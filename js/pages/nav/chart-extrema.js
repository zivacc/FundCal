/** 选区优先于基准日；与可见窗口无交集时返回空范围。 */
export function extremaWindow(viewStart, viewEnd, baselineStart, selectionStart, selectionEnd) {
  const selected = Number.isFinite(selectionStart) && Number.isFinite(selectionEnd);
  return selected
    ? { start: Math.max(viewStart, selectionStart), end: Math.min(viewEnd, selectionEnd) }
    : { start: Math.max(viewStart, baselineStart), end: viewEnd };
}

/** 从已变换的曲线中选每个坐标轴的一组极值，均线/派生线不参与。
 * 主图最高/最低各一个，回撤副图只保留全体曲线中最大的回撤。
 * 为所有候选曲线显式返回空 data，防止 ECharts 合并时保留旧标记。
 */
export function buildExtremaUpdates(series, start, end, viewStart = start, viewEnd = end) {
  const groups = new Map();
  const updates = series.map(item => item.markPoint ? { id: item.id, markPoint: { ...item.markPoint, data: [] } } : null);
  for (let i = 0; i < series.length; i++) {
    const item = series[i];
    if (!item.markPoint) continue;
    const axis = item.yAxisIndex || 0;
    if (!groups.has(axis)) groups.set(axis, { min: null, max: null });
    const group = groups.get(axis);
    for (let k = Math.max(0, start); k <= Math.min(end, item.data.length - 1); k++) {
      const value = item.data[k];
      if (!Number.isFinite(value)) continue;
      const candidate = { seriesIndex: i, index: k, value };
      // 相同数值优先较早日期，再按曲线顺序，避免拖动时标签跳动。
      if (!group.min || value < group.min.value || value === group.min.value && k < group.min.index) group.min = candidate;
      if (!group.max || value > group.max.value || value === group.max.value && k < group.max.index) group.max = candidate;
    }
  }
  const add = (point, name, position) => {
    if (!point) return;
    const near = (viewEnd - viewStart) * 0.04;
    updates[point.seriesIndex].markPoint.data.push({
      name, coord: [point.index, point.value], value: point.value,
      label: { position: point.index > viewEnd - near ? 'left' : point.index < viewStart + near ? 'right' : position },
    });
  };
  for (const [axis, group] of groups) {
    if (axis === 0) {
      add(group.max, '最高', 'top');
      if (group.min && (group.min.seriesIndex !== group.max.seriesIndex || group.min.index !== group.max.index)) add(group.min, '最低', 'bottom');
    } else add(group.min, '最大回撤', 'top');
  }
  return updates.filter(Boolean);
}
