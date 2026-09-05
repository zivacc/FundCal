/** Read-only local DB baseline. No migrations, ETL, network or portfolio records. */
import Database from 'better-sqlite3';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseListParams, buildListQuery } from '../../../scripts/list-query.js';
import { pinyin } from 'pinyin-pro';
import { findAllCrossovers } from '../../../js/domain/fee-calculator.js';
const db = new Database(fileURLToPath(new URL('../../../data/fundcal.db', import.meta.url)), {readonly:true,fileMustExist:true});
const result = { generatedAt:new Date().toISOString(), node:process.version, note:'Five serial samples per query; local OS/SQLite caches may already be warm. Not HTTP p95 or browser timing.', counts:{}, queries:[] };
function measure(name, work, plan) {
  const ms = [];
  for (let i=0;i<5;i++) {const t=performance.now();work();ms.push(+(performance.now()-t).toFixed(2));}
  result.queries.push({name,ms,medianMs:[...ms].sort((a,b)=>a-b)[2],...(plan?{plan}: {})});
}
try {
  for (const table of ['fund_basic','fund_meta','fund_nav','fund_fee_segments','fund_stage_returns','index_basic','index_daily','index_fund_tracker','sync_log','morningstar_fee_snapshot','morningstar_fund_fee'])
    result.counts[table] = db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  result.suffix = db.prepare('SELECT substr(ts_code,-3) suffix,count(*) n FROM fund_basic GROUP BY suffix').all();
  result.metaDuplicates = db.prepare('SELECT count(*) n FROM (SELECT code FROM fund_meta GROUP BY code HAVING count(*)>1)').get().n;
  result.crawlerDuplicateCodes = db.prepare("SELECT count(*) n FROM (SELECT code FROM fund_meta WHERE source IN ('crawler','both') GROUP BY code HAVING count(*)>1)").get().n;
  result.crawlerOnExchange = db.prepare("SELECT count(*) n FROM fund_meta WHERE source IN ('crawler','both') AND ts_code NOT LIKE '%.OF'").get().n;
  result.feeMissing = db.prepare("SELECT count(*) total,sum(buy_fee IS NULL) missingBuy,sum(annual_fee IS NULL) missingAnnual FROM fund_meta WHERE source IN ('crawler','both')").get();
  result.feeTotalMismatch = db.prepare('SELECT count(*) n FROM fund_meta WHERE ABS(operation_fee_total-COALESCE(mgmt_fee,0)-COALESCE(custody_fee,0)-COALESCE(sales_service_fee,0)) > 0.0000001').get().n;
  result.arbitrationMismatch = db.prepare("SELECT sum(NULLIF(m.name_crawler,'') IS NOT NULL AND b.name != m.name_crawler) name,sum(NULLIF(m.fund_type_crawler,'') IS NOT NULL AND b.fund_type != m.fund_type_crawler) type FROM fund_meta m JOIN fund_basic b USING(ts_code)").get();
  result.navRange = db.prepare('SELECT min(end_date) first,max(end_date) last FROM fund_nav').get();
  const cutoff = new Date(Date.now()-7*86400000).toISOString().slice(0,10).replaceAll('-','');
  const latest = db.prepare(`SELECT b.ts_code,b.status,(SELECT end_date FROM fund_nav n WHERE n.ts_code=b.ts_code ORDER BY end_date DESC LIMIT 1) latest,
    (SELECT source FROM fund_nav n WHERE n.ts_code=b.ts_code ORDER BY end_date DESC LIMIT 1) latestSource
    FROM fund_basic b WHERE b.ts_code LIKE '%.OF' AND b.status='L' AND COALESCE(b.fund_type,'') NOT LIKE '%货币%'`).all();
  result.liveNonMoneyCoverage = {cutoff,total:latest.length,missing:latest.filter(r=>!r.latest).length,stale:latest.filter(r=>r.latest && r.latest<cutoff).length,latestFromEastmoney:latest.filter(r=>r.latestSource===2).length,staleLatestFromEastmoney:latest.filter(r=>r.latestSource===2 && r.latest<cutoff).length};
  result.crawlerAge = db.prepare("SELECT count(*) total,sum(crawler_updated_at < date('now','-30 days')) olderThan30Days,min(crawler_updated_at) oldest,max(crawler_updated_at) latest FROM fund_meta WHERE source IN ('crawler','both')").get();
  result.calendarRange = db.prepare('SELECT min(cal_date) first,max(cal_date) last FROM trade_calendar').get();
  result.untrackedDataIndices = db.prepare("SELECT count(*) n FROM index_basic b WHERE EXISTS(SELECT 1 FROM index_daily d WHERE d.ts_code=b.ts_code) AND NOT EXISTS(SELECT 1 FROM index_fund_tracker t WHERE t.index_ts_code=b.ts_code)").get().n;
  result.schemaIndexes = db.prepare("SELECT name,tbl_name FROM sqlite_master WHERE type='index' AND tbl_name IN ('fund_nav','sync_log')").all();
  const searchRows = db.prepare('SELECT m.code,COALESCE(b.name,m.name_crawler) name FROM fund_meta m LEFT JOIN fund_basic b USING(ts_code)').all();
  const index=searchRows.map(r=>({...r,initials:pinyin(r.name||'',{pattern:'first',toneType:'none',type:'array'}).join('')}));
  for (const [name,qs] of [['listDefault',{page:1}],['listAnnualFee',{page:1,sort:'annualFee:asc'}],['searchCode',{page:1,q:'000001'}],['searchInitials',{page:1,q:'hs300'}],['searchBroad',{page:1,q:'基金'}]]) {
    const p=parseListParams(qs); if(p.q)p.searchIndex=index;
    const sample=buildListQuery(p);
    measure(name,()=>{ const q=buildListQuery(p); db.prepare(q.countSql).get(...q.params);db.prepare(q.sql).all(...q.params); },db.prepare('EXPLAIN QUERY PLAN '+sample.sql).all(...sample.params).map(r=>r.detail));
  }
  const slowStats = 'SELECT count(DISTINCT ts_code) n FROM fund_nav';
  measure('navStatsDistinct',()=>db.prepare(slowStats).get(),db.prepare('EXPLAIN QUERY PLAN '+slowStats).all().map(r=>r.detail));
  const history='SELECT end_date,unit_nav,adj_nav FROM fund_nav WHERE ts_code=? ORDER BY end_date';
  measure('oneFullNavHistory',()=>db.prepare(history).all('000001.OF'),db.prepare('EXPLAIN QUERY PLAN '+history).all('000001.OF').map(r=>r.detail));
  const funds=Array.from({length:20},(_,i)=>({name:`F${i}`,buyFee:i*.0001,annualFee:.003+i*.0002,sellFeeSegments:[{to:7,rate:.015},{to:30,rate:.005},{to:null,rate:0}]}));
  measure('crossovers20Funds7300Days',()=>findAllCrossovers(funds,7300));
  console.log(JSON.stringify(result,null,2));
} finally {db.close();}
