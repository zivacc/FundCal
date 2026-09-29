#!/usr/bin/env node
import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { callWindData, windTables } from './wind-index-data.js';
import { ensureIndexConstituents, normalizeConstituents, constituentTotals, insertConstituentSnapshot, validDate } from './index-constituents.js';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const DIR=path.join(ROOT,'data/wind/constituents');
const atomic=(file,data)=>{writeFileSync(`${file}.tmp`,JSON.stringify(data,null,2)+'\n');renameSync(`${file}.tmp`,file);};

export function constituentQuestion(code,end,count=null,name='',rewrite=false) {
  const date=end.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$1年$2月$3日');
  const ranges=count ? Array.from({length:Math.ceil(count/100)},(_,i)=>`${i*100+1}至${Math.min((i+1)*100,count)}`).join('、') : '第1至100、第101至200等，直到返回全部成分';
  return `提取${name}指数（${code}）截至${date}可得最新一期完整成分权重表，只需成分证券标准代码、名称、权重百分比、实际权重日期。${count ? `上一次明细不完整，实际总成分数${count}，请按成分代码升序分成行序号${ranges}的独立明细表，必须按行序号范围筛选后取数，不能重复返回前100行。` : rewrite ? '上次未返回完整数据。请分别查询成分明细及其权重、实际成分数量、全部权重合计，明细超过100行时按代码顺序分为每100行的独立表。' : '需要全部成分，不要TOP100或默认100行限制。如每表限制100行请按成分代码排序分段返回完整明细。'}同时返回实际总成分数与权重合计。缺失权重保留缺失，不估算。若无法返回全量请明确说明限制。`;
}

