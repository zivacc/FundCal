const palette = ['#c6813d', '#318c85', '#677fc0'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = v => v == null ? '—' : `${Number(v).toFixed(2)}%`;
export function morningstarChartOption(periods, kind, theme = {}) {
  const fee = kind === 'fee';
  const line = (name, key, color, rank = false, extra = {}) => ({
    name, type: 'line', data: periods.map(p => p[key] ?? null),
    xAxisIndex: rank && fee ? 1 : 0, yAxisIndex: rank ? 1 : 0,
    symbolSize: 6, connectNulls: false, smooth: false,
    itemStyle: { color }, lineStyle: { width: 2 }, ...extra,
  });
  const series = fee ? [
    line('显性费率', 'explicit_fee_pct', palette[0]),
    line('隐性费率', 'implicit_fee_pct', palette[1]),
    line('显性百分位', 'explicit_fee_rank_pct', palette[0], true),
    line('隐性百分位', 'implicit_fee_rank_pct', palette[1], true),
    line('综合百分位', 'total_fee_rank_pct', palette[2], true),
  ] : [
    line('换手率', 'turnover_pct', palette[1], false, { z: 3 }),
    line('同类中值', 'category_median_turnover_pct', palette[0], false, { z: 3, lineStyle: { width: 1.5, type: 'dashed' } }),
    { ...line('换手百分位', '', palette[2], true), data: periods.map(p => p.turnover?.percentile ?? null),
      z: 1, showSymbol: false, symbol: 'none', lineStyle: { width: 0, opacity: 0 },
      areaStyle: { opacity: 0.2 }, emphasis: { disabled: true, lineStyle: { width: 0, opacity: 0 } } },
  ];
  if (fee) for (let i = 0; i < 2; i++) {
    series[i].type = 'bar';
    series[i].stack = 'fees';
    series[i].barMaxWidth = 48;
    // Missing components are not treated as zero or silently interpolated.
    series[i].data = periods.map(p => p.explicit_fee_pct != null && p.implicit_fee_pct != null
      ? p[i ? 'implicit_fee_pct' : 'explicit_fee_pct'] : null);
  }
  return {
    animation: false,
    textStyle: { color: theme.text || '#777', fontFamily: 'sans-serif' },
    title: [
      { text: fee ? '费率（%）' : '换手率（%）', left: 8, top: 34, textStyle: { fontSize: 12, fontWeight: 'normal', color: theme.text || '#777' } },
      { text: fee ? '同类排名百分比 · 晨星原值' : '百分位（右轴）', ...(fee ? { left: 8, top: 278 } : { right: 8, top: 34 }), textStyle: { fontSize: 12, fontWeight: 'normal', color: theme.text || '#777' } },
    ],
    legend: { type: 'scroll', top: 0, data: series.map(s => s.name === '换手百分位' ? { name: s.name, icon: 'rect' } : s.name), textStyle: { color: theme.text || '#777' } },
    tooltip: { trigger: 'axis', confine: true, formatter: params => {
      const p = periods[params?.[0]?.dataIndex];
      if (!p) return '';
      const heading = `${esc(p.as_of_date)}<br>${esc(p.morningstar_category || '分类缺失')}`;
      return heading + (fee
        ? `<br>显性费率 ${pct(p.explicit_fee_pct)} · 百分位 ${pct(p.explicit_fee_rank_pct)}<br>隐性费率 ${pct(p.implicit_fee_pct)} · 百分位 ${pct(p.implicit_fee_rank_pct)}<br>综合费率 ${pct(p.total_fee_pct)} · 百分位 ${pct(p.total_fee_rank_pct)}<br>费率排名：晨星原值`
        : `<br>换手率 ${pct(p.turnover_pct)} · 同类中值 ${pct(p.category_median_turnover_pct)}<br>换手百分位 ${pct(p.turnover?.percentile)}<br>本地计算 · ${p.turnover?.sampleSize ?? 0} 个有效份额样本`);
    } },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: fee ? [{ left: 58, right: 22, top: 66, height: 180 }, { left: 58, right: 22, top: 310, height: 80 }]
      : [{ left: 58, right: 62, top: 66, bottom: 40 }],
    xAxis: (fee ? [0, 1] : [0]).map(i => ({ type: 'category', gridIndex: i, data: periods.map(p => p.as_of_date), boundaryGap: fee,
      axisLabel: { hideOverlap: true, formatter: v => v.slice(2, 7) }, axisTick: { show: false }, axisLine: { lineStyle: { color: theme.grid || '#ddd' } } })),
    yAxis: [0, 1].map(i => ({ type: 'value', gridIndex: fee ? i : 0, position: !fee && i ? 'right' : 'left', min: 0, ...(i ? { max: 100, interval: fee ? 50 : 25 } : { splitNumber: 4 }),
      axisLabel: { formatter: '{value}%' }, splitLine: { show: fee || !i, lineStyle: { color: theme.grid || '#eee' } } })),
    series,
  };
}
