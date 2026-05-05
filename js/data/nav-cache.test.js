/**
 * Tests for js/data/nav-cache.js pure helpers.
 *
 * 覆盖：mergePoints / computeMissingRanges / subsetByRange /
 *       rangeOfPoints / shiftYYYYMMDD
 *
 * IDB 部分（getCachedSeries 等）依赖浏览器 IndexedDB，单测里不验证。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergePoints,
  computeMissingRanges,
  subsetByRange,
  rangeOfPoints,
  shiftYYYYMMDD,
} from './nav-cache.js';

/* ============== shiftYYYYMMDD ============== */

test('shiftYYYYMMDD: +1 day across month boundary', () => {
  assert.equal(shiftYYYYMMDD('20240131', 1), '20240201');
});

test('shiftYYYYMMDD: -1 day across month boundary', () => {
  assert.equal(shiftYYYYMMDD('20240301', -1), '20240229'); // 2024 是闰年
});

test('shiftYYYYMMDD: -1 day across year boundary', () => {
  assert.equal(shiftYYYYMMDD('20240101', -1), '20231231');
});

test('shiftYYYYMMDD: invalid input returned unchanged', () => {
  assert.equal(shiftYYYYMMDD('', 1), '');
  assert.equal(shiftYYYYMMDD('xxx', 1), 'xxx');
});

/* ============== mergePoints ============== */

test('mergePoints: empty + new = new (sorted)', () => {
  const incoming = [
    { date: '20240103', unit: 1.3 },
    { date: '20240101', unit: 1.0 },
    { date: '20240102', unit: 1.1 },
  ];
  const out = mergePoints([], incoming);
  assert.deepEqual(out.map(p => p.date), ['20240101', '20240102', '20240103']);
});

test('mergePoints: new overrides existing on same date', () => {
  const existing = [
    { date: '20240101', unit: 1.0 },
    { date: '20240102', unit: 1.1 },
  ];
  const incoming = [
    { date: '20240102', unit: 9.9 }, // 同日，新值
    { date: '20240103', unit: 1.3 },
  ];
  const out = mergePoints(existing, incoming);
  assert.equal(out.length, 3);
  assert.equal(out.find(p => p.date === '20240102').unit, 9.9, '同日应用新值');
  assert.equal(out.find(p => p.date === '20240101').unit, 1.0);
});

test('mergePoints: skips entries without date', () => {
  const out = mergePoints([{ date: '' }, { date: null }, { unit: 1 }], [{ date: '20240101', unit: 1 }]);
  assert.deepEqual(out, [{ date: '20240101', unit: 1 }]);
});

test('mergePoints: handles null inputs defensively', () => {
  assert.deepEqual(mergePoints(null, null), []);
  assert.deepEqual(mergePoints(null, [{ date: '20240101' }]), [{ date: '20240101' }]);
});

/* ============== computeMissingRanges ============== */

test('computeMissingRanges: empty cache → entire request is gap', () => {
  const gaps = computeMissingRanges(null, { start: '20240101', end: '20241231' });
  assert.deepEqual(gaps, [{ start: '20240101', end: '20241231' }]);
});

test('computeMissingRanges: cache fully covers request → no gaps', () => {
  const gaps = computeMissingRanges(
    { start: '20230101', end: '20241231' },
    { start: '20240101', end: '20240601' }
  );
  assert.deepEqual(gaps, []);
});

test('computeMissingRanges: request extends right of cache', () => {
  // cache [2020-01, 2023-01], request [2020-06, 2024-12]
  // → gap: [2023-02, 2024-12]
  const gaps = computeMissingRanges(
    { start: '20200101', end: '20230101' },
    { start: '20200601', end: '20241231' }
  );
  assert.deepEqual(gaps, [{ start: '20230102', end: '20241231' }]);
});

test('computeMissingRanges: request extends left of cache', () => {
  // cache [2022-01, 2024-01], request [2020-01, 2023-01]
  // → gap: [2020-01, 2021-12-31]
  const gaps = computeMissingRanges(
    { start: '20220101', end: '20240101' },
    { start: '20200101', end: '20230101' }
  );
  assert.deepEqual(gaps, [{ start: '20200101', end: '20211231' }]);
});

test('computeMissingRanges: request extends both sides', () => {
  // cache [2022-01-01, 2023-12-31], request [2020-01-01, 2024-12-31]
  // → gaps: [2020-01-01, 2021-12-31] AND [2024-01-01, 2024-12-31]
  const gaps = computeMissingRanges(
    { start: '20220101', end: '20231231' },
    { start: '20200101', end: '20241231' }
  );
  assert.deepEqual(gaps, [
    { start: '20200101', end: '20211231' },
    { start: '20240101', end: '20241231' },
  ]);
});

test('computeMissingRanges: cache and request disjoint', () => {
  // cache [2020-01, 2020-12], request [2024-01, 2024-12] → entire request is gap
  const gaps = computeMissingRanges(
    { start: '20200101', end: '20201231' },
    { start: '20240101', end: '20241231' }
  );
  assert.deepEqual(gaps, [{ start: '20240101', end: '20241231' }]);
});

test('computeMissingRanges: cache exactly equals request → no gaps', () => {
  const gaps = computeMissingRanges(
    { start: '20240101', end: '20241231' },
    { start: '20240101', end: '20241231' }
  );
  assert.deepEqual(gaps, []);
});

/* ============== subsetByRange ============== */

test('subsetByRange: returns inclusive subset', () => {
  const points = [
    { date: '20240101' }, { date: '20240115' }, { date: '20240201' },
    { date: '20240215' }, { date: '20240301' },
  ];
  const out = subsetByRange(points, '20240115', '20240215');
  assert.deepEqual(out.map(p => p.date), ['20240115', '20240201', '20240215']);
});

test('subsetByRange: empty input → empty', () => {
  assert.deepEqual(subsetByRange([], '20240101', '20241231'), []);
  assert.deepEqual(subsetByRange(null, '20240101', '20241231'), []);
});

test('subsetByRange: range entirely before / after data → empty', () => {
  const points = [{ date: '20240601' }];
  assert.deepEqual(subsetByRange(points, '20240101', '20240131'), []);
  assert.deepEqual(subsetByRange(points, '20241101', '20241231'), []);
});

/* ============== rangeOfPoints ============== */

test('rangeOfPoints: returns min/max dates', () => {
  const points = [
    { date: '20240101' }, { date: '20240331' }, { date: '20240115' },
  ];
  assert.deepEqual(rangeOfPoints(points), { start: '20240101', end: '20240331' });
});

test('rangeOfPoints: empty / null returns null', () => {
  assert.equal(rangeOfPoints([]), null);
  assert.equal(rangeOfPoints(null), null);
});
