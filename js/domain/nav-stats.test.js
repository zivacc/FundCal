/**
 * Unit tests for js/domain/nav-stats.js
 *
 * 跑：npm test  (或 node --test js/domain/nav-stats.test.js)
 *
 * 测试分组：
 *   - P1.A: downsample weekly / vol 年化 / computeUnionRange
 *   - P1.D: parseIndicators / enrichSeriesIndicators / INDICATORS 注册表
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  downsample,
  computeStats,
  computeUnionRange,
  periodsPerYear,
  parseYYYYMMDD,
  INDICATORS,
  parseIndicators,
  enrichSeriesIndicators,
} from './nav-stats.js';

/* ============== downsample weekly ============== */

test('downsample weekly keeps last-of-week, not first', () => {
  // 2024-01-01 是周一；构造一周连续 5 天 + 下周连续 5 天
  // 旧实现的 bug：会保留 1/1（周首）而非 1/5（周末）。
  const rows = [
    { end_date: '20240101', unit_nav: 1.000, adj_nav: 1.000 }, // Mon
    { end_date: '20240102', unit_nav: 1.001, adj_nav: 1.001 }, // Tue
    { end_date: '20240103', unit_nav: 1.002, adj_nav: 1.002 }, // Wed
    { end_date: '20240104', unit_nav: 1.003, adj_nav: 1.003 }, // Thu
    { end_date: '20240105', unit_nav: 1.005, adj_nav: 1.005 }, // Fri
    { end_date: '20240108', unit_nav: 1.010, adj_nav: 1.010 }, // 下周 Mon
    { end_date: '20240109', unit_nav: 1.012, adj_nav: 1.012 },
    { end_date: '20240110', unit_nav: 1.015, adj_nav: 1.015 }, // 下周 Wed (假设这里数据到 1/10)
  ];

  // 强制触发降采样：>=800 的阈值。先填充虚拟数据让长度达到 800 再附加测试数据。
  const padding = [];
  for (let i = 0; i < 800; i++) {
    padding.push({ end_date: '20200101', unit_nav: 1, adj_nav: 1 }); // 同日多次也 OK，作为占位
  }
  const sampled = downsample([...padding, ...rows], 'weekly');

  // 最后两条应是 1/5 和 1/10（每周最后一行）
  const last2 = sampled.slice(-2);
  assert.equal(last2[0].end_date, '20240105', '第一周应保留周五 (周末日)');
  assert.equal(last2[1].end_date, '20240110', '第二周应保留最后一行（1/10）');
});

test('downsample monthly keeps last-of-month', () => {
  const padding = [];
  for (let i = 0; i < 800; i++) padding.push({ end_date: '20200101', unit_nav: 1, adj_nav: 1 });

  const tail = [
    { end_date: '20240101', unit_nav: 1.0, adj_nav: 1.0 },
    { end_date: '20240115', unit_nav: 1.1, adj_nav: 1.1 },
    { end_date: '20240131', unit_nav: 1.2, adj_nav: 1.2 }, // 1月最后
    { end_date: '20240201', unit_nav: 1.3, adj_nav: 1.3 },
    { end_date: '20240228', unit_nav: 1.4, adj_nav: 1.4 }, // 2月最后
  ];
  const sampled = downsample([...padding, ...tail], 'monthly');
  const last2 = sampled.slice(-2);
  assert.equal(last2[0].end_date, '20240131', '1月应保留 1/31');
  assert.equal(last2[1].end_date, '20240228', '2月应保留 2/28');
});

test('downsample daily returns input unchanged', () => {
  const rows = [
    { end_date: '20240101', unit_nav: 1.0 },
    { end_date: '20240102', unit_nav: 1.1 },
  ];
  const out = downsample(rows, 'daily');
  assert.deepEqual(out, rows);
});

test('downsample short series (<800) is not downsampled', () => {
  // 短序列保持原样，便于前端自己处理
  const rows = [];
  for (let i = 1; i <= 100; i++) {
    rows.push({ end_date: `2024010${(i % 10) + 1}`.padStart(8, '2'), unit_nav: 1 + i * 0.001 });
  }
  const out = downsample(rows, 'weekly');
  assert.equal(out.length, 100);
});

/* ============== computeStats annualization ============== */

