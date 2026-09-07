/** Convert viewport coordinates (including CSS zoom/transforms) to Chart.js pixels. */
export function chartPointer(clientX, clientY, rect, width, height) {
  return { x: (clientX - rect.left) * width / rect.width, y: (clientY - rect.top) * height / rect.height };
}

/** Fit labels within the plot; omit crowded labels rather than rotating into other rows. */
export function fitBoundaryLabels(labels, width, gap = 8) {
  let end = -gap;
  return labels.map(({ x, size }) => {
    const left = Math.max(0, Math.min(width - size, x - size / 2));
    if (size > width || left < end + gap) return null;
    end = left + size;
    return left;
  });
}

/** Place one scrollable information window away from the initial pointer. */
export function chartInfoCorner(x, y, width, height) {
  const maxHeight = Math.floor(height * .45);
  return { left: x > width / 2 ? 8 : null, top: y > height / 2 ? 8 : height - maxHeight - 8, maxHeight };
}

export function hideChartOverlays() {
  document.getElementById('chart-crosshair-overlay')?.classList.remove('visible');
  const info = document.getElementById('chart-crosshair-info');
  if (info) delete info.dataset.placement;
}

/** Read the actual plot after each layout, including sidebar and container resizing. */
export function alignOptimalBand(chart) {
  const band = document.getElementById('optimal-band');
  const area = chart.chartArea;
  if (!band || !area || !chart.width) return;
  band.style.marginLeft = `${area.left}px`;
  band.style.marginRight = `${Math.max(0, chart.width - area.right)}px`;
  const labels = [...band.querySelectorAll('.optimal-band-boundary-label')];
  const positions = fitBoundaryLabels(labels.map(el => ({
    x: chart.scales.x.getPixelForValue(Number(el.dataset.day)) - area.left,
    size: el.offsetWidth,
  })), area.width);
  labels.forEach((el, i) => {
    el.style.visibility = positions[i] === null ? 'hidden' : '';
    el.style.left = `${positions[i] ?? 0}px`;
  });
}

export const calcChartLayoutPlugin = {
  id: 'calc-chart-layout',
  beforeLayout(chart) {
    const compact = chart.width < 480;
    for (const axis of ['x', 'y']) {
      chart.options.scales[axis].ticks.font.size = compact ? 11 : 13;
      chart.options.scales[axis].title.font.size = compact ? 12 : 14;
    }
    chart.options.scales.x.ticks.maxTicksLimit = Math.max(4, Math.floor(chart.width / 85));
    chart.options.scales.x.ticks.maxRotation = 0;
    chart.options.scales.x.ticks.autoSkip = false;
    chart.options.scales.x.ticks.precision = 0;
    chart.options.scales.y.ticks.maxTicksLimit = Math.max(3, Math.floor(chart.height / 48));
    hideChartOverlays();
  },
  afterLayout: alignOptimalBand,
};
