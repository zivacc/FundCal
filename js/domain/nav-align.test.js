/**
 * Unit tests for js/domain/nav-align.js
 *
 * 跑：npm test
 *
 * 重点覆盖：
 *   - unionDates: 排序、去重、忽略坏输入
 *   - alignSeriesToDates: 精确命中 / 中段缺失前向填充 / 头部仍 null /
 *     尾部填充 / 输入未排序 / null 序列
 *   - alignAllSeries: 跳过无 code 的项
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  unionDates,
  alignSeriesToDates,
  alignAllSeries,
} from './nav-align.js';

/* ============== unionDates ============== */

test('unionDates: empty input → []', () => {
  assert.deepEqual(unionDates([]), []);
});

test('unionDates: single series passes through (sorted)', () => {
  const s = [{ code: 'A', dates: ['20240103', '20240101', '20240102'], adjNavs: [1, 1, 1] }];
  assert.deepEqual(unionDates(s), ['20240101', '20240102', '20240103']);
});

test('unionDates: union dedupes across series', () => {
  const s = [
    { code: 'A', dates: ['20240101', '20240102'], adjNavs: [1, 1] },
    { code: 'B', dates: ['20240102', '20240103'], adjNavs: [1, 1] },
  ];
  assert.deepEqual(unionDates(s), ['20240101', '20240102', '20240103']);
});

test('unionDates: ignores null / dateless series', () => {
  const s = [
    null,
    { code: 'X' /* no dates */ },
    { code: 'Y', dates: ['20240101'], adjNavs: [1] },
  ];
  assert.deepEqual(unionDates(s), ['20240101']);
});

/* ============== alignSeriesToDates ============== */

test('alignSeriesToDates: exact match returns identical values', () => {
  const dates = ['20240101', '20240102', '20240103'];
  const s = { code: 'A', dates: [...dates], adjNavs: [1.0, 1.1, 1.2] };
  assert.deepEqual(alignSeriesToDates(dates, s), [1.0, 1.1, 1.2]);
});

test('alignSeriesToDates: leading missing days remain null', () => {
  const allDates = ['20240101', '20240102', '20240103'];
  const s = { code: 'A', dates: ['20240102', '20240103'], adjNavs: [1.1, 1.2] };
  assert.deepEqual(alignSeriesToDates(allDates, s), [null, 1.1, 1.2]);
});

test('alignSeriesToDates: middle gap forward-fills from previous', () => {
  const allDates = ['20240101', '20240102', '20240103', '20240104'];
  const s = { code: 'A', dates: ['20240101', '20240104'], adjNavs: [1.0, 1.4] };
  assert.deepEqual(alignSeriesToDates(allDates, s), [1.0, 1.0, 1.0, 1.4]);
});

test('alignSeriesToDates: trailing missing forward-fills', () => {
  const allDates = ['20240101', '20240102', '20240103'];
  const s = { code: 'A', dates: ['20240101'], adjNavs: [1.0] };
  assert.deepEqual(alignSeriesToDates(allDates, s), [1.0, 1.0, 1.0]);
});

test('alignSeriesToDates: out-of-order source still resolves via Map', () => {
  const allDates = ['20240101', '20240102', '20240103'];
  const s = { code: 'A', dates: ['20240103', '20240101', '20240102'], adjNavs: [1.3, 1.1, 1.2] };
  assert.deepEqual(alignSeriesToDates(allDates, s), [1.1, 1.2, 1.3]);
});

test('alignSeriesToDates: explicit null in source falls back to forward-fill', () => {
  const allDates = ['20240101', '20240102', '20240103'];
  const s = { code: 'A', dates: ['20240101', '20240102', '20240103'], adjNavs: [1.0, null, 1.2] };
  // 中间 null 不被视为可用值；触发 forward-fill = 1.0
  assert.deepEqual(alignSeriesToDates(allDates, s), [1.0, 1.0, 1.2]);
});

test('alignSeriesToDates: null / malformed series → array of nulls', () => {
  const allDates = ['20240101', '20240102'];
  assert.deepEqual(alignSeriesToDates(allDates, null), [null, null]);
  assert.deepEqual(alignSeriesToDates(allDates, { code: 'X' }), [null, null]);
  assert.deepEqual(alignSeriesToDates(allDates, { code: 'X', dates: ['20240101'] }), [null, null]);
});

test('alignSeriesToDates: empty allDates → []', () => {
  const s = { code: 'A', dates: ['20240101'], adjNavs: [1.0] };
  assert.deepEqual(alignSeriesToDates([], s), []);
});

/* ============== alignAllSeries ============== */

test('alignAllSeries: returns union axis + Map keyed by code', () => {
  const series = [
    { code: 'A', dates: ['20240101', '20240103'], adjNavs: [1.0, 1.2] },
    { code: 'B', dates: ['20240102', '20240103'], adjNavs: [2.0, 2.1] },
  ];
  const { allDates, alignedByCode } = alignAllSeries(series);
  assert.deepEqual(allDates, ['20240101', '20240102', '20240103']);
  assert.deepEqual(alignedByCode.get('A'), [1.0, 1.0, 1.2]);
  // B 头部仍 null
  assert.deepEqual(alignedByCode.get('B'), [null, 2.0, 2.1]);
});

test('alignAllSeries: skips entries without code', () => {
  const series = [
    { dates: ['20240101'], adjNavs: [1] },           // no code
    { code: 'A', dates: ['20240101'], adjNavs: [1] },
  ];
  const { alignedByCode } = alignAllSeries(series);
  assert.equal(alignedByCode.size, 1);
  assert.ok(alignedByCode.has('A'));
});

test('alignAllSeries: empty input → empty axis + empty Map', () => {
  const { allDates, alignedByCode } = alignAllSeries([]);
  assert.deepEqual(allDates, []);
  assert.equal(alignedByCode.size, 0);
});
