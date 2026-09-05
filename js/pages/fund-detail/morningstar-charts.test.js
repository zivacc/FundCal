import { test } from 'node:test';
import assert from 'node:assert/strict';
import { morningstarChartOption } from './morningstar-charts.js';
const rows = [{as_of_date:'2024-06-30',explicit_fee_pct:1,implicit_fee_pct:0.5,total_fee_pct:1.5,explicit_fee_rank_pct:12,turnover_pct:0,turnover:{percentile:25}},
  {as_of_date:'2024-12-31',explicit_fee_pct:1,implicit_fee_pct:null,turnover:{percentile:null}}];
test('stacked fee bars use raw components, preserve missing gaps and aligned percentage axes', () => {
  const option = morningstarChartOption(rows, 'fee');
  assert.deepEqual(option.series[0].data, [1, null]);
  assert.deepEqual(option.series[1].data, [0.5, null]);
  assert.equal(option.series[0].stack, option.series[1].stack);
  assert.equal(option.series[0].type, 'bar');
  assert.equal(option.series[1].type, 'bar');
  assert.equal(option.series.filter(s => s.xAxisIndex === 0 && s.type === 'line').length, 0);
  assert.equal(option.series[2].stack, undefined);
  assert.equal(option.yAxis[1].max, 100);
  assert.deepEqual(option.xAxis[0].data, option.xAxis[1].data);
  assert.equal(option.grid[0].left, option.grid[1].left);
});
test('turnover merges dual axes: rate lines above a borderless percentile area, retaining zero', () => {
  const turnover = morningstarChartOption(rows, 'turnover');
  assert.deepEqual(turnover.series[0].data, [0, null]);
  assert.deepEqual(turnover.series[2].data, [25, null]);
  assert.equal(turnover.grid.length, 1);
  assert.equal(turnover.xAxis.length, 1);
  assert.equal(turnover.series[2].xAxisIndex, 0);
  assert.equal(turnover.series[2].yAxisIndex, 1);
  assert.equal(turnover.yAxis[1].position, 'right');
  assert.equal(turnover.yAxis[1].max, 100);
  assert.equal(turnover.series[2].lineStyle.width, 0);
  assert.equal(turnover.series[2].symbol, 'none');
  assert.ok(turnover.series[2].areaStyle.opacity > 0);
  assert.equal(turnover.series[0].areaStyle, undefined);
  assert.ok(turnover.series[0].z > turnover.series[2].z);
});
test('tooltip identifies historical category and sample count without HTML injection', () => {
  const option = morningstarChartOption([{...rows[0],morningstar_category:'<script>bad</script>',turnover:{percentile:25,sampleSize:2}}], 'turnover');
  const tip = option.tooltip.formatter([{dataIndex:0}]);
  assert.ok(tip.includes('2 个有效份额样本'));
  assert.ok(tip.includes('&lt;script&gt;'));
  assert.ok(!tip.includes('<script>'));
});
