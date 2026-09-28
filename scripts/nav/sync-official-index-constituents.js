#!/usr/bin/env node
import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ensureIndexConstituents, insertConstituentSnapshot, validDate } from './index-constituents.js';
import { officialTarget, parseOfficialWeights, downloadOfficialWeights } from './official-index-constituents.js';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const DIR=path.join(ROOT,'data/wind/constituents');
const hash=data=>createHash('sha256').update(data).digest('hex');
const atomic=(file,data)=>{writeFileSync(`${file}.tmp`,JSON.stringify(data,null,2)+'\n');renameSync(`${file}.tmp`,file);};

export async function syncOfficialConstituents({end,codes=null,resume=false,retryIncomplete=false,dryRun=false,dbPath=path.join(ROOT,'data/fundcal.db'),runRoot=DIR,request=downloadOfficialWeights,gapMs=2000}={}) {
  if (!validDate(end)) throw new Error('--end YYYY-MM-DD is required');
  if(!Number.isSafeInteger(gapMs)||gapMs<0||gapMs>60000)throw new Error('Invalid request gap');
  if(retryIncomplete&&!resume)throw new Error('--retry-incomplete requires --resume');
  mkdirSync(runRoot,{recursive:true});
  const lock=path.join(runRoot,'sync.lock'),fd=openSync(lock,'wx');
  writeFileSync(fd,JSON.stringify({pid:process.pid,source:'official',startedAt:new Date().toISOString()}));closeSync(fd);
  let db,state;
  const scopeId=codes?hash(JSON.stringify([...codes].sort())).slice(0,12):'all';
  const runDir=path.join(runRoot,`${end}-official`);
  const statePath=path.join(runDir,`status-${scopeId}${dryRun?'-dry':''}.json`);
  const save=()=>{state.updatedAt=new Date().toISOString();atomic(statePath,state);};
  try {
    mkdirSync(runDir,{recursive:true});
    db=new Database(dbPath,{readonly:dryRun,fileMustExist:true});
    db.pragma('foreign_keys=ON');db.pragma('busy_timeout=5000');
    if (!dryRun) ensureIndexConstituents(db);
    const scope=db.prepare(`SELECT b.ts_code,b.name,b.publisher,
      (SELECT count(*) FROM index_fund_tracker t WHERE t.index_ts_code=b.ts_code) funds
      FROM index_basic b WHERE EXISTS(SELECT 1 FROM index_daily d WHERE d.ts_code=b.ts_code)
      OR EXISTS(SELECT 1 FROM index_fund_tracker t WHERE t.index_ts_code=b.ts_code)
      ORDER BY funds DESC,b.ts_code`).all().filter(r=>! /\.(SGE|NYM|CFX|FX)$/i.test(r.ts_code));
    const selected=codes?codes.map(code=>{
      const row=db.prepare('SELECT ts_code,name,publisher FROM index_basic WHERE upper(ts_code)=?').get(code.toUpperCase());
      if(!row)throw new Error(`Unknown index ${code}`);return row;
    }):scope;
    const targets=selected.map(index=>({...index,target:officialTarget(index)}));
    state=resume?JSON.parse(readFileSync(statePath,'utf8')):{end,dryRun,startedAt:new Date().toISOString(),targets:targets.length,results:[]};
    if(state.end!==end||state.dryRun!==dryRun)throw new Error('Resume scope mismatch');
    if(retryIncomplete) {
      const retry=r=>['incomplete','unsupported'].includes(r.status);
      state.previousResults=[...(state.previousResults||[]),...state.results.filter(retry)];
      state.results=state.results.filter(r=>!retry(r));
    }
    state.state='running';delete state.error;save();
    for (const index of targets) {
      if(state.results.some(r=>r.code===index.ts_code))continue;
      if(!index.target){state.results.push({code:index.ts_code,status:'unsupported'});save();continue;}
      const {source,code,url}=index.target;
      state.pendingCode=index.ts_code;save();
      const rawPath=path.join(runDir,`${source}-${code}.bin`);
      const receiptPath=path.join(runDir,`${source}-${code}.json`);
      let receipt,buffer;
      if(existsSync(receiptPath)) {
        receipt=JSON.parse(readFileSync(receiptPath,'utf8'));buffer=readFileSync(rawPath);
        if(receipt.url!==url||receipt.fileSha256!==hash(buffer))throw new Error('Cached official receipt mismatch');
      } else {
        let downloaded;
        try{downloaded=await request(url);}catch(error){
          if(error.status!==404&&error.status!==410)throw error;
          state.results.push({code:index.ts_code,source,status:'unavailable',reason:error.message});save();
          await delay(gapMs);continue;
        }
        buffer=downloaded.buffer;
        receipt={url,fetchedAt:downloaded.fetchedAt,contentDisposition:downloaded.contentDisposition,fileSha256:hash(buffer),filePath:path.relative(ROOT,rawPath)};
        writeFileSync(rawPath,buffer);atomic(receiptPath,receipt);
        await delay(gapMs);
      }
      let snapshot;
      try{snapshot=parseOfficialWeights(buffer,{indexCode:index.ts_code,source,code,end,contentDisposition:receipt.contentDisposition});}
      catch(error){
        state.results.push({code:index.ts_code,source,status:'incomplete',reason:error.message});save();
        console.log(`[${state.results.length}/${targets.length}] ${index.ts_code} incomplete: ${error.message}`);continue;
      }
      // Conflicts at the same index/date/source are fatal; never hide revisions as gaps.
      const result=dryRun?{inserted:0}:insertConstituentSnapshot(db,snapshot,{source,receipt:readFileSync(receiptPath),receiptPath:path.relative(ROOT,receiptPath),fetchedAt:receipt.fetchedAt});
      state.results.push({code:index.ts_code,name:index.name,source,status:dryRun?'validated':'complete',date:snapshot.asOfDate,count:snapshot.rows.length,weightSum:snapshot.weightSum,inserted:result.inserted});save();
      console.log(`[${state.results.length}/${targets.length}] ${index.ts_code} ${source}: ${snapshot.rows.length} @ ${snapshot.asOfDate}`);
    }
    delete state.pendingCode;
    state.state=state.results.some(r=>!['validated','complete'].includes(r.status))?'completed_with_gaps':'completed';save();return state;
  } catch(error) {
    if(state){state.state='blocked';state.error=error.message;save();}throw error;
  } finally {db?.close();unlinkSync(lock);}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2),options={};
    for(let i=0;i<args.length;i++) {
      if(args[i]==='--end')options.end=args[++i];
      else if(args[i]==='--gap-ms'){
        options.gapMs=Number(args[++i]);
        if(!Number.isSafeInteger(options.gapMs)||options.gapMs<500||options.gapMs>60000)throw new Error('--gap-ms must be 500..60000');
      }
      else if(args[i]==='--codes'){
        options.codes=[...new Set((args[++i]||'').split(',').map(c=>c.trim().toUpperCase()))];
        if(options.codes.some(c=>! /^[A-Z0-9]+\.[A-Z]{2,4}$/.test(c)))throw new Error('Invalid --codes');
      } else if(args[i]==='--resume')options.resume=true;
      else if(args[i]==='--retry-incomplete')options.retryIncomplete=true;
      else if(args[i]==='--dry-run')options.dryRun=true;
      else throw new Error(`Unknown argument ${args[i]}`);
    }
    const state=await syncOfficialConstituents(options);
    console.log(JSON.stringify({state:state.state,targets:state.targets,processed:state.results.length}));
    if(state.state==='completed_with_gaps')process.exitCode=2;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
