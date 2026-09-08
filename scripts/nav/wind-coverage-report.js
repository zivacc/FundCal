#!/usr/bin/env node
import Database from 'better-sqlite3';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { indexReturnType, profileMatchesIndex } from '../../js/domain/index-return.js';

export function classifyReturnCoverage({ index, profile, variants = [], coverage, result, end }) {
  const available = variants.filter(v=>v.rows>0);
  if(available.length) return {status:'已有全收益数据',reason:'已核验的关联全收益版本有日线',available};
  if(indexReturnType(profile || index)==='total' && coverage.rows>0) return {status:'已有全收益数据',reason:'该指数本身为全收益指数',available:[{code:index.ts_code,...coverage}]};
  if(variants.length) return {status:'全收益版本存在但缺数据',reason:variants.map(v=>v.reason||'未取得日线').join('；'),available:[]};
  if(!profile) return {status:'指数档案待核验',reason:'Wind档案查询无结果或返回实体不匹配',available:[]};
  if(profile['全收益指数代码']) return {status:'同口径版本待确认',reason:'Wind返回关联代码，但未确认与原指数相同币种和范围',available:[]};
  return {status:'Wind未返回全收益代码',reason:'当前接口的关联字段为空，不能据此断言不存在该版本',available:[]};
}

export function buildWindCoverageReport(db, run) {
  const basics=new Map(db.prepare('SELECT * FROM index_basic').all().map(b=>[b.ts_code,b]));
  const profiles=new Map(run.profiles.map(p=>[p['Wind代码'].toUpperCase(),p]));
  const resultMap=new Map(run.results.map(r=>[r.code,r]));
  const counts=new Map(db.prepare('SELECT ts_code,count(*) rows,min(end_date) first,max(end_date) last FROM index_daily GROUP BY ts_code').all().map(r=>[r.ts_code,r]));
  const empty={rows:0,first:null,last:null};
  const excluded=new Set((run.excluded||[]).map(r=>r.code));
  const resultReason=code=>{
    const r=resultMap.get(code);
    if(!r) return '本轮尚未取得日线';
    if(r.status==='empty') return 'Wind 日线接口返回空表';
    if(r.status==='invalid') return `回执未通过校验：${r.reason}`;
    return r.reason || '未取得可入库的日线';
  };
  const links=new Map();
  for(const r of run.links) {
    if(!links.has(r.index_ts_code)) links.set(r.index_ts_code,new Set());
    links.get(r.index_ts_code).add(r.return_ts_code);
  }
  const stateFor = code => {
    const index=basics.get(code)||{ts_code:code};
    let profile=profiles.get(code.toUpperCase());
    if(profile && !profileMatchesIndex(index,profile)) profile=null;
    const variants=[...(links.get(code)||[])].map(code=>({code,...(counts.get(code)||empty),reason:resultReason(code)}));
    const coverage=counts.get(code)||empty;
    return {code,name:index.name||code,fullname:index.fullname||'',returnType:indexReturnType(profile||index),
      ...coverage,variants:variants.map(v=>v.code),linkedCodes:profile?.['全收益指数代码']||'',
      ...(excluded.has(code)?{status:'非指数标的（不适用）',reason:'该跟踪标的不是指数，本轮不为其匹配指数全收益版本',available:[]}
        :classifyReturnCoverage({index,profile,variants,coverage,result:resultMap.get(code),end:run.end}))};
  };
  const funds=db.prepare(`SELECT b.code,b.ts_code,b.name,b.status,b.management,m.tracking_target,t.index_ts_code
    FROM fund_meta m JOIN fund_basic b ON b.ts_code=m.ts_code
    LEFT JOIN index_fund_tracker t ON t.fund_ts_code=m.ts_code
    WHERE b.ts_code LIKE '%.OF' AND trim(COALESCE(m.tracking_target,''))<>'' AND m.tracking_target NOT LIKE '%无跟踪%'
    ORDER BY b.code,t.index_ts_code`).all();
  const byFund=new Map();
  for(const fund of funds){
    if(!byFund.has(fund.ts_code)) byFund.set(fund.ts_code,{...fund,indices:[]});
    if(fund.index_ts_code) byFund.get(fund.ts_code).indices.push(stateFor(fund.index_ts_code));
  }
  const gaps=[];let covered=0;
  for(const fund of byFund.values()) {
    if(fund.indices.some(x=>x.status==='已有全收益数据')) {covered++;continue;}
    gaps.push({code:fund.code,name:fund.name,fundStatus:fund.status,management:fund.management,trackingTarget:fund.tracking_target,
      indexCodes:fund.indices.map(x=>x.code).join(';'),indexNames:fund.indices.map(x=>x.name).join(';'),
      status:[...new Set(fund.indices.map(x=>x.status))].join(';')||'基金跟踪指数未匹配',
      totalReturnCodes:[...new Set(fund.indices.flatMap(x=>x.variants))].join(';'),
      reason:fund.indices.map(x=>x.reason).join('；')||'本地基金跟踪关系缺失，尚不能判断对应全收益覆盖'});
  }
  const affected=new Map();for(const fund of byFund.values())for(const idx of fund.indices){if(!affected.has(idx.code))affected.set(idx.code,new Set());affected.get(idx.code).add(fund.code);}
  const indices=[...affected].map(([code,funds])=>({...stateFor(code),funds:funds.size})).sort((a,b)=>b.funds-a.funds);
  const categories={};for(const r of gaps)categories[r.status]=(categories[r.status]||0)+1;
  return {generatedAt:new Date().toISOString(),end:run.end,runState:run.state,runError:run.error||null,
    summary:{fundsWithTrackingTarget:byFund.size,coveredFunds:covered,gapFunds:gaps.length,categories,
      insertedRows:run.results.reduce((n,r)=>n+(r.inserted||0),0),successfulIndices:run.results.filter(r=>r.status==='success').length},
    gaps,indices};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const run=JSON.parse(readFileSync(path.join(root,'data/wind/sync-status.json'),'utf8'));
  const db=new Database(path.join(root,'data/fundcal.db'),{readonly:true,fileMustExist:true});
  try{
    const report=buildWindCoverageReport(db,run);
    writeFileSync(path.join(root,'data/wind/fund-coverage-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report.summary,null,2));
  }finally{db.close();}
}
