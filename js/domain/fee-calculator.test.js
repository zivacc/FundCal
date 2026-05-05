/**
 * Unit tests for js/domain/fee-calculator.js
 *
 * 跑：npm test
 *
 * 重点覆盖：
 *   - 段费率边界 (含 to:null 永久段、未排序输入)
 *   - 总费率合成 (buy + sell + daily)
 *   - 曲线生成 step / maxDays
 *   - 年化折算 holdDays=0 / 365 边界
 *   - 交叉点检测 + 多基金两两组合
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEGMENT_DAYS,
  MAX_CALC_DAYS,
  getSellFeeRate,
  calcTotalFeeRate,
  calcFeeCurve,
  toAnnualizedFeeRate,
  findCrossoverPoints,
  findAllCrossovers,
} from './fee-calculator.js';

/* ============== constants sanity ============== */

test('SEGMENT_DAYS is the canonical 7/30/90/180/365/730 ladder', () => {
  assert.deepEqual(SEGMENT_DAYS, [7, 30, 90, 180, 365, 730]);
});

test('MAX_CALC_DAYS = 1095 (3 年)', () => {
  assert.equal(MAX_CALC_DAYS, 1095);
});

/* ============== getSellFeeRate ============== */

test('getSellFeeRate: empty / null segments → 0', () => {
  assert.equal(getSellFeeRate(30, []), 0);
  assert.equal(getSellFeeRate(30, null), 0);
  assert.equal(getSellFeeRate(30, undefined), 0);
});

test('getSellFeeRate: holdDays <= 0 → 0', () => {
  const segs = [{ to: 7, rate: 0.015 }, { to: null, rate: 0 }];
  assert.equal(getSellFeeRate(0, segs), 0);
  assert.equal(getSellFeeRate(-5, segs), 0);
});

test('getSellFeeRate: in-bucket lookup', () => {
  const segs = [
    { to: 7,    rate: 0.015 },
    { to: 30,   rate: 0.005 },
    { to: 365,  rate: 0.001 },
    { to: null, rate: 0 },
  ];
  assert.equal(getSellFeeRate(1,   segs), 0.015);
  assert.equal(getSellFeeRate(7,   segs), 0.015);  // 边界含右端
  assert.equal(getSellFeeRate(8,   segs), 0.005);
  assert.equal(getSellFeeRate(30,  segs), 0.005);
  assert.equal(getSellFeeRate(31,  segs), 0.001);
  assert.equal(getSellFeeRate(365, segs), 0.001);
  assert.equal(getSellFeeRate(366, segs), 0);      // 永久段
});

test('getSellFeeRate: unsorted input is sorted internally', () => {
  const segs = [
    { to: null, rate: 0 },
    { to: 7,    rate: 0.015 },
    { to: 365,  rate: 0.001 },
    { to: 30,   rate: 0.005 },
  ];
  assert.equal(getSellFeeRate(7,  segs), 0.015);
  assert.equal(getSellFeeRate(30, segs), 0.005);
  assert.equal(getSellFeeRate(999, segs), 0);
});

test('getSellFeeRate: undefined to is treated as perpetual (== null)', () => {
  const segs = [{ to: 30, rate: 0.005 }, { to: undefined, rate: 0.002 }];
  assert.equal(getSellFeeRate(31, segs), 0.002);
});

test('getSellFeeRate: no perpetual + over-budget → 0', () => {
  const segs = [{ to: 7, rate: 0.015 }, { to: 30, rate: 0.005 }];
  assert.equal(getSellFeeRate(100, segs), 0);
});

/* ============== calcTotalFeeRate ============== */

test('calcTotalFeeRate: defaults to 0 when fee fields missing', () => {
  assert.equal(calcTotalFeeRate({}, 30), 0);
});

test('calcTotalFeeRate: combines buy + sell + daily', () => {
  const fund = {
    buyFee: 0.012,
    sellFeeSegments: [
      { to: 7,    rate: 0.015 },
      { to: null, rate: 0 },
    ],
    annualFee: 0.0073, // 1% / 365 ≈ 0.00002 per day
  };
  // d=1: buy + sell(0.015) + daily(0.0073/365)
  const expected = 0.012 + 0.015 + (0.0073 / 365) * 1;
  assert.ok(Math.abs(calcTotalFeeRate(fund, 1) - expected) < 1e-12);
});

test('calcTotalFeeRate: daily fee scales linearly with holdDays', () => {
  const fund = { annualFee: 0.0365 }; // 1bp/day
  const f10 = calcTotalFeeRate(fund, 10);
  const f100 = calcTotalFeeRate(fund, 100);
  assert.ok(Math.abs(f100 - 10 * f10) < 1e-12);
});

/* ============== calcFeeCurve ============== */

