import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { syncConstituents, constituentQuestion } from './sync-index-constituents.js';
import { ensureIndexConstituents, normalizeConstituents, insertConstituentSnapshot } from './index-constituents.js';

const fixture=()=>({data:[
  {columns:[{name:'指数成份数量'}],rows:[[2]]},
  {columns:[{name:'指数成份权重合计',unit:'%'}],rows:[[100]]},
  {columns:[{name:'指数成份代码'},{name:'指数成份简称'},{name:'Wind代码'},{name:'日期'},{name:'2026年9月28日指数成份权重',unit:'%'}],rows:[['000001.SZ','甲','000300.SH','2026-09-28',60],['600000.SH','乙','000300.SH','2026-09-28',40]]},
]});
const normalize=r=>normalizeConstituents(r,'000300.SH','2026-09-28');

test('complete split tables accept identical overlap and preserve raw percentage weights',()=>{
  const r=fixture();r.data.push(structuredClone(r.data[2]));
  const s=normalize(r);assert.equal(s.rows.length,2);assert.equal(s.weightSum,100);assert.equal(s.rows[0].weight_pct,60);
});
test('provider count named 成分个数 is reusable without another Wind request',()=>{
  const r=fixture();r.data[0].columns[0].name='2026年9月28日沪深300指数的成分个数';
  assert.equal(normalize(r).expectedCount,2);
  r.data[0].rows[0][0]=3;
  assert.throws(()=>normalize(r),/Incomplete constituents/);
  r.data[0].rows.push([2]);
  assert.throws(()=>normalize(r),/Missing or conflicting constituent count/);
});
test('incomplete, mixed dates/indexes, missing weights, conflicting duplicates and unknown units fail closed',()=>{
  const changes=[
    r=>r.data[2].rows.pop(),r=>r.data[2].rows[0][3]='2026-09-27',r=>r.data[2].rows[0][3]='2026-09-29',
    r=>r.data[2].rows[0][2]='000905.SH',r=>r.data[2].rows[0][4]=null,r=>r.data[2].rows[0][4]='',
    r=>r.data[2].rows[0][4]=-1,r=>r.data[2].rows[0][4]=59,r=>r.data[2].columns[4].unit='ratio',
    r=>r.data[2].rows.push(['000001.SZ','甲','000300.SH','2026-09-28',55]),
    r=>r.data.shift(),r=>r.data[0].rows[0][0]=1,r=>r.data[1].rows[0][0]=99,
    r=>r.data[0].columns[0].name='2026年9月27日指数成份数量',
  ];
  for(const change of changes){const r=fixture();change(r);assert.throws(()=>normalize(r));}
});
test('schema is idempotent, snapshots atomic and immutable, dates coexist and FK protects index identity',()=>{
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec("CREATE TABLE index_basic(ts_code TEXT PRIMARY KEY); INSERT INTO index_basic VALUES('000300.SH')");
  ensureIndexConstituents(db);ensureIndexConstituents(db);
  const s=normalize(fixture()),meta={receipt:JSON.stringify(fixture()),receiptPath:'data/wind/test.json',fetchedAt:'2026-09-28T08:00:00Z'};
  assert.equal(insertConstituentSnapshot(db,s,meta).inserted,2);assert.equal(insertConstituentSnapshot(db,s,meta).inserted,0);
  const conflict=structuredClone(s);conflict.rows[0].weight_pct=59;conflict.rows[1].weight_pct=41;
  assert.throws(()=>insertConstituentSnapshot(db,conflict,meta),/conflict/);
  assert.throws(()=>insertConstituentSnapshot(db,{...s,indexCode:'UNKNOWN'},meta),/FOREIGN KEY/);
  assert.equal(db.prepare('SELECT count(*) n FROM index_constituent_weight').get().n,2);
  assert.equal(insertConstituentSnapshot(db,{...s,asOfDate:'2026-09-27'},meta).inserted,2);
  assert.throws(()=>insertConstituentSnapshot(db,{...s,rows:s.rows.slice(0,1)},meta));db.close();
});

test('sync rewrites incomplete replies once, persists complete data and resumes without network',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'constituents-'));
  try {
    const dbPath=path.join(dir,'db.sqlite'),runRoot=path.join(dir,'runs');
    const db=new Database(dbPath);db.exec(`CREATE TABLE index_basic(ts_code TEXT PRIMARY KEY,name TEXT);INSERT INTO index_basic VALUES('000300.SH','沪深300');CREATE TABLE index_daily(ts_code TEXT);INSERT INTO index_daily VALUES('000300.SH');CREATE TABLE index_fund_tracker(index_ts_code TEXT);`);db.close();
    let calls=0;const request=async()=>{
      calls++;const response=fixture();if(calls===1)response.data[2].rows.pop();
      return {response,requestedAt:'2026-09-28T08:00:00Z'};
    };
    const opts={end:'2026-09-28',dbPath,runRoot,request};
    const result=await syncConstituents(opts);assert.equal(calls,2);assert.equal(result.results[0].status,'complete');
    await syncConstituents({...opts,resume:true});assert.equal(calls,2);assert.equal(existsSync(path.join(runRoot,'sync.lock')),false);
    assert.notEqual(constituentQuestion('000300.SH',opts.end,null,'沪深300'),constituentQuestion('000300.SH',opts.end,null,'沪深300',true));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('service error stops batch before next entity, saves blocked state and releases lock',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'constituents-'));
  try{
    const dbPath=path.join(dir,'db.sqlite'),runRoot=path.join(dir,'runs');
    const db=new Database(dbPath);db.exec(`CREATE TABLE index_basic(ts_code TEXT PRIMARY KEY,name TEXT);INSERT INTO index_basic VALUES('000300.SH','甲'),('000905.SH','乙');CREATE TABLE index_daily(ts_code TEXT);INSERT INTO index_daily VALUES('000300.SH'),('000905.SH');CREATE TABLE index_fund_tracker(index_ts_code TEXT);`);db.close();
    let calls=0;
    await assert.rejects(syncConstituents({end:'2026-09-28',dbPath,runRoot,request:async()=>{calls++;return {response:{ok:false,code:'AUTH_ERROR',message:'denied'}};}}),/AUTH_ERROR/);
    assert.equal(calls,1);assert.equal(existsSync(path.join(runRoot,'sync.lock')),false);
    assert.equal(JSON.parse(readFileSync(path.join(runRoot,'2026-09-28-all/status.json'),'utf8')).state,'blocked');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
