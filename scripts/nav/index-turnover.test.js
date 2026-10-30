import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { estimateIndexWeightChange, ensureIndexTurnoverSchema, publicTurnoverDisclosure, readIndexTurnoverDisclosure } from './index-turnover.js';

const sample = (date, weights, extra = {}) => ({ id: 1, indexCode: '000300.SH', source: 'csindex', asOfDate: date,
  count: Object.keys(weights).length, rows: Object.entries(weights).map(([code, weightPct]) => ({ code, weightPct })), ...extra });
const before = () => sample('2026-06-30', { '1.SH': 60, '2.SZ': 40 });
const after = () => sample('2026-07-31', { '1.SH': 50, '3.SZ': 50 }, { id: 2 });
const disclosure = (extra = {}) => ({ index_ts_code: '000300.SH', period_start: '2026-01-01', period_end: '2026-06-30',
  turnover_pct: 12.5, convention: 'one_way', annualized: 0, definition: '半年单边调仓换手', source: '指数发布机构',
  source_url: 'https://example.com/turnover.pdf', published_at: '2026-07-05', validation: 'verified', ...extra });

test('snapshot proxy matches code identities, includes additions/removals and keeps percentage units', () => {
  const result = estimateIndexWeightChange(before(), after());
  assert.equal(result.valuePct, 50);
  assert.equal(result.addedCount, 1); assert.equal(result.removedCount, 1);
  assert.equal(result.from.asOfDate, '2026-06-30'); assert.equal(result.to.asOfDate, '2026-07-31');
  assert.equal(result.priceAdjusted, false); assert.equal(result.annualized, false); assert.equal(result.normalized, false);
  assert.equal(estimateIndexWeightChange(before(), sample('2026-07-31', { '2.SZ': 40, '1.SH': 60 })).valuePct, 0);
});

test('raw source rounding is preserved in proxy and source totals', () => {
  const result = estimateIndexWeightChange(before(), sample('2026-07-31', { '1.SH': 60.03, '2.SZ': 40 }));
  assert.ok(Math.abs(result.valuePct - .015) < 1e-10);
  assert.equal(result.to.weightSumPct, 100.03);
});

test('missing history, foreign versions/vendors, same dates and unverified dates never become zero turnover', () => {
  for (const [a, b, reason] of [
    [null, null, 'no_current_snapshot'], [null, after(), 'no_previous_same_source'],
    [before(), { ...after(), indexCode: 'H00300.CSI' }, 'incompatible_snapshots'],
    [{ ...before(), indexCode: undefined }, { ...after(), indexCode: undefined }, 'incompatible_snapshots'],
    [before(), { ...after(), source: 'tushare' }, 'incompatible_snapshots'],
    [before(), { ...after(), source: 'wind' }, 'unverified_effective_date'],
    [before(), { ...after(), asOfDate: '2026-06-30' }, 'invalid_dates'],
    [before(), { ...after(), asOfDate: '2026-02-31' }, 'invalid_dates'],
  ]) {
    const result = estimateIndexWeightChange(a, b);
    assert.equal(result.valuePct, null); assert.equal(result.reason, reason);
  }
});

test('incomplete, duplicate or invalid weights reject the entire proxy', () => {
  const bad = [ { ...after(), count: 3 }, sample('2026-07-31', { a: 99 }), sample('2026-07-31', { a: -1, b: 101 }),
    { ...after(), rows: [{ code: 'x', weightPct: 50 }, { code: 'x', weightPct: 50 }] },
    sample('2026-07-31', { a: NaN, b: 50 }), sample('2026-07-31', { a: null, b: 100 }) ];
  for (const current of bad) assert.equal(estimateIndexWeightChange(before(), current).reason, 'invalid_weights');
});

test('disclosures require exact index, dates, percentage, clear convention and verified public attribution', () => {
  assert.equal(publicTurnoverDisclosure(disclosure({ turnover_pct: 0 }), '000300.SH').valuePct, 0);
  assert.equal(publicTurnoverDisclosure(disclosure({ turnover_pct: 210, annualized: 1 }), '000300.SH').valuePct, 210);
  for (const row of [ disclosure({ index_ts_code: 'H00300.CSI' }), disclosure({ turnover_pct: null }),
    disclosure({ turnover_pct: -1 }), disclosure({ validation: 'pending' }), disclosure({ source_url: '/private/report.pdf' }),
    disclosure({ source_url: 'javascript:alert(1)' }), disclosure({ source_url: 'https://user:secret@example.com/' }),
    disclosure({ convention: 'unknown' }), disclosure({ annualized: null }), disclosure({ definition: '' }),
    disclosure({ published_at: '2026-06-01' }), disclosure({ period_start: '2026-02-30' }),
    disclosure({ period_start: '2026-07-01' }) ]) assert.equal(publicTurnoverDisclosure(row, '000300.SH'), null);
});

test('optional disclosure reader does not initialize schema and returns only public validated latest rows', t => {
  const db = new Database(':memory:'); t.after(() => db.close());
  assert.equal(readIndexTurnoverDisclosure(db, '000300.SH'), null);
  assert.deepEqual(db.prepare('SELECT name FROM sqlite_master').all(), []);
  ensureIndexTurnoverSchema(db); ensureIndexTurnoverSchema(db);
  const insert = row => db.prepare(`INSERT INTO index_turnover_disclosure VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
  insert(disclosure());
  insert(disclosure({ period_end: '2026-08-31', published_at: '2026-09-01', turnover_pct: 21.5 }));
  const result = readIndexTurnoverDisclosure(db, '000300.SH');
  assert.equal(result.valuePct, 21.5); assert.equal(result.periodEnd, '2026-08-31');
  assert.equal(readIndexTurnoverDisclosure(db, 'H00300.CSI'), null);
  assert.doesNotMatch(JSON.stringify(result), /validation|index_ts_code/);
});
