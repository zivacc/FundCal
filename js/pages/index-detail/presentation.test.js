import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIndexRoute, dateLabel, numberLabel, percentLabel, tableRows, pageRows, weightSummary, snapshotWarning } from './presentation.js';

test('index routes preserve precise code identity and reject malformed or foreign routes', () => {
  assert.equal(parseIndexRoute('#/index-detail/h30590.CSI'), 'h30590.CSI');
  assert.equal(parseIndexRoute('#/index-detail/HSBT.HI'), 'HSBT.HI');
  assert.equal(parseIndexRoute('#/index-detail'), '');
  for (const hash of ['#/fund/000001', '#/index-detail/%ZZ', '#/index-detail/000001', '#/index-detail/HSI.HI/extra', '#/index-detail/a%2Fb.SH']) assert.equal(parseIndexRoute(hash), null);
});

test('dates and percentages preserve data units and distinguish missing from zero', () => {
  assert.equal(dateLabel('20260907'), '2026-09-07');
  assert.equal(dateLabel('2026-08-31'), '2026-08-31');
  assert.equal(percentLabel(0), '0.00%');
  assert.equal(percentLabel(100.03), '100.03%');
  assert.equal(percentLabel(null), '—');
  assert.equal(numberLabel(null), '—');
  assert.equal(numberLabel(NaN), '—');
});

test('table filtering retains all matches before sorting/paging without mutating source rows', () => {
  const rows = Array.from({ length: 309 }, (_, i) => ({ code: String(i).padStart(6, '0'), name: `沪深300基金${i}`, annualFee: i / 10000 }));
  const all = tableRows(rows, '沪深', 'fee');
  assert.equal(all.length, 309);
  assert.deepEqual(pageRows(all, 16, 20), { rows: all.slice(300), total: 309, page: 16, pages: 16 });
  assert.equal(pageRows(all, 100, 20).page, 16);
  assert.equal(pageRows([], 99).page, 1);
  assert.equal(rows[0].code, '000000');
  assert.equal(rows.length, 309);
});

test('missing annual fees sort after real zero and weight summaries do not normalize rounding', () => {
  const rows = [{ code: '1', name: '缺失', annualFee: null }, { code: '2', name: '零', annualFee: 0 }, { code: '3', name: '低费', annualFee: .001 }];
  assert.deepEqual(tableRows(rows, '', 'fee').map(r => r.code), ['2', '3', '1']);
  const weights = [{ code: 'a', weightPct: 60 }, { code: 'b', weightPct: 40.03 }];
  const summary = weightSummary(weights);
  assert.equal(summary.total, 100.03);
  assert.equal(summary.top10, 100.03);
  assert.equal(weights[1].weightPct, 40.03);
});

test('Wind source dates remain explicit, with a stronger caveat on the questioned batch', () => {
  assert.match(snapshotWarning({ source: 'wind', asOfDate: '2026-09-28' }), /核验疑点/);
  assert.match(snapshotWarning({ source: 'wind', asOfDate: '2026-08-31' }), /尚未独立核验/);
  assert.equal(snapshotWarning({ source: 'cnindex', asOfDate: '2026-08-31' }), '');
});
