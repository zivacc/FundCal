import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { parseListParams, buildListQuery } from './list-query.js';

test('search-driven SQL preserves relevance, filters, pagination, sorting and empty matches', t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE fund_meta (ts_code TEXT PRIMARY KEY, code TEXT, source TEXT, tracking_target,
    trading_subscribe, trading_redeem, buy_fee, annual_fee, is_floating_annual_fee, crawler_updated_at,
    found_date_normalized, name_crawler, fund_type_crawler, management_crawler, benchmark_crawler);
    CREATE INDEX idx_fund_meta_code ON fund_meta(code);
    CREATE INDEX idx_fund_meta_source ON fund_meta(source);
    CREATE TABLE fund_basic (ts_code TEXT PRIMARY KEY, name, management, fund_type, benchmark, status);
    CREATE TABLE morningstar_fund_fee(code,as_of_date,implicit_fee_pct,total_fee_pct,PRIMARY KEY(as_of_date,code));
    CREATE INDEX idx_morningstar_fund_fee_code ON morningstar_fund_fee(code,as_of_date DESC);
    CREATE TABLE fund_fee_segments (ts_code, kind, seq, rate, PRIMARY KEY(ts_code,kind,seq));
    INSERT INTO fund_meta (ts_code,code,source,annual_fee,name_crawler,fund_type_crawler) VALUES
      ('000001.OF','000001','crawler',0.01,'沪深300甲','股票型'),
      ('000002.OF','000002','both',0.02,'沪深300乙','股票型'),
      ('000003.OF','000003','tushare',0.03,'沪深300丙','股票型'),
      ('000004.OF','000004','crawler',0.04,'债券丁','债券型');`);
  const searchIndex = db.prepare('SELECT code,name_crawler AS name FROM fund_meta ORDER BY code DESC').all();
  const run = qs => {
    const query = buildListQuery({ ...parseListParams(qs), searchIndex });
    return { rows: db.prepare(query.sql).all(...query.params).map(row => row.code), count: db.prepare(query.countSql).get(...query.params).n, query };
  };
  assert.deepEqual(run({ q: '沪深' }).rows, ['000002', '000001']);
  const page = run({ q: '沪深', size: '1', page: '2' });
  assert.deepEqual(page.rows, ['000001']); assert.equal(page.count, 2);
  assert.deepEqual(run({ q: '沪深', source: 'tushare' }).rows, ['000003']);
  assert.deepEqual(run({ q: '沪深', annualFeeMax: '0.015' }).rows, ['000001']);
  assert.deepEqual(run({ q: '沪深', sort: 'annualFee:asc' }).rows, ['000001', '000002']);
  assert.deepEqual(run({ q: '不存在' }).rows, []);
  assert.equal(run({ q: '不存在' }).count, 0);
  assert.deepEqual(run({ fundType: '债券型' }).rows, ['000004']);
  assert.deepEqual(run({ poolCodes: '000001,000003,000001,999999' }).rows, ['000001', '000003']);
  assert.equal(run({ poolCodes: '000001,000003', size: 1, page: 2 }).count, 2);
  assert.deepEqual(run({ poolCodes: '000001,000003', size: 1, page: 2 }).rows, ['000003']);
  assert.deepEqual(run({ poolCodes: '', q: '沪深' }).rows, []);
  assert.equal(run({ poolCodes: 'bad' }).count, 0);
  assert.deepEqual(run({ poolCodes: '000001,000003', q: '沪深', sort: 'annualFee:desc' }).rows, ['000003', '000001']);
  assert.deepEqual(run({ poolCodes: '000001,000004', fundType: '债券型' }).rows, ['000004']);
  assert.deepEqual(run({ poolCodes: '000001,000003', source: 'crawler' }).rows, ['000001']);
  db.exec("INSERT INTO fund_meta(ts_code,code,source,name_crawler) VALUES('000003.SH','000003','tushare','同代码场内')");
  assert.equal(run({ poolCodes: '000003' }).count, 1);
  const poolQuery = run({ poolCodes: '000003' }).query;
  assert.equal(db.prepare(poolQuery.sql).get(...poolQuery.params).ts_code, '000003.OF');
  db.exec("DELETE FROM fund_meta WHERE ts_code='000003.SH'");
  for (const query of [page.query, run({ q: '沪深', source: 'tushare' }).query]) {
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + query.sql).all(...query.params).map(row => row.detail);
    assert.ok(plan.some(line => /SEARCH m USING INDEX idx_fund_meta_code/.test(line)), plan.join('\n'));
  }
  // Multiple snapshots must not multiply list rows or fill latest nulls with older values.
  db.exec(`INSERT INTO morningstar_fund_fee VALUES
    ('000001','2024-12-31',99,100), ('000001','2025-12-31',0,1.4),
    ('000002','2024-12-31',0.5,2), ('000002','2025-12-31',NULL,2.4),
    ('000003','2025-12-31',0.3,3), ('000004','2024-12-31',0.2,NULL);`);
  assert.deepEqual(run({ sort: 'morningstarImplicitFee:asc' }).rows, ['000001','000004','000002']);
  assert.deepEqual(run({ sort: 'morningstarImplicitFee:desc' }).rows, ['000004','000001','000002']);
  assert.deepEqual(run({ sort: 'morningstarTotalFee:asc' }).rows, ['000001','000002','000004']);
  assert.deepEqual(run({ sort: 'morningstarTotalFee:desc' }).rows, ['000002','000001','000004']);
  const msPage = run({ sort: 'morningstarImplicitFee:asc', size: 1, page: 2 });
  assert.equal(msPage.count, 3); assert.deepEqual(msPage.rows, ['000004']);
  assert.deepEqual(run({ q: '沪深', sort: 'morningstarImplicitFee:desc' }).rows, ['000001','000002']);
  assert.deepEqual(run({ source: 'tushare', sort: 'morningstarTotalFee:desc' }).rows, ['000003']);
  const latestRows = db.prepare(msPage.query.sql).all(...msPage.query.params);
  assert.equal(latestRows[0].morningstar_as_of_date, '2024-12-31');
  assert.equal(latestRows[0].morningstar_total_fee_pct, null);
  const noData = run({q: '沪深', sort: 'morningstarImplicitFee:asc', page: 2, size: 1}).query;
  assert.equal(db.prepare(noData.sql).get(...noData.params).morningstar_implicit_fee_pct, null);
});
