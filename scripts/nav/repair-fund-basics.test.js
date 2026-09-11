import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {applyBasicInfoPatch,selectBasicGaps} from './repair-fund-basics.js';
import {fetchFundBasicInfo} from '../crawl-fund-fee.js';

test('Basic gap repair targets .OF shadows, preserves fee data and defers authoritative changes to merge rules',()=>{
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE fund_basic(ts_code TEXT PRIMARY KEY,code TEXT,name TEXT,management TEXT,fund_type TEXT,benchmark TEXT,found_date TEXT);
    CREATE TABLE fund_meta(ts_code TEXT PRIMARY KEY,source TEXT,management_crawler TEXT,fund_type_crawler TEXT,benchmark_crawler TEXT,found_date_crawler TEXT,annual_fee REAL,crawler_updated_at TEXT,updated_at TEXT);
    INSERT INTO fund_basic VALUES('000001.SZ','000001','场内',NULL,NULL,NULL,NULL),('000001.OF','000001','场外',NULL,'债券型','---',NULL);
    INSERT INTO fund_meta VALUES('000001.SZ','tushare',NULL,NULL,NULL,NULL,0.03,'old',NULL),('000001.OF','tushare',NULL,'债券型',NULL,NULL,0.01,'old',NULL);`);
  assert.deepEqual(selectBasicGaps(db).map(r=>r.ts_code),['000001.OF']);
  const info={fundManager:'公司',fundType:'错误覆盖',performanceBenchmark:'---',establishmentDate:'2026-09-01'};
  assert.equal(applyBasicInfoPatch(db,'000001',info).length,2);
  assert.deepEqual(applyBasicInfoPatch(db,'000001',info),[]);
  const of=db.prepare("SELECT * FROM fund_meta WHERE ts_code='000001.OF'").get();
  assert.equal(of.management_crawler,'公司'); assert.equal(of.fund_type_crawler,'债券型');
  assert.equal(of.annual_fee,0.01);assert.equal(of.crawler_updated_at,'old');assert.equal(of.source,'tushare');
  assert.equal(db.prepare("SELECT management FROM fund_basic WHERE ts_code='000001.OF'").get().management,null);
  assert.equal(db.prepare("SELECT management_crawler FROM fund_meta WHERE ts_code='000001.SZ'").get().management_crawler,null);
  assert.throws(()=>applyBasicInfoPatch(db,'000002',info),/Missing .OF/);
  assert.throws(()=>applyBasicInfoPatch(db,'000001.SZ',info),/six-digit/);
  db.close();
});

test('Mutual-recognition basics use the overseas page and company label, keeping manager and currency distinct',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async url=>{
      assert.equal(url,'https://overseas.1234567.com.cn/f10/FundBaseInfo/968001');
      return new Response('<table><tr><th>基金名称</th><td>亚洲债券人民币份额</td></tr><tr><th>基金公司</th><td>境外基金公司</td></tr><tr><th>基金经理</th><td>经理姓名</td></tr><tr><th>基金类型</th><td>债券型</td><th>成立日期</th><td>2016-01-11</td></tr><tr><th>基准指数</th><td>全球债券指数</td></tr><tr><th>基金规模</th><td>23.96亿美元</td></tr></table>');
    };
    const info=await fetchFundBasicInfo('968001',{strict:true});
    assert.equal(info.fundManager,'境外基金公司');assert.equal(info.fundType,'债券型');
    assert.equal(info.establishmentDate,'2016-01-11');assert.equal(info.performanceBenchmark,'全球债券指数');
    assert.equal(info.netAssetScale,null);
  } finally {globalThis.fetch=original;}
});

test('Strict basic-info fetch distinguishes HTTP and empty-page failures from valid fields',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response('busy',{status:503});
    await assert.rejects(fetchFundBasicInfo('000001',{strict:true}),/HTTP 503/);
    assert.equal((await fetchFundBasicInfo('000001')).fundManager,'');
    globalThis.fetch=async()=>new Response('<html>empty page</html>');
    await assert.rejects(fetchFundBasicInfo('000001',{strict:true}),/fields absent/);
    globalThis.fetch=async()=>new Response('<table><tr><th>基金管理人</th><td><a>公司</a></td><th>基金类型</th><td>债券型</td></tr></table>');
    const result=await fetchFundBasicInfo('000001',{strict:true});
    assert.equal(result.fundManager,'公司');assert.equal(result.fundType,'债券型');
  } finally {globalThis.fetch=original;}
});
