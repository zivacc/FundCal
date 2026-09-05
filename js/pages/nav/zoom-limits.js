export const MIN_ZOOM_DATA_POINTS = 100;

/**
 * ECharts category dataZoom 的 value span 是首尾索引之差。
 * 因此显示 N 个数据点需要至少 N - 1 的 minValueSpan。
 */
export function getMinZoomValueSpan(dataPointCount, minimumPointCount = MIN_ZOOM_DATA_POINTS) {
  const total = Math.max(0, Math.floor(Number(dataPointCount) || 0));
  if (total < 2) return 0;

  const minimum = Math.max(1, Math.floor(Number(minimumPointCount) || 1));
  return Math.min(total, minimum) - 1;
}

export function clampZoomIndices(start, end, count) {
  if (!count) return { start: 0, end: 0 };
  let s = Math.max(0, Math.min(count - 1, Math.round(start)));
  let e = Math.max(s, Math.min(count - 1, Math.round(end)));
  const span = getMinZoomValueSpan(count);
  if (e - s < span) {
    s = Math.max(0, e - span);
    e = Math.min(count - 1, s + span);
  }
  return { start: s, end: e };
}
