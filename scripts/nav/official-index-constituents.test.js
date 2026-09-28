import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import * as XLSX from 'xlsx';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { officialTarget, parseOfficialWeights, downloadOfficialWeights } from './official-index-constituents.js';
import { ensureIndexConstituents, insertConstituentSnapshot } from './index-constituents.js';
import { syncOfficialConstituents } from './sync-official-index-constituents.js';
import { constituentCoverage } from './report-index-constituents.js';

const csi=()=>[
  ['日期Date','指数代码 Index Code','指数名称 Index Name','指数英文名称Index Name(Eng)','成份券代码Constituent Code','成份券名称Constituent Name','成份券英文名称Constituent Name(Eng)','交易所Exchange','交易所英文名称Exchange(Eng)','权重(%)weight'],
  [20260831,'000300','沪深300','CSI300','000001','甲','A','深圳证券交易所','SZSE',60],
  [20260831,'000300','沪深300','CSI300','600000','乙','B','上海证券交易所','SSE',40],
];
const cni=()=>[['日期','样本代码','样本简称','所属行业','总市值(亿元)','权重（%）'],['2026-08-31','302132','甲','工业','123','60.01'],['2026-08-31','600000','乙','金融','123','40.02']];
function workbook(table,type='biff8') {
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(table),'weights');
  return XLSX.write(book,{type:'buffer',bookType:type});
}
const opts={source:'csindex',code:'000300',indexCode:'000300.SH',end:'2026-09-28'};
const parse=table=>parseOfficialWeights(workbook(table),opts);
function dbSetup(file=':memory:') {
  const db=new Database(file);db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE index_basic(ts_code TEXT PRIMARY KEY,name TEXT,publisher TEXT);
    INSERT INTO index_basic VALUES('000300.SH','沪深300','中证指数有限公司'),('000905.SH','中证500','中证指数有限公司');
    CREATE TABLE index_daily(ts_code TEXT);INSERT INTO index_daily VALUES('000300.SH'),('000905.SH');
    CREATE TABLE index_fund_tracker(index_ts_code TEXT);`);return db;
}

test('official XLS/XLSX preserve dates, code identity and published rounding without normalization',()=>{
  const s=parse(csi());assert.equal(s.asOfDate,'2026-08-31');assert.equal(s.expectedCount,2);assert.equal(s.rows[0].code,'000001.SZ');
  const n=parseOfficialWeights(workbook(cni(),'xlsx'),{...opts,source:'cnindex',code:'399006',indexCode:'399006.SZ',contentDisposition:'attachment;filename=399006_cons.xlsx'});
  assert.equal(n.rows[0].code,'302132.SZ');assert.equal(n.rows[0].weight_pct,60.01);assert.ok(Math.abs(n.weightSum-100.03)<1e-8);
});
test('wrong identities, partial sums, duplicate codes, missing weights, mixed/future dates and unsupported exchanges fail closed',()=>{
  const changes=[t=>t.pop(),t=>t[1][1]='000905',t=>t[1][0]=20260929,t=>t[1][0]=20260830,t=>t[1][9]='--',t=>t[1][9]=null,t=>t[1][9]=-1,t=>t[1][7]='UNKNOWN',t=>t.push(t[1]),t=>t[0][9]='weight ratio'];
  for(const change of changes){const t=csi();change(t);assert.throws(()=>parse(t));}
  assert.throws(()=>parseOfficialWeights(workbook(cni(),'xlsx'),{...opts,source:'cnindex'}),/identity/);
  assert.throws(()=>parseOfficialWeights(Buffer.from('<html>error</html>'),opts),/Not an XLS/);
});
test('Hong Kong codes normalize to five digits using the file exchange and reject conflicting suffixes',()=>{
  const t=csi();t[1][4]='0020.HK';t[1][7]='香港交易所';
  assert.equal(parse(t).rows[0].code,'00020.HK');
  t[1][7]='上海证券交易所';assert.throws(()=>parse(t),/suffix and exchange/);
  const n=cni();n[1][1]='430047';assert.throws(()=>parseOfficialWeights(workbook(n,'xlsx'),{...opts,source:'cnindex',indexCode:'399006.SZ',code:'399006',contentDisposition:'attachment;filename=399006_cons.xlsx'}),/Unsupported CNI/);
});
test('validation basis migration preserves existing Wind data and defaults it to provider totals',()=>{
  const db=dbSetup();ensureIndexConstituents(db);
  const s=parse(csi());insertConstituentSnapshot(db,{...s,validationBasis:'provider_totals'},{receipt:'old',receiptPath:'old.json',fetchedAt:'2026-09-28T08:00:00Z'});
  db.exec('ALTER TABLE index_constituent_snapshot DROP COLUMN validation_basis');
  ensureIndexConstituents(db);ensureIndexConstituents(db);
  assert.equal(db.prepare('SELECT validation_basis FROM index_constituent_snapshot').get().validation_basis,'provider_totals');
  assert.equal(db.prepare('SELECT count(*) n FROM index_constituent_weight').get().n,2);db.close();
});
test('routing uses issuer and exact code; never borrows constituents for a Wind or return index',()=>{
  assert.equal(officialTarget({ts_code:'8841431.WI',publisher:'万得信息技术股份有限公司'}),null);
  assert.equal(officialTarget({ts_code:'H00300.CSI',publisher:'中证指数有限公司'}).code,'H00300');
  assert.equal(officialTarget({ts_code:'h00300.CSI',publisher:'中证指数有限公司'}).code,'H00300');
  assert.equal(officialTarget({ts_code:'399006.SZ',publisher:'深圳证券交易所'}).source,'cnindex');
});
test('download retries transient failures with a bound but never retries quota/denied/not-found responses',async()=>{
  let calls=0;
  const result=await downloadOfficialWeights('https://example.invalid',{retryDelayMs:0,fetchImpl:async()=>{
    calls++;if(calls===1)throw new DOMException('timeout','TimeoutError');return new Response('file');
  }});assert.equal(calls,2);assert.equal(result.buffer.toString(),'file');
  for(const status of [403,404,429]) {
    calls=0;await assert.rejects(downloadOfficialWeights('https://example.invalid',{retryDelayMs:0,fetchImpl:async()=>{calls++;return new Response('',{status});}}));
    assert.equal(calls,1);
  }
  calls=0;await assert.rejects(downloadOfficialWeights('https://example.invalid',{retryDelayMs:0,fetchImpl:async()=>{calls++;return new Response('',{status:503});}}));assert.equal(calls,3);
});
test('sources coexist, latest dates win over source preference, and same-date official source wins',()=>{
  const db=dbSetup();ensureIndexConstituents(db);ensureIndexConstituents(db);
  const s=parse(csi()),meta={receipt:'test',receiptPath:'test.json',fetchedAt:'2026-09-28T08:00:00Z'};
  insertConstituentSnapshot(db,{...s,validationBasis:'provider_totals'},{...meta,source:'wind'});
  insertConstituentSnapshot(db,s,{...meta,source:'csindex'});
  assert.equal(constituentCoverage(db).covered[0].source,'csindex');
  insertConstituentSnapshot(db,{...s,asOfDate:'2026-09-28',validationBasis:'provider_totals'},meta);
  assert.equal(constituentCoverage(db).covered[0].source,'wind');
  assert.equal(db.prepare('SELECT count(*) n FROM index_constituent_snapshot').get().n,3);
  assert.throws(()=>insertConstituentSnapshot(db,s,{...meta,source:'eastmoney'}),/Invalid source/);db.close();
});
test('dry-run is read-only, live import reuses verified receipt, resume is idempotent and missing files remain gaps',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'official-weights-'));
  try {
    const dbPath=path.join(dir,'db.sqlite'),runRoot=path.join(dir,'runs');dbSetup(dbPath).close();let calls=0;
    const request=async url=>{calls++;if(url.includes('000905')){const e=new Error('HTTP 404');e.status=404;throw e;}return {buffer:workbook(csi()),fetchedAt:'2026-09-28T08:00:00Z',contentDisposition:''};};
    const options={end:opts.end,dbPath,runRoot,request,gapMs:0};
    await syncOfficialConstituents({...options,dryRun:true});
    let db=new Database(dbPath,{readonly:true});assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='index_constituent_snapshot'").get().n,0);db.close();
    await syncOfficialConstituents(options);assert.equal(calls,3);
    await syncOfficialConstituents({...options,resume:true});assert.equal(calls,3);
    db=new Database(dbPath,{readonly:true});assert.equal(db.prepare('SELECT count(*) n FROM index_constituent_weight').get().n,2);db.close();
    assert.equal(existsSync(path.join(runRoot,'sync.lock')),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('rate limits stop the official batch and preserve resumable state',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'official-limit-'));
  try {
    const dbPath=path.join(dir,'db.sqlite'),runRoot=path.join(dir,'runs');dbSetup(dbPath).close();let calls=0;
    await assert.rejects(syncOfficialConstituents({end:opts.end,dbPath,runRoot,gapMs:0,request:async()=>{calls++;const e=new Error('HTTP 429');e.status=429;throw e;}}),/429/);
    assert.equal(calls,1);assert.equal(JSON.parse(readFileSync(path.join(runRoot,opts.end+'-official/status-all.json'))).state,'blocked');
    assert.equal(existsSync(path.join(runRoot,'sync.lock')),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
