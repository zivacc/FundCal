import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEastmoneyRecords } from './eastmoney-records.js';
test('extends adjusted NAV without switching to accumulated NAV scale', () => {
  const [r] = buildEastmoneyRecords('080001', [{ FSRQ: '2026-05-01', DWJZ: '2.2', LJJZ: '5.2', JZZZL: '10' }],
    { end_date: '20260430', unit_nav: 2, accum_nav: 5, adj_nav: 16 });
  assert.equal(r.adj_nav, 17.6);
});
test('cash distributions are reinvested and descending pages are sorted', () => {
  const rows = buildEastmoneyRecords('000001', [
    { FSRQ: '2026-05-02', DWJZ: '1.98', LJJZ: '2.18', JZZZL: '10' },
    { FSRQ: '2026-05-01', DWJZ: '1.8', LJJZ: '2', JZZZL: '0' },
  ], { end_date: '20260430', unit_nav: 2, accum_nav: 2, adj_nav: 4 });
  assert.equal(rows[0].adj_nav, 4);
  assert.ok(Math.abs(rows[1].adj_nav - 4.4) < 1e-10);
});
test('split uses reported return and duplicate anchor is not rewritten', () => {
  const rows = buildEastmoneyRecords('000001', [
    { FSRQ: '2026-04-30', DWJZ: '2', LJJZ: '2' },
    { FSRQ: '2026-05-01', DWJZ: '1', LJJZ: '1', JZZZL: '0' },
  ], { end_date: '20260430', unit_nav: 2, accum_nav: 2, adj_nav: 4 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].adj_nav, 4);
});
