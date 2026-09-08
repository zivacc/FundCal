import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { windTables, normalizeWindKline, selectTotalReturnCandidates, indexReturnType, insertWindRows, ensureIndexReturnLinks, isUnavailableWindInstrument } from './wind-index-data.js';

const response = rows => ({ content: [{text:JSON.stringify({data:{columns:['TIME','MATCH','OPEN','HIGH','LOW','TURNOVER','VOLUME'].map(name=>({name})),rows,unit:{'TURNOVER 单位：':'元'}},error:null})}],isError:false });

test('Wind dates retain provider day, source and declared units; unknown volume is not guessed',()=>{
  const rows=normalizeWindKline(response([
    ['2026-09-07T00:00:00.000+08:00','101','100','102','99','300','10'],
    ['2026-09-04T00:00:00.000+02:00','100','99','100','98',null,null],
  ]),'h00300.CSI','2026-09-01','2026-09-07');
  assert.deepEqual(rows.map(r=>r.end_date),['20260904','20260907']);
  assert.equal(rows[1].source,4);assert.equal(rows[1].amount,300);assert.equal(rows[1].vol,null);
});
test('Wind invalid, duplicate or out-of-range observations fail before import',()=>{
  assert.equal(isUnavailableWindInstrument(new Error('backend_error: 未识别到有效的金融标的:399906.SZ')),true);
  assert.equal(isUnavailableWindInstrument(new Error('backend_error: 服务暂时不可用，请稍后重试')),false);
  assert.equal(isUnavailableWindInstrument(new Error('AUTH_ERROR')),false);
  const r=['2026-09-07T00:00:00+08:00','100',null,null,null,null,null];
  for(const rows of [[r,r],[[...r.slice(0,1),'bad-number',...r.slice(2)]],[['2026-09-08',...r.slice(1)]],[['2026-02-30',...r.slice(1)]]]) {
    assert.throws(()=>normalizeWindKline(response(rows),'000300.SH','2026-01-01','2026-09-07'));
  }
  assert.throws(()=>windTables({ok:false,code:'AUTH_ERROR',message:'missing'}),/AUTH_ERROR/);
  assert.throws(()=>windTables({content:[{text:JSON.stringify({error:{message:'denied'}})}]}),/denied/);
});
test('Missing Wind closes remain holes while valid observations are retained and omissions audited',()=>{
  const rows=normalizeWindKline(response([
    ['2026-09-04',null,null,null,null,null,null],['2026-09-07','100',null,null,null,null,null],
  ]),'000300.SH','2026-09-01','2026-09-07');
  assert.equal(rows.length,1);assert.equal(rows[0].close,100);
  assert.deepEqual(rows.missingCloseDates,['2026-09-04']);
  assert.throws(()=>normalizeWindKline(response([
    ['2026-09-07',null,null,null,null,null,null],['2026-09-07','100',null,null,null,null,null],
  ]),'000300.SH','2026-09-01','2026-09-07'),/Duplicate/);
});
test('Explicit association and exact full name exclude FX, sector and net-return variants',()=>{
  const base={'Wind代码':'000300.SH','证券全称':'沪深300指数','全收益指数代码':'h00300.CSI;h20748.CSI;h00915.CSI;n00300.CSI'};
  const candidates=[
    {'Wind代码':'H00300.CSI','证券全称':'沪深300全收益指数'},
    {'Wind代码':'h20748.CSI','证券全称':'沪深300美元全收益指数'},
    {'Wind代码':'h00915.CSI','证券全称':'沪深300信息技术全收益指数'},
    {'Wind代码':'n00300.CSI','证券全称':'沪深300净收益指数'},
    {'Wind代码':'OTHER.CSI','证券全称':'沪深300全收益指数'},
  ];
  assert.deepEqual(selectTotalReturnCandidates(base,candidates),[candidates[0]]);
  const self={'Wind代码':'881001.WI','证券全称':'万得全A指数','收益处理方式':'全收益指数','全收益指数代码':'881001.WI'};
  assert.deepEqual(selectTotalReturnCandidates(self,[self]),[self]);
  const hk={'Wind代码':'HSI.HI','证券全称':'恒生指数','全收益指数代码':'HSIRH.HI'};
  const hkReturn={'Wind代码':'HSIRH.HI','证券全称':'恒生指数(总股息累计指数)','收益处理方式':'全收益指数'};
  assert.deepEqual(selectTotalReturnCandidates(hk,[hkReturn]),[hkReturn]);
  assert.deepEqual(selectTotalReturnCandidates(hk,[{...hkReturn,'收益处理方式':'净收益指数'}]),[]);
  const unique={'Wind代码':'399986.SZ','证券全称':'中证银行指数','全收益指数代码':'H20180.CSI','发布机构':'中证指数有限公司','基期':'2004-12-31'};
  const bank={'Wind代码':'H20180.CSI','证券全称':'中证全指银行全收益指数','收益处理方式':'全收益指数','发布机构':'中证指数有限公司','基期':'2004-12-31'};
  assert.deepEqual(selectTotalReturnCandidates(unique,[bank]),[bank]);
  assert.deepEqual(selectTotalReturnCandidates(unique,[{...bank,'证券全称':'中证银行美元全收益指数'}]),[]);
  assert.deepEqual(selectTotalReturnCandidates(unique,[{...bank,'发布机构':'其他公司'}]),[]);
  assert.equal(indexReturnType({'收益处理方式':'全价指数'}),'full_price');
});
test('Wind imports only fill gaps, are idempotent and preserve other sources',()=>{
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE index_basic(ts_code TEXT PRIMARY KEY);
    CREATE TABLE index_daily(ts_code TEXT,end_date TEXT,open REAL,high REAL,low REAL,close REAL,pre_close REAL,pct_chg REAL,vol REAL,amount REAL,source INTEGER,PRIMARY KEY(ts_code,end_date));
    INSERT INTO index_daily(ts_code,end_date,close,source) VALUES('000300.SH','20260904',100,2);`);
  ensureIndexReturnLinks(db);ensureIndexReturnLinks(db);
  const rows=normalizeWindKline(response([
    ['2026-09-04','105',null,null,null,null,null],['2026-09-07','110',null,null,null,null,null],
  ]),'000300.SH','2026-09-01','2026-09-07');
  assert.equal(insertWindRows(db,rows),1);
  assert.equal(insertWindRows(db,rows),0);
  assert.deepEqual(db.prepare('SELECT close,source FROM index_daily ORDER BY end_date').all(),[{close:100,source:2},{close:110,source:4}]);
  db.close();
});
