import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {overseasInternalCode,normalizeOverseasNav,insertOverseasNav} from './crawl-overseas-nav.js';
const raw={FCODE:'968001',HKFCODE:'1234',PDATE:'2026-09-09',NAV:6.76,ACCNAV:'',CURRENCY:'元',NAVCHGRT:0.2};
test('Overseas NAV validates exact share identity, dates, units and leaves unknown adjusted NAV empty',()=>{
  assert.equal(overseasInternalCode('fcode="968001"; apiurl="//overseas.1234567.com.cn/overseasapi/OpenApiHander.ashx?api=HKFDApi&m=MethodJZ&hkfcode=1234";','968001'),'1234');
  assert.throws(()=>overseasInternalCode('fcode="968002";','968001'),/identity/);
  const result=normalizeOverseasNav([raw],'968001','1234');
  assert.equal(result.currency,'元');assert.equal(result.records[0].unit_nav,6.76);
  assert.equal(result.records[0].adj_nav,null);assert.equal(result.records[0].accum_nav,null);
  for(const change of [{FCODE:'968002'},{HKFCODE:'5678'},{PDATE:'2026-02-30'},{NAV:0},{NAV:'bad'},{ACCNAV:'bad'}])assert.throws(()=>normalizeOverseasNav([{...raw,...change}],'968001','1234'));
  const unknown=normalizeOverseasNav([{...raw,CURRENCY:''}],'968001','1234');
  assert.equal(unknown.currency,null);assert.equal(unknown.missingCurrencyRows,1);assert.equal(unknown.records[0].unit_nav,6.76);
  assert.throws(()=>normalizeOverseasNav([raw,raw],'968001','1234'),/Duplicate/);
  assert.throws(()=>normalizeOverseasNav([raw,{...raw,PDATE:'2026-09-08',CURRENCY:'美元'}],'968001','1234'),/currency changed/);
});
test('Overseas gap insert preserves existing observations and is idempotent',()=>{
  const db=new Database(':memory:');db.exec('CREATE TABLE fund_nav(ts_code TEXT,end_date TEXT,unit_nav REAL,accum_nav REAL,adj_nav REAL,source INTEGER,PRIMARY KEY(ts_code,end_date))');
  const rows=normalizeOverseasNav([raw],'968001','1234').records;
  assert.equal(insertOverseasNav(db,rows),1);
  assert.equal(insertOverseasNav(db,[{...rows[0],unit_nav:999,source:1}]),0);
  assert.deepEqual(db.prepare('SELECT unit_nav,adj_nav,source FROM fund_nav').get(),{unit_nav:6.76,adj_nav:null,source:2});db.close();
});