test('calcFeeCurve: default returns MAX_CALC_DAYS points', () => {
  const fund = { buyFee: 0.01 };
  const pts = calcFeeCurve(fund);
  assert.equal(pts.length, MAX_CALC_DAYS);
  assert.equal(pts[0].days, 1);
  assert.equal(pts.at(-1).days, MAX_CALC_DAYS);
});

test('calcFeeCurve: custom maxDays + step', () => {
  const pts = calcFeeCurve({}, 30, 10);
  assert.deepEqual(pts.map(p => p.days), [1, 11, 21]);
});

test('calcFeeCurve: feeRate matches calcTotalFeeRate at each day', () => {
  const fund = { buyFee: 0.01, annualFee: 0.0073 };
  const pts = calcFeeCurve(fund, 5);
  for (const p of pts) {
    assert.equal(p.feeRate, calcTotalFeeRate(fund, p.days));
  }
});

/* ============== toAnnualizedFeeRate ============== */

test('toAnnualizedFeeRate: holdDays <= 0 → 0', () => {
  assert.equal(toAnnualizedFeeRate(0.05, 0), 0);
  assert.equal(toAnnualizedFeeRate(0.05, -1), 0);
});

test('toAnnualizedFeeRate: 365 天总费率即年化', () => {
  assert.ok(Math.abs(toAnnualizedFeeRate(0.05, 365) - 0.05) < 1e-12);
});

test('toAnnualizedFeeRate: 持有 30 天的 1% 折算到约 12.17%', () => {
  const annu = toAnnualizedFeeRate(0.01, 30);
  assert.ok(Math.abs(annu - 0.01 * (365 / 30)) < 1e-12);
});

/* ============== findCrossoverPoints ============== */

test('findCrossoverPoints: identical funds → no crossover', () => {
  const f = { name: 'A', buyFee: 0.01, sellFeeSegments: [{ to: null, rate: 0 }], annualFee: 0.005 };
  assert.deepEqual(findCrossoverPoints(f, { ...f, name: 'B' }, 100), []);
});

test('findCrossoverPoints: detects single crossover', () => {
  // A: 高 buy, 低 daily ；B: 低 buy, 高 daily
  // 长持有期 B 反超 A
  const A = { name: 'A', buyFee: 0.012, sellFeeSegments: [{ to: null, rate: 0 }], annualFee: 0.001 };
  const B = { name: 'B', buyFee: 0.003, sellFeeSegments: [{ to: null, rate: 0 }], annualFee: 0.020 };
  const pts = findCrossoverPoints(A, B, 365);
  assert.equal(pts.length, 1);
  // 解析解：0.012 + 0.001*d/365 = 0.003 + 0.020*d/365 → 0.009 = 0.019*d/365 → d ≈ 172.9
  assert.ok(pts[0].days >= 170 && pts[0].days <= 175, `expected ~173, got ${pts[0].days}`);
  assert.equal(pts[0].fundA, 'A');
  assert.equal(pts[0].fundB, 'B');
  // A 起初便宜先 (它 fee 高，B 反超意味着 B 先低 A 后低)
  // 实际上 A buyFee 更高，所以 d=1 时 A 更贵。crossover 之前 B 便宜，之后 A 便宜。
  assert.equal(pts[0].beforeCross, 'B');
  assert.equal(pts[0].afterCross, 'A');
});

test('findCrossoverPoints: result includes annualizedFeeRate', () => {
  const A = { name: 'A', buyFee: 0.015, annualFee: 0.001 };
  const B = { name: 'B', buyFee: 0.005, annualFee: 0.030 };
  const pts = findCrossoverPoints(A, B, 200);
  assert.ok(pts.length >= 1);
  for (const p of pts) {
    assert.ok(typeof p.annualizedFeeRate === 'number');
    assert.ok(Math.abs(p.annualizedFeeRate - p.feeRate * 365 / p.days) < 1e-12);
  }
});

/* ============== findAllCrossovers ============== */

test('findAllCrossovers: 3 funds → at most C(3,2) = 3 pairs of crossovers', () => {
  const A = { name: 'A', buyFee: 0.015, annualFee: 0.001 };
  const B = { name: 'B', buyFee: 0.005, annualFee: 0.020 };
  const C = { name: 'C', buyFee: 0.000, annualFee: 0.030 };
  const all = findAllCrossovers([A, B, C], 365);
  assert.ok(all.length >= 1, '至少有一组交叉');
  // 输出按 days 升序
  for (let i = 1; i < all.length; i++) {
    assert.ok(all[i].days >= all[i - 1].days, '应按 days 升序');
  }
});

test('findAllCrossovers: empty / single fund → []', () => {
  assert.deepEqual(findAllCrossovers([]), []);
  assert.deepEqual(findAllCrossovers([{ name: 'solo', buyFee: 0.01 }]), []);
});
