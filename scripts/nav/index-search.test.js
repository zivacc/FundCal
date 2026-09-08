import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {buildIndexSearch} from './index-search.js';
import {ensureIndexReturnLinks} from './wind-index-data.js';
import {indexReturnLabel,profileMatchesIndex} from '../../js/domain/index-return.js';
import {classifyReturnCoverage,buildWindCoverageReport} from './wind-coverage-report.js';

test('Index search preserves provider return types and exposes only variants with observations',()=>{
 const db=new Database(':memory:');
 db.exec(`CREATE TABLE index_basic(ts_code TEXT PRIMARY KEY,name TEXT,fullname TEXT,index_type TEXT);
 CREATE TABLE index_daily(ts_code TEXT,end_date TEXT);
 INSERT INTO index_basic VALUES('881001.WI','万得全A','万得全A指数','全收益指数'),('P.SH','价格','价格指数',NULL),('TR.SH','全收益','价格全收益指数',NULL),('EMPTY.SH','全收益缺失','全收益指数',NULL),('B.WI','转债等权','转债等权指数','全价指数');
 INSERT INTO index_daily VALUES('881001.WI','20260907'),('P.SH','20260907'),('TR.SH','20260907'),('B.WI','20260907');`);
 ensureIndexReturnLinks(db);
 db.prepare('INSERT INTO index_return_links VALUES(?,?,?,?)').run('P.SH','TR.SH','wind','2026-09-08');
 db.prepare('INSERT INTO index_return_links VALUES(?,?,?,?)').run('P.SH','EMPTY.SH','wind','2026-09-08');
 const rows=buildIndexSearch(db);
 assert.equal(rows.find(r=>r.code==='881001.WI').returnType,'total');
 assert.equal(rows.find(r=>r.code==='881001.WI').isPrice,false);
 assert.deepEqual(rows.find(r=>r.code==='P.SH').totalReturnCodes,['TR.SH']);
 assert.equal(indexReturnLabel(rows.find(r=>r.code==='B.WI')),'全价');
 assert.equal(rows.some(r=>r.code==='EMPTY.SH'),false);db.close();
});

test('Coverage separates no association, unknown mapping and unavailable data',()=>{
 assert.equal(profileMatchesIndex({ts_code:'NDX.GI',fullname:'Nasdaq-100 Index',name:'纳斯达克100指数'},{'Wind代码':'NDX.GI','证券全称':'纳斯达克100指数'}),true);
 assert.equal(profileMatchesIndex({ts_code:'000692.SH',fullname:'上证科创板新能源主题指数',name:'科创新能'},{'Wind代码':'000692.SH','证券全称':'上证科创板新能源指数','证券简称':'科创新能'}),true);
 assert.equal(profileMatchesIndex({ts_code:'931521.CSI',fullname:'中证高端装备细分50指数',name:'高装细分50'},{'Wind代码':'931521.CSI','证券全称':'中证智选航空航天科技指数'}),false);
 const opts={index:{ts_code:'P.SH',fullname:'价格指数'},coverage:{rows:0},variants:[]};
 assert.equal(classifyReturnCoverage(opts).status,'指数档案待核验');
 assert.equal(classifyReturnCoverage({...opts,profile:{'全收益指数代码':''}}).status,'Wind未返回全收益代码');
 assert.equal(classifyReturnCoverage({...opts,profile:{'全收益指数代码':'X.SH'}}).status,'同口径版本待确认');
 assert.equal(classifyReturnCoverage({...opts,variants:[{code:'X.SH',rows:0}]}).status,'全收益版本存在但缺数据');
 assert.equal(classifyReturnCoverage({...opts,variants:[{code:'X.SH',rows:10}]}).status,'已有全收益数据');
});

test('Fund gap list uses OF shares, deduplicates tracking links and distinguishes unmatched funds',()=>{
 const db=new Database(':memory:');
 db.exec(`CREATE TABLE index_basic(ts_code TEXT PRIMARY KEY,name TEXT,fullname TEXT,index_type TEXT);
 CREATE TABLE index_daily(ts_code TEXT,end_date TEXT);
 CREATE TABLE fund_basic(ts_code TEXT PRIMARY KEY,code TEXT,name TEXT,status TEXT,management TEXT);
 CREATE TABLE fund_meta(ts_code TEXT,tracking_target TEXT);
 CREATE TABLE index_fund_tracker(fund_ts_code TEXT,index_ts_code TEXT);
 INSERT INTO index_basic VALUES('P.SH','价格','价格指数',NULL),('TR.SH','全收益','价格全收益指数','全收益指数'),('Q.SH','其他','其他指数',NULL);
 INSERT INTO index_daily VALUES('TR.SH','20260907');
 INSERT INTO fund_basic VALUES('000001.OF','000001','已覆盖','L','甲'),('000002.OF','000002','无关联','L','甲'),('000003.OF','000003','未匹配','L','乙'),('000004.OF','000004','主动','L','乙'),('000002.SH','000002','场内','L','乙');
 INSERT INTO fund_meta VALUES('000001.OF','价格'),('000002.OF','其他'),('000003.OF','未知'),('000004.OF','无跟踪标的'),('000002.SH','其他');
 INSERT INTO index_fund_tracker VALUES('000001.OF','P.SH'),('000001.OF','Q.SH'),('000002.OF','Q.SH');`);
 const run={end:'2026-09-07',state:'completed',profiles:[{'Wind代码':'P.SH','证券全称':'价格指数'},{'Wind代码':'Q.SH','证券全称':'其他指数'}],results:[],links:[{index_ts_code:'P.SH',return_ts_code:'TR.SH'}]};
 const report=buildWindCoverageReport(db,run);
 assert.equal(report.summary.fundsWithTrackingTarget,3);
 assert.equal(report.summary.coveredFunds,1);
 assert.deepEqual(report.gaps.map(r=>[r.code,r.status]),[['000002','Wind未返回全收益代码'],['000003','基金跟踪指数未匹配']]);
 assert.equal(report.indices.find(r=>r.code==='Q.SH').funds,2);
 const excluded=buildWindCoverageReport(db,{...run,excluded:[{code:'Q.SH'}]});
 assert.equal(excluded.gaps.find(r=>r.code==='000002').status,'非指数标的（不适用）');
 db.close();
});
