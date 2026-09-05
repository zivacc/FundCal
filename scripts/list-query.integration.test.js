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
  for (const query of [page.query, run({ q: '沪深', source: 'tushare' }).query]) {
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + query.sql).all(...query.params).map(row => row.detail);
    assert.ok(plan.some(line => /SEARCH m USING INDEX idx_fund_meta_code/.test(line)), plan.join('\n'));
  }
});
