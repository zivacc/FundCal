import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImplicitReference, latestImplicitReference, effectiveAnnualFee } from './implicit-fee.js';
import { calcTotalFeeRate, findCrossoverPoints } from './fee-calculator.js';

test('latest valid Morningstar reference uses snapshot date, converts percent and preserves zero', () => {
  const history = { code: '004685', periods: [
    { available: true, as_of_date: '2025-12-31', implicit_fee_pct: null },
    { available: true, as_of_date: '2025-06-30', implicit_fee_pct: .34 },
    { available: true, as_of_date: '2026-06-30', implicit_fee_pct: -1 },
    { available: false, as_of_date: '2026-12-31', implicit_fee_pct: 99 },
  ] };
  assert.deepEqual(latestImplicitReference(history, '004685'), { code: '004685', date: '2025-06-30', rate: .34 / 100 });
  assert.equal(latestImplicitReference(history, '001564'), null);
  history.periods.push({ available: true, as_of_date: '2025-12-31', implicit_fee_pct: 0 });
  assert.equal(latestImplicitReference(history, '004685').rate, 0);
  assert.equal(latestImplicitReference({ code: '004685', periods: [] }, '004685'), null);
});

test('saved references preserve the chosen period and reject a different fund or invalid rate', () => {
  const value = { code: '004685', date: '2024-12-31', rate: .004 };
  assert.deepEqual(normalizeImplicitReference(value, '004685'), value);
  assert.equal(normalizeImplicitReference(value, '001564'), null);
  for (const rate of [null, -1, Infinity, '0.3']) assert.equal(normalizeImplicitReference({ ...value, rate }, '004685'), null);
});

test('implicit fees are opt-in, added once to annual holding costs without changing buy/sell fees', () => {
  const fund = { annualFee: .013, buyFee: .001, sellFeeSegments: [{ to: null, rate: .005 }], implicitFee: .004 };
  assert.equal(effectiveAnnualFee(fund), .013);
  const before = calcTotalFeeRate(fund, 365);
  const included = { ...fund, includeImplicitFee: true };
  assert.ok(Math.abs(calcTotalFeeRate(included, 365) - before - .004) < 1e-10);
  assert.ok(Math.abs(calcTotalFeeRate(included, 730) - calcTotalFeeRate(fund, 730) - .008) < 1e-10);
  for (const implicitFee of [null, -1, NaN]) assert.equal(effectiveAnnualFee({ ...included, implicitFee }), .013);
  assert.equal(fund.annualFee, .013);
});

test('including implicit fees also updates crossover calculations', () => {
  const a = { name: 'A', annualFee: .01, buyFee: .01, implicitFee: .01 };
  const b = { name: 'B', annualFee: .03 };
  const original = findCrossoverPoints(a, b, 1000)[0];
  const included = findCrossoverPoints({ ...a, includeImplicitFee: true }, b, 1000)[0];
  assert.ok(included.days > original.days);
});
