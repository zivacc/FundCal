import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonCodes, comparisonHref, percent, reportFor, reportDates, redemptionText, comparisonSections } from './model.js';

test('comparison accepts unique six-digit fund codes and refuses invalid or oversized selections', () => {
  assert.deepEqual(comparisonCodes(['000001', '000002', '000001']), ['000001', '000002']);
  assert.equal(comparisonHref(['000001', '000002']), '#/compare/000001,000002');
  for (const code of ['000300.SH', '<svg>', '', '12345']) assert.throws(() => comparisonCodes([code]));
  assert.throws(() => comparisonCodes(Array.from({ length: 9 }, (_, i) => String(i).padStart(6, '0'))));
});

test('comparison does not confuse fractional current fees with historical percentage units or missing values', () => {
  assert.equal(percent(.012, true), '1.20%');
  assert.equal(percent(1.2), '1.20%');
  assert.equal(percent(0), '0.00%');
  assert.equal(percent(-.2), '-0.20%');
  for (const value of [null, undefined, '', '0', NaN, Infinity]) assert.equal(percent(value), '—');
  const sections = comparisonSections([]);
  const annual = sections[1].rows.find(row => row.label === '显性年化费率');
  assert.equal(annual.value({ raw: {} }), '—');
  assert.equal(annual.value({ raw: { annualFee: 0 } }), '0.00%');
  assert.equal(annual.value({ source: 'static', raw: { annualFee: 0 } }), '—');
});

test('a comparison report stays within one available snapshot, preserving gaps instead of taking older values', () => {
  const history = { periods: [
    { as_of_date: '2024-12-31', available: true, turnover_pct: 5, implicit_fee_pct: 1 },
    { as_of_date: '2026-06-30', available: false, turnover_pct: null },
    { as_of_date: '2025-12-31', available: true, turnover_pct: 0, implicit_fee_pct: null },
  ] };
  assert.equal(reportFor(history).as_of_date, '2025-12-31');
  assert.equal(reportFor(history).implicit_fee_pct, null);
  assert.equal(reportFor(history, '2026-06-30'), null);
  assert.equal(reportFor(history, '2024-12-31').turnover_pct, 5);
  assert.deepEqual(reportDates([{ history }, { history }]), ['2025-12-31', '2024-12-31']);
  const rows = comparisonSections([])[2].rows;
  assert.equal(rows.find(row => row.label === '换手率').value({ history }, 'latest'), '0.00%');
  assert.equal(rows.find(row => row.label === '隐性费率（估）').value({ history }, 'latest'), '—');
});

test('redemption boundaries and stage periods are rendered without inventing data', () => {
  assert.equal(redemptionText([{ to: 7, rate: .015 }, { to: 30, rate: .005 }, { to: null, rate: 0 }]), '< 7 天：1.50%\n7 ≤ 天数 < 30：0.50%\n≥ 30 天：0.00%');
  assert.equal(redemptionText([]), '—');
  const entries = [{ raw: { stageReturns: [{ period: '近1年', returnPct: 2 }] } }, { raw: { stageReturns: [] } }];
  const rows = comparisonSections(entries)[3].rows;
  assert.equal(rows[1].value(entries[0]), '2.00%');
  assert.equal(rows[1].value(entries[1]), '—');
});
