import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBaseline } from './baseline.js';
import { transformByMode } from '../../domain/nav-chart-transform.js';

test('manual baseline falls back to the first visible day on either side and restores', () => {
  const saved = { baseline: '2021-04-30', commonStart: '2020-01-02' };
  const resolve = (viewStart, viewEnd) => resolveBaseline({ ...saved, viewStart, viewEnd });
  assert.equal(resolve('2019-01-02', '2022-01-04'), saved.baseline);
  assert.equal(resolve('2019-01-02', '2020-06-01'), '2019-01-02');
  assert.equal(resolve('2022-01-04', '2022-06-01'), '2022-01-04');
  assert.equal(resolve('2019-01-02', '2022-01-04'), saved.baseline);
});

test('automatic common start outside the viewport temporarily uses its first day', () => {
  const resolve = (viewStart, viewEnd) => resolveBaseline({
    baseline: null, commonStart: '2021-04-30', viewStart, viewEnd,
  });
  assert.equal(resolve('2019-01-02', '2022-01-04'), '2021-04-30');
  assert.equal(resolve('2019-01-02', '2020-06-01'), '2019-01-02');
  assert.equal(resolve('2022-01-04', '2022-06-01'), '2022-01-04');
  assert.equal(resolve('2019-01-02', '2022-01-04'), '2021-04-30');
});

test('viewport boundaries include the original baseline; reset resumes automatic selection', () => {
  const input = { baseline: '2021-04-30', commonStart: '2020-01-02' };
  assert.equal(resolveBaseline({ ...input, viewStart: '2021-04-30', viewEnd: '2022-01-04' }), input.baseline);
  assert.equal(resolveBaseline({ ...input, viewStart: '2019-01-02', viewEnd: '2021-04-30' }), input.baseline);
  assert.equal(resolveBaseline({ ...input, baseline: null, viewStart: '2019-01-02', viewEnd: '2022-01-04' }), input.commonStart);
  assert.equal(resolveBaseline({ viewStart: '2020-01-02', viewEnd: '2022-01-04' }), '2020-01-02');
  assert.equal(resolveBaseline({}), null);
});

test('temporary baseline rebases returns and returning to the original date restores returns', () => {
  const dates = ['20190102', '20200102', '20210430'];
  const navs = [1, 2, 4];
  const saved = { baseline: '2021-04-30', commonStart: '2020-01-02', viewStart: '2019-01-02' };
  const returns = viewEnd => transformByMode(dates, navs, 'pct', resolveBaseline({ ...saved, viewEnd }));
  assert.deepEqual(returns('2021-04-30'), [0.25, 0.5, 1]);
  assert.deepEqual(returns('2020-01-02'), [1, 2, 4]);
  assert.deepEqual(returns('2021-04-30'), [0.25, 0.5, 1]);
});
