import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { buildListQuery, parseListParams } from './list-query.js';
import { filterSearchIndex } from '../js/utils/search.js';

test('shared search ranking survives SQL filters, count and pagination', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE fund_meta(ts_code,code,source,tracking_target,trading_subscribe,trading_redeem,
      buy_fee,annual_fee,is_floating_annual_fee,crawler_updated_at,found_date_normalized,
      name_crawler,fund_type_crawler,management_crawler,benchmark_crawler);
      CREATE INDEX idx_fund_meta_code ON fund_meta(code);
      CREATE TABLE fund_basic(ts_code,name,management,fund_type,benchmark,status);
      CREATE TABLE morningstar_fund_fee(code,as_of_date,implicit_fee_pct,total_fee_pct,PRIMARY KEY(as_of_date,code));
      CREATE INDEX idx_morningstar_fund_fee_code ON morningstar_fund_fee(code,as_of_date DESC);
      CREATE TABLE fund_fee_segments(ts_code,kind,seq,rate);`);
    const idx = [
      {code:'001564',name:'东方红京东大数据混合A',initials:'dfhjddsjhha'},
      {code:'017535',name:'东方红京东大数据混合C',initials:'dfhjddsjhhc'},
      {code:'999999',name:'JD',initials:'jd'},
    ];
    for (const [i, item] of idx.entries()) {
      db.prepare('INSERT INTO fund_meta(ts_code,code,source,name_crawler,annual_fee) VALUES(?,?,?,?,?)')
        .run(item.code+'.OF',item.code,'crawler',item.name,[0.01,0.02,0.03][i]);
    }
    const query = qs => buildListQuery({...parseListParams(qs),searchIndex:idx});
    for (const page of [1,2,3]) {
      const b = query({q:'jd',page,size:1});
      assert.equal(db.prepare(b.countSql).get(...b.params).n, 3);
      assert.equal(db.prepare(b.sql).get(...b.params).code, filterSearchIndex(idx,'jd')[page-1].code);
    }
    const filtered = query({q:'jd',annualFeeMax:0.015});
    assert.equal(db.prepare(filtered.countSql).get(...filtered.params).n,1);
    assert.equal(db.prepare(filtered.sql).get(...filtered.params).code,'001564');
    const sorted = query({q:'jd',sort:'annualFee:asc'});
    assert.equal(db.prepare(sorted.sql).get(...sorted.params).code,'001564');
    for (const q of ['%','zzzznonexistent',"' OR 1=1 --"]) {
      const b=query({q});
      assert.equal(db.prepare(b.countSql).get(...b.params).n,0);
      assert.deepEqual(db.prepare(b.sql).all(...b.params),[]);
    }
  } finally { db.close(); }
});
