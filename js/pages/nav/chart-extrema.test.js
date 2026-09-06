import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExtremaUpdates, extremaWindow } from './chart-extrema.js';
const line = (id, data, axis = 0) => ({ id, data, yAxisIndex: axis, markPoint: { label: { color: id }, data: [] } });
const points = updates => updates.flatMap(update => update.markPoint.data.map(point => ({ id: update.id, ...point })));
test('one global pair on main chart and one largest drawdown across funds', () => {
  const result = buildExtremaUpdates([line('a', [1, 9, 3]), line('b', [2, 5, -2]), line('dd-a', [0, -10, -2], 1), line('dd-b', [0, -3, -20], 1), { id: 'ma', data: [999, 999, 999] }], 0, 2);
  assert.deepEqual(points(result).map(p => [p.id, p.name, p.coord]), [['a', '最高', [1, 9]], ['b', '最低', [2, -2]], ['dd-b', '最大回撤', [2, -20]]]);
  assert.deepEqual(result.find(x => x.id === 'dd-a').markPoint.data, []);
});
test('selection excludes larger outside values and clears prior winners', () => {
  const series = [line('a', [100, 2, 1, 99]), line('b', [-100, 3, 4, -99])];
  const result = buildExtremaUpdates(series, 1, 2, 0, 3);
  assert.deepEqual(points(result).map(p => [p.id, p.name, p.value]), [['a', '最低', 1], ['b', '最高', 4]]);
  assert.deepEqual(buildExtremaUpdates(series, 3, 2).map(x => x.markPoint.data), [[], []]);
  assert.deepEqual(series[0].markPoint.data, [], 'source is not mutated');
});
test('ties are deterministic and invalid points never become extrema', () => {
  const result = buildExtremaUpdates([line('a', [null, 7, 7, Infinity]), line('b', [7, 7, NaN])], 0, 3);
  assert.deepEqual(points(result).map(p => [p.id, p.coord]), [['b', [0, 7]]]);
  assert.deepEqual(points(buildExtremaUpdates([line('a', [null, undefined, NaN])], 0, 2)), []);
});
test('selected interval before baseline is valid and is intersected with viewport', () => {
  assert.deepEqual(extremaWindow(10, 90, 60, 20, 40), { start: 20, end: 40 });
  assert.deepEqual(extremaWindow(10, 90, 60, null, null), { start: 60, end: 90 });
  assert.deepEqual(extremaWindow(30, 90, 60, 20, 40), { start: 30, end: 40 });
  assert.deepEqual(extremaWindow(50, 90, 60, 20, 40), { start: 50, end: 40 });
});