test('computeStats: daily volatility uses sqrt(252)', () => {
  // 构造已知日收益率序列：交替 +0.01 / -0.01 → 日波动率 ≈ 0.01
  const dates = [];
  const navs = [];
  let nav = 1.0;
  for (let i = 0; i < 250; i++) {
    const d = new Date(Date.UTC(2024, 0, 1) + i * 86400000);
    dates.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`);
    navs.push(nav);
    nav *= (i % 2 === 0 ? 1.01 : 0.99);
  }
  const stats = computeStats(dates, navs, { interval: 'daily' });
  // 日波动率约 0.01；年化约 0.01 * sqrt(252) ≈ 0.1587
  assert.ok(stats.volatility > 0.10 && stats.volatility < 0.20,
    `daily vol expected ~0.16, got ${stats.volatility}`);
});

test('computeStats: weekly volatility uses sqrt(52), not sqrt(252)', () => {
  // 关键回归：旧 bug 下 weekly 会把 vol 夸大 sqrt(252/52) ≈ 2.20 倍。
  // 同样的 nav 序列，分别按 daily / weekly 计算 vol；
  // 真实波动率不变，只是年化系数不同。比值应为 sqrt(52/252)。
  const dates = ['20240101', '20240108', '20240115', '20240122', '20240129', '20240205', '20240212'];
  const navs = [1.0, 1.02, 0.99, 1.03, 1.01, 1.04, 1.02];

  const daily = computeStats(dates, navs, { interval: 'daily' });
  const weekly = computeStats(dates, navs, { interval: 'weekly' });

  const expectedRatio = Math.sqrt(52 / 252);
  const actualRatio = weekly.volatility / daily.volatility;
  assert.ok(Math.abs(actualRatio - expectedRatio) < 1e-6,
    `weekly/daily vol ratio should be sqrt(52/252)=${expectedRatio}, got ${actualRatio}`);
});

test('computeStats: monthly volatility uses sqrt(12)', () => {
  const dates = ['20240131', '20240229', '20240331', '20240430', '20240531', '20240630'];
  const navs = [1.0, 1.05, 0.98, 1.06, 1.02, 1.08];

  const daily = computeStats(dates, navs, { interval: 'daily' });
  const monthly = computeStats(dates, navs, { interval: 'monthly' });

  const expectedRatio = Math.sqrt(12 / 252);
  const actualRatio = monthly.volatility / daily.volatility;
  assert.ok(Math.abs(actualRatio - expectedRatio) < 1e-6,
    `monthly/daily vol ratio should be sqrt(12/252)=${expectedRatio}, got ${actualRatio}`);
});

test('computeStats: empty / single-point input returns nulls', () => {
  assert.deepEqual(computeStats([], []),     {
    startNav: null, endNav: null, totalReturn: null, cagr: null,
    maxDrawdown: null, volatility: null, sharpe: null,
  });
  assert.deepEqual(computeStats(['20240101'], [1.0]), {
    startNav: null, endNav: null, totalReturn: null, cagr: null,
    maxDrawdown: null, volatility: null, sharpe: null,
  });
});

test('computeStats: zero/negative starting NAV returns nulls (no Infinity)', () => {
  // 防御性：startNav <= 0 不应该让 totalReturn 跑飞
  const stats = computeStats(['20240101', '20240102'], [0, 1]);
  assert.equal(stats.totalReturn, null);
  assert.equal(stats.cagr, null);
});

test('computeStats: max drawdown is correct', () => {
  // 序列 1.0 -> 1.5 -> 1.2 -> 1.8 -> 0.9
  // 1.0 之后 peak=1.5；后跌到 1.2 → dd=-20%
  // 之后 peak=1.8；后跌到 0.9 → dd=-50%
  // 最大回撤应为 -50%
  const dates = ['20240101', '20240102', '20240103', '20240104', '20240105'];
  const navs = [1.0, 1.5, 1.2, 1.8, 0.9];
  const stats = computeStats(dates, navs, { interval: 'daily' });
  assert.ok(Math.abs(stats.maxDrawdown - (-0.5)) < 1e-9,
    `expected mdd=-0.5, got ${stats.maxDrawdown}`);
});

test('periodsPerYear: known values', () => {
  assert.equal(periodsPerYear('daily'), 252);
  assert.equal(periodsPerYear('weekly'), 52);
  assert.equal(periodsPerYear('monthly'), 12);
  assert.equal(periodsPerYear('unknown'), 252); // 默认值
});

/* ============== computeUnionRange ============== */

test('computeUnionRange: takes min(start) and max(end)', () => {
  // 旧 bug：用 series.flatMap(...).first / last 得到的是 series[0] 的 start
  // 和 series[last] 的 end；不同基金成立日不同时这是错的。
  const series = [
    { dates: ['20200101', '20210101', '20220101'] }, // 老基金
    { dates: ['20230101', '20240101'] },             // 新基金
  ];
  const r = computeUnionRange(series);
  assert.equal(r.start, '20200101');
  assert.equal(r.end, '20240101');
});

test('computeUnionRange: order of series does not matter', () => {
  const a = [{ dates: ['20200101', '20240101'] }, { dates: ['20230101', '20231231'] }];
  const b = [{ dates: ['20230101', '20231231'] }, { dates: ['20200101', '20240101'] }];
  assert.deepEqual(computeUnionRange(a), computeUnionRange(b));
});

test('computeUnionRange: handles empty / null series', () => {
  assert.equal(computeUnionRange([]), null);
  assert.equal(computeUnionRange(null), null);
  assert.equal(computeUnionRange([{ dates: [] }]), null);
});

test('computeUnionRange: skips series without dates', () => {
  const series = [
    { dates: [] },
    { dates: ['20240101', '20240601'] },
    { /* no dates field */ },
  ];
  const r = computeUnionRange(series);
  assert.equal(r.start, '20240101');
  assert.equal(r.end, '20240601');
});

/* ============== parseYYYYMMDD ============== */

test('parseYYYYMMDD: round-trips standard dates as UTC', () => {
  const d = parseYYYYMMDD('20240315');
  assert.equal(d.getUTCFullYear(), 2024);
  assert.equal(d.getUTCMonth(), 2); // 0-indexed
  assert.equal(d.getUTCDate(), 15);
});

test('parseYYYYMMDD: invalid input returns Invalid Date', () => {
  assert.ok(Number.isNaN(parseYYYYMMDD('').getTime()));
  assert.ok(Number.isNaN(parseYYYYMMDD('2024').getTime()));
  assert.ok(Number.isNaN(parseYYYYMMDD(null).getTime()));
});

/* ============== INDICATORS / parseIndicators (P1.D) ============== */

test('INDICATORS registry exposes ma20 / ma60 / drawdown', () => {
  assert.equal(typeof INDICATORS.ma20, 'function');
  assert.equal(typeof INDICATORS.ma60, 'function');
  assert.equal(typeof INDICATORS.drawdown, 'function');
});

test('INDICATORS is frozen (no accidental mutation)', () => {
  assert.throws(() => { INDICATORS.evil = () => {}; });
});

test('parseIndicators: empty / null / undefined returns []', () => {
  assert.deepEqual(parseIndicators(''), []);
  assert.deepEqual(parseIndicators(null), []);
  assert.deepEqual(parseIndicators(undefined), []);
});

test('parseIndicators: valid names', () => {
  assert.deepEqual(parseIndicators('ma20'), ['ma20']);
  assert.deepEqual(parseIndicators('ma20,ma60,drawdown'), ['ma20', 'ma60', 'drawdown']);
});

test('parseIndicators: trims whitespace and lowercases', () => {
  assert.deepEqual(parseIndicators(' MA20 , Ma60 '), ['ma20', 'ma60']);
});

test('parseIndicators: drops unknown names silently', () => {
  assert.deepEqual(parseIndicators('ma20,evil,sharpe,drawdown'), ['ma20', 'drawdown']);
});

test('parseIndicators: dedupes, preserves first-seen order', () => {
  assert.deepEqual(parseIndicators('drawdown,ma20,drawdown,ma20,ma60'),
    ['drawdown', 'ma20', 'ma60']);
});

/* ============== enrichSeriesIndicators (P1.D) ============== */

test('enrichSeriesIndicators: adds requested fields per series', () => {
  const series = [
    { code: '000001', name: 'A', adjNavs: Array.from({ length: 30 }, (_, i) => 1 + i * 0.01) },
    { code: '000002', name: 'B', adjNavs: Array.from({ length: 30 }, (_, i) => 1 + i * 0.02) },
  ];
  const out = enrichSeriesIndicators(series, ['ma20', 'drawdown']);
  assert.equal(out, series, '应该返回同一引用 (mutate)');
  for (const s of out) {
    assert.ok(Array.isArray(s.ma20), 'ma20 应为数组');
    assert.equal(s.ma20.length, s.adjNavs.length);
    assert.equal(s.ma20[0], null, 'MA 前 n-1 位为 null');
    assert.equal(typeof s.ma20[19], 'number');
    assert.ok(Array.isArray(s.drawdown));
    assert.equal(s.drawdown.length, s.adjNavs.length);
    assert.equal(s.drawdown[0], 0);
  }
});

test('enrichSeriesIndicators: empty / null indicators is no-op', () => {
  const series = [{ code: 'X', adjNavs: [1, 2, 3] }];
  enrichSeriesIndicators(series, []);
  assert.equal(series[0].ma20, undefined);
  enrichSeriesIndicators(series, null);
  assert.equal(series[0].ma20, undefined);
});

test('enrichSeriesIndicators: skips series with missing source field', () => {
  const series = [
    { code: 'X', adjNavs: [1, 2, 3] },
    { code: 'Y' /* no adjNavs */ },
    null,
  ];
  enrichSeriesIndicators(series, ['ma20']);
  assert.ok(Array.isArray(series[0].ma20));
  assert.equal(series[1].ma20, undefined);
});

test('enrichSeriesIndicators: respects custom sourceField', () => {
  const series = [{ code: 'X', navs: [1, 1.1, 1.2, 1.0] }];
  enrichSeriesIndicators(series, ['drawdown'], 'navs');
  assert.ok(Array.isArray(series[0].drawdown));
  assert.equal(series[0].drawdown.length, 4);
});

test('enrichSeriesIndicators: drawdown semantics (peak/trough percentage)', () => {
  // navs: 1.0 -> 1.5 -> 0.75   peak 走到 1.5后跌到 0.75 应该是 -50 (单位 %)
  const series = [{ code: 'X', adjNavs: [1.0, 1.5, 0.75] }];
  enrichSeriesIndicators(series, ['drawdown']);
  assert.equal(series[0].drawdown[0], 0);
  assert.equal(series[0].drawdown[1], 0);
  assert.ok(Math.abs(series[0].drawdown[2] - (-50)) < 1e-9);
});
