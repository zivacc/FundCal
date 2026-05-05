/**
 * computeRangeStats 单元测试。
 *
 * 覆盖：
 *   - 起末 null 自动跳过、找到区间内首末非空索引
 *   - 涨跌幅 / 涨跌 / 年化（CAGR）/ 振幅
 *   - 最大回撤 / 最大上涨：用峰谷追踪
 *   - 边界：区间内 0 / 1 个非空点 → null；区间反向 → null
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRangeStats } from './nav-range-stats.js';

const dates = [
  '20240101', '20240102', '20240103', '20240104', '20240105',
  '20240108', '20240109', '20240110',
];

test('computeRangeStats: 区间内全 null → 返回 null', () => {
  const navs = [null, null, null, null, null, null, null, null];
  assert.equal(computeRangeStats(dates, navs, 0, 7), null);
});

test('computeRangeStats: 区间内仅 1 个非空 → 返回 null', () => {
  const navs = [null, 1.0, null, null, null, null, null, null];
  assert.equal(computeRangeStats(dates, navs, 0, 3), null);
});

test('computeRangeStats: 涨跌幅 / 涨跌 / 振幅 基础口径', () => {
  // 1.0 → 2.0：涨幅 100%；中间最低 0.5 → 振幅 (2-0.5)/0.5 = 300%
  const navs = [1.0, 0.5, 1.5, 2.0, null, null, null, null];
  const r = computeRangeStats(dates, navs, 0, 3);
  assert.ok(r);
  assert.equal(r.startNav, 1.0);
  assert.equal(r.endNav, 2.0);
  assert.equal(r.change, 1.0);
  assert.ok(Math.abs(r.changePct - 100) < 1e-9);
  assert.equal(r.maxNav, 2.0);
  assert.equal(r.minNav, 0.5);
  assert.ok(Math.abs(r.swing - 300) < 1e-9);
});

test('computeRangeStats: 起首 null 跳过，定位到首个非空点', () => {
  const navs = [null, null, 1.0, 1.2, 0.9, null, null, null];
  const r = computeRangeStats(dates, navs, 0, 4);
  assert.ok(r);
  assert.equal(r.firstIdx, 2);
  assert.equal(r.lastIdx, 4);
  assert.equal(r.startNav, 1.0);
  assert.equal(r.endNav, 0.9);
});

test('computeRangeStats: 最大回撤 = 区间内峰后跌幅', () => {
  // 1.0 → 1.5 (peak) → 1.2 → 1.8 (peak) → 0.9
  // 1.5 后跌到 1.2 → -20%
  // 1.8 后跌到 0.9 → -50%
  const navs = [1.0, 1.5, 1.2, 1.8, 0.9, null, null, null];
  const r = computeRangeStats(dates, navs, 0, 4);
  assert.ok(r);
  assert.ok(Math.abs(r.maxDrawdown - (-50)) < 1e-9);
});

test('computeRangeStats: 最大上涨 = 区间内谷后涨幅', () => {
  // 2.0 → 1.0 (trough) → 1.5 → 0.5 (new trough) → 1.5
  // 1.0 后涨到 1.5 → +50%
  // 0.5 后涨到 1.5 → +200%
  const navs = [2.0, 1.0, 1.5, 0.5, 1.5, null, null, null];
  const r = computeRangeStats(dates, navs, 0, 4);
  assert.ok(r);
  assert.ok(Math.abs(r.maxRise - 200) < 1e-9);
});

test('computeRangeStats: 年化 = 365 天总收益的"换算"', () => {
  // 365 天 1.0 → 1.1：cagr 应 ≈ 10%
  const ds = ['20230101', '20240101'];
  const ns = [1.0, 1.1];
  const r = computeRangeStats(ds, ns, 0, 1);
  assert.ok(r);
  assert.equal(r.days, 365);
  assert.ok(Math.abs(r.cagr - 10) < 1e-9);
});

test('computeRangeStats: 反向区间 / 越界 → null', () => {
  const navs = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7];
  assert.equal(computeRangeStats(dates, navs, 5, 2), null);
  assert.equal(computeRangeStats(dates, navs, -1, 3), null);
  assert.equal(computeRangeStats(dates, navs, 0, 99), null);
});

test('computeRangeStats: 均价等于区间内非空均值', () => {
  const navs = [1.0, null, 2.0, null, 3.0, null, null, null];
  const r = computeRangeStats(dates, navs, 0, 4);
  assert.ok(r);
  assert.ok(Math.abs(r.meanNav - 2.0) < 1e-9);
});
