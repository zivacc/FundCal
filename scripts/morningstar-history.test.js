import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { turnoverPercentile, loadMorningstarHistory } from './morningstar-history.js';

test('turnover midrank preserves ties, zero and excludes missing/invalid values', () => {
  assert.deepEqual(turnoverPercentile(20, [0, 20, 20, 80, null, -1, NaN]), { percentile: 50, sampleSize: 4 });
  assert.equal(turnoverPercentile(0, [0, 100]).percentile, 25);
  assert.equal(turnoverPercentile(null, [0, 100]).percentile, null);
  assert.equal(turnoverPercentile(10, [10]).percentile, null);
});

test('history uses each period category, keeps missing snapshots and original fee ranks', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE morningstar_fee_snapshot(as_of_date TEXT, source_file TEXT, generated_at TEXT);
    CREATE TABLE morningstar_fund_fee(as_of_date TEXT, code TEXT, name TEXT, morningstar_category TEXT,
    total_fee_pct REAL, total_fee_rank_pct REAL, explicit_fee_pct REAL, explicit_fee_rank_pct REAL,
    implicit_fee_pct REAL, implicit_fee_rank_pct REAL, turnover_pct REAL, category_median_turnover_pct REAL);
    INSERT INTO morningstar_fee_snapshot VALUES ('2024-06-30','a.xlsx',NULL),('2024-12-31','b.xlsx',NULL),('2025-06-30','c.xlsx',NULL);
    INSERT INTO morningstar_fund_fee VALUES
      ('2024-06-30','000001','A','X',2,42,1,20,1,60,20,10),
      ('2024-06-30','000002','B','X',NULL,NULL,NULL,NULL,NULL,NULL,0,10),
      ('2024-06-30','000003','C','Y',NULL,NULL,NULL,NULL,NULL,NULL,100,10),
      ('2024-12-31','000001','A','Y',2,43,1,21,1,61,20,50),
      ('2024-12-31','000002','B','Y',NULL,NULL,NULL,NULL,NULL,NULL,80,50);`);
  try {
    const data = loadMorningstarHistory(db, '000001');
    assert.equal(data.periods[0].turnover.percentile, 75);
    assert.equal(data.periods[1].turnover.percentile, 25);
    assert.equal(data.periods[0].total_fee_rank_pct, 42);
    assert.equal(data.periods[2].available, false);
    assert.equal(data.periods[2].explicit_fee_pct, null);
    assert.equal(loadMorningstarHistory(db, '999999').periods.every(p => !p.available), true);
    assert.throws(() => loadMorningstarHistory(db, "' OR 1=1"));
  } finally { db.close(); }
});