export async function syncConstituents({end,codes=null,resume=false,retryIncomplete=false,dbPath=path.join(ROOT,'data/fundcal.db'),runRoot=DIR,request=callWindData}={}) {
  if(!validDate(end)) throw new Error('--end YYYY-MM-DD is required');
  if(retryIncomplete&&!resume) throw new Error('--retry-incomplete requires --resume');
  mkdirSync(runRoot,{recursive:true});
  const lock=path.join(runRoot,'sync.lock');
  const fd=openSync(lock,'wx');writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));closeSync(fd);
  let db;
  const scopeId=codes?createHash('sha256').update(JSON.stringify([...codes].sort())).digest('hex').slice(0,12):'all';
  const runDir=path.join(runRoot,`${end}-${scopeId}`);
  const statePath=path.join(runDir,'status.json');
  let state;
  try {
    mkdirSync(runDir,{recursive:true});
    db=new Database(dbPath,{fileMustExist:true});db.pragma('foreign_keys=ON');db.pragma('busy_timeout=5000');
    ensureIndexConstituents(db);
    const scope=db.prepare(`SELECT b.ts_code,b.name,(SELECT count(*) FROM index_fund_tracker t WHERE t.index_ts_code=b.ts_code) funds FROM index_basic b
      WHERE EXISTS(SELECT 1 FROM index_daily d WHERE d.ts_code=b.ts_code) OR EXISTS(SELECT 1 FROM index_fund_tracker t WHERE t.index_ts_code=b.ts_code)
      ORDER BY funds DESC,b.ts_code`).all().filter(r=>! /\.(SGE|NYM|CFX|FX)$/i.test(r.ts_code));
    const targets=codes?codes.map(code=>{
      const row=db.prepare('SELECT ts_code,name FROM index_basic WHERE upper(ts_code)=?').get(code.toUpperCase());
      if(!row)throw new Error(`Unknown index ${code}`);return row;
    }):scope;
    state=resume?JSON.parse(readFileSync(statePath,'utf8')):{end,startedAt:new Date().toISOString(),targets:targets.length,results:[]};
    if(state.end!==end)throw new Error('Resume date mismatch');
    if(retryIncomplete) {
      state.previousResults=[...(state.previousResults||[]),...state.results.filter(r=>r.status==='incomplete')];
      state.results=state.results.filter(r=>r.status!=='incomplete');
    }
    state.state='running';delete state.error;
    const save=()=>{state.updatedAt=new Date().toISOString();atomic(statePath,state);};
    for(const target of targets) {
      if(state.results.some(r=>r.code===target.ts_code))continue;
      const existing=db.prepare("SELECT id,constituent_count,as_of_date FROM index_constituent_snapshot WHERE index_ts_code=? AND as_of_date=? AND source='wind' AND validation='complete'").get(target.ts_code,end);
      if(existing){state.results.push({code:target.ts_code,status:'existing',count:existing.constituent_count,date:existing.as_of_date});save();continue;}
      state.pendingCode=target.ts_code;save();
      // Cache and stop on service/auth/quota errors. Never fan out failed probes.
      const first=await request('analytics_data','get_financial_data',{question:constituentQuestion(target.ts_code,end,null,target.name)});
      windTables(first.response);
      let receipt=first,snapshot;
      try{snapshot=normalizeConstituents(first.response,target.ts_code,end);}catch(error){
        let total;
        try{total=constituentTotals(first.response);}catch{}
        if(!total) {
          // A count-only reply still permits a single targeted rewrite.
          try {
            const counts=windTables(first.response).filter(t=>t.columns.length===1&&t.rows.length===1&&/成[份分].*(数量|总数|个数)|总成[份分]数/.test(t.columns[0].name)).map(t=>t.rows[0][0]);
            if(counts.length===1&&Number.isSafeInteger(counts[0])&&counts[0]>0)total={expectedCount:counts[0]};
          }catch{}
        }
        if(!total || total.expectedCount<=10000){
          const second=await request('analytics_data','get_financial_data',{question:constituentQuestion(target.ts_code,end,total?.expectedCount??null,target.name,true)});
          windTables(second.response);
          receipt={requestedAt:second.requestedAt,first,second};
          // The rewritten request must include its own dated totals; no implicit mixing.
          try{snapshot=normalizeConstituents(second.response,target.ts_code,end);}catch(e){error=e;}
        }
        if(!snapshot){
          const receiptPath=path.join(runDir,`${target.ts_code}.json`);atomic(receiptPath,receipt);
          state.results.push({code:target.ts_code,name:target.name,status:'incomplete',reason:error.message,receiptPath});save();
          console.log(`[${state.results.length}/${targets.length}] ${target.ts_code} incomplete: ${error.message}`);continue;
        }
      }
      const receiptPath=path.join(runDir,`${target.ts_code}.json`);atomic(receiptPath,receipt);
      const result=insertConstituentSnapshot(db,snapshot,{receipt:readFileSync(receiptPath,'utf8'),receiptPath:path.relative(ROOT,receiptPath),fetchedAt:receipt.requestedAt});
      state.results.push({code:target.ts_code,name:target.name,status:'complete',date:snapshot.asOfDate,count:snapshot.rows.length,weightSum:snapshot.weightSum,inserted:result.inserted});save();
      console.log(`[${state.results.length}/${targets.length}] ${target.ts_code} complete: ${snapshot.rows.length}`);
    }
    delete state.pendingCode;state.state=state.results.some(r=>r.status==='incomplete')?'completed_with_gaps':'completed';save();return state;
  }catch(error){if(state){state.state='blocked';state.error=error.message;state.updatedAt=new Date().toISOString();atomic(statePath,state);}throw error;
  }finally{db?.close();unlinkSync(lock);}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);const options={};
  try{
    for(let i=0;i<args.length;i++){
      if(args[i]==='--end') options.end=args[++i];
      else if(args[i]==='--codes'){options.codes=[...new Set((args[++i]||'').split(',').map(s=>s.trim().toUpperCase()))];if(options.codes.some(c=>! /^[A-Z0-9]+\.[A-Z]{2,4}$/.test(c)))throw new Error('Invalid --codes');}
      else if(args[i]==='--resume')options.resume=true;
      else if(args[i]==='--retry-incomplete')options.retryIncomplete=true;
      else throw new Error(`Unknown argument: ${args[i]}`);
    }
    const state=await syncConstituents(options);
    console.log(JSON.stringify({state:state.state,targets:state.targets,processed:state.results.length}));
    if(state.state==='completed_with_gaps')process.exitCode=2;
  }catch(e){console.error(e.message);process.exitCode=1;}
}
