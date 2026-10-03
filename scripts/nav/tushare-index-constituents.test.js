import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {normalizeTushareConstituents} from './tushare-index-constituents.js';
import {ensureIndexConstituents,insertConstituentSnapshot} from './index-constituents.js';
import {constituentCoverage} from './report-index-constituents.js';

const receipt=(items=[['H30000.CSI','000001.SZ','20260831',60],['H30000.CSI','600000.SH','20260831',40]])=>({httpStatus:200,request:{api_name:'index_weight',params:{index_code:'H30000.CSI',start_date:'20260801',end_date:'20260831'}},response:{code:0,data:{fields:['index_code','con_code','trade_date','weight'],items}}});
const terminal=()=>({httpStatus:200,request:{api_name:'index_weight',params:{index_code:'H30000.CSI',trade_date:'20260831',offset:2,limit:1}},response:{code:0,data:{fields:[],items:[]}}});
const opts=()=>({indexCode:'h30000.CSI',date:'2026-08-31',names:new Map([['000001.SZ','甲'],['600000.SH','乙']]),terminalReceipt:terminal()});
const meta={source:'tushare',receipt:'cached API evidence',receiptPath:'data/test.json',fetchedAt:'2026-10-03T00:00:00Z'};

test('Tushare keeps exact code/version, percentage values and actual weight date with exhausted pagination evidence',()=>{
 const s=normalizeTushareConstituents(receipt(),opts());
 assert.equal(s.indexCode,'h30000.CSI');assert.equal(s.asOfDate,'2026-08-31');assert.equal(s.validationBasis,'api_full_result');assert.equal(s.weightSum,100);assert.equal(s.expectedCount,2);assert.equal(s.completeness.terminalRows,0);
});
test('Tushare rejects truncation, mismatched pagination, absent names and known omitted zero-weight members',()=>{
 for(const change of [o=>o.terminalReceipt.response.data=receipt().response.data,o=>o.terminalReceipt.request.params.offset=1,o=>o.terminalReceipt.request.params.trade_date='20260930',o=>o.terminalReceipt.request.params.index_code='H30000CNY01.CSI',o=>o.names.delete('000001.SZ'),o=>o.knownConstituentCodes=['000001.SZ','600000.SH','600001.SH']]){const o=opts();change(o);assert.throws(()=>normalizeTushareConstituents(receipt(),o));}
});
test('Tushare rejects malformed tables, wrong index/date, null/invalid weights and duplicate identities',()=>{
 for(const change of [r=>r.response.code=-1,r=>r.httpStatus=429,r=>r.response.data.items[0][0]='H30000CNY01.CSI',r=>r.response.data.items[0][2]='20260930',r=>r.response.data.items[0][3]=null,r=>r.response.data.items[0][3]='60',r=>r.response.data.items[0][3]=59,r=>r.response.data.items[0][1]='PDD',r=>r.response.data.items.push(r.response.data.items[0]),r=>r.response.data.fields.push('weight')]){const r=receipt();change(r);assert.throws(()=>normalizeTushareConstituents(r,opts()));}
});
test('legacy CHECK migration preserves populated parent and child rows, custom indexes, triggers and FK enforcement',()=>{
 const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec("CREATE TABLE index_basic(ts_code TEXT PRIMARY KEY);INSERT INTO index_basic VALUES('h30000.CSI');");ensureIndexConstituents(db);
 const schemas=db.prepare("SELECT name,sql FROM sqlite_master WHERE name IN ('index_constituent_snapshot','index_constituent_weight')").all();
 db.exec('DROP TABLE index_constituent_weight;DROP TABLE index_constituent_snapshot');
 for(const schema of schemas.sort((a,b)=>a.name.localeCompare(b.name)))db.exec(schema.sql.replace(",'api_full_result'",''));
 const s=normalizeTushareConstituents(receipt(),opts());
 insertConstituentSnapshot(db,{...s,validationBasis:'provider_totals'},{...meta,source:'wind'});
 db.exec('CREATE INDEX test_custom_snapshot ON index_constituent_snapshot(source); CREATE TRIGGER test_snapshot_trigger AFTER INSERT ON index_constituent_snapshot BEGIN SELECT 1; END;');
 const before=db.prepare('SELECT * FROM index_constituent_snapshot').all(),weights=db.prepare('SELECT * FROM index_constituent_weight').all();
 ensureIndexConstituents(db);ensureIndexConstituents(db);
 assert.deepEqual(db.prepare('SELECT * FROM index_constituent_snapshot').all(),before);assert.deepEqual(db.prepare('SELECT * FROM index_constituent_weight').all(),weights);assert.equal(db.pragma('foreign_keys',{simple:true}),1);assert.deepEqual(db.pragma('foreign_key_check'),[]);
 assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('test_custom_snapshot','test_snapshot_trigger')").get().n,2);
 assert.equal(insertConstituentSnapshot(db,s,meta).inserted,2);assert.equal(insertConstituentSnapshot(db,s,meta).inserted,0);
 assert.throws(()=>insertConstituentSnapshot(db,{...s,completeness:null},meta),/completeness evidence/);
 assert.throws(()=>insertConstituentSnapshot(db,{...s,validationBasis:'official_full_file'},meta),/source or validation basis/);
 assert.throws(()=>insertConstituentSnapshot(db,{...s,indexCode:'UNKNOWN'},meta),/FOREIGN KEY/);
 const changed=structuredClone(s);changed.rows[0].weight_pct=59;changed.rows[1].weight_pct=41;assert.throws(()=>insertConstituentSnapshot(db,changed,meta),/conflict/);
 db.close();
});

test('coverage keeps latest date priority, with official then Tushare then Wind on the same date',()=>{
 const db=new Database(':memory:');db.exec("CREATE TABLE index_basic(ts_code TEXT PRIMARY KEY,name TEXT);INSERT INTO index_basic VALUES('h30000.CSI','甲');CREATE TABLE index_daily(ts_code TEXT);INSERT INTO index_daily VALUES('h30000.CSI');CREATE TABLE index_fund_tracker(index_ts_code TEXT);");ensureIndexConstituents(db);
 const s=normalizeTushareConstituents(receipt(),opts());
 insertConstituentSnapshot(db,{...s,validationBasis:'provider_totals'},{...meta,source:'wind'});
 insertConstituentSnapshot(db,s,meta);assert.equal(constituentCoverage(db).covered[0].source,'tushare');
 insertConstituentSnapshot(db,{...s,validationBasis:'official_full_file'},{...meta,source:'csindex'});assert.equal(constituentCoverage(db).covered[0].source,'csindex');
 insertConstituentSnapshot(db,{...s,asOfDate:'2026-09-01',validationBasis:'provider_totals'},{...meta,source:'wind'});assert.equal(constituentCoverage(db).covered[0].source,'wind');db.close();
});
