#!/usr/bin/env node
/** Eastmoney mutual-recognition NAV gap fill (968xxx.OF).
 * Provider: FundJz/<code>, its MethodJZ action=2 endpoint. This endpoint was
 * verified to return 1,000 rows/page; the domestic lsjz limit remains 20.
 * Units stay in the share's original currency. No inferred adjusted NAV.
 * Usage: node scripts/nav/crawl-overseas-nav.js --run-dir data/repair-YYYYMMDD [--resume]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {getDb,closeDb,logSync} from './db.js';

const ORIGIN='https://overseas.1234567.com.cn';
const PAGE_SIZE=1000;

export function overseasInternalCode(html,code) {
  if(!/^968\d{3}$/.test(code)) throw new Error('Expected 968xxx fund code');
  const pageCode=html.match(/\bfcode\s*=\s*['"](\d+)['"]/)?.[1];
  const internal=html.match(/\bapiurl\s*=\s*['"][^'"]*\?api=HKFDApi&m=MethodJZ&hkfcode=(\d+)['"]/)?.[1];
  if(pageCode!==code || !internal) throw new Error(`Overseas page identity missing or mismatched: ${code}`);
  return internal;
}

export function normalizeOverseasNav(raw,code,internal) {
  const dates=new Set(), currencies=new Set();
  let missingCurrencyRows=0;
  const records=raw.map(r=>{
    if(String(r.FCODE)!==code || String(r.HKFCODE)!==internal) throw new Error('Overseas NAV identity mismatch');
    const date=String(r.PDATE||'');
    const parsed=new Date(`${date}T00:00:00Z`);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date) throw new Error('Invalid overseas NAV date');
    if(dates.has(date)) throw new Error('Duplicate overseas NAV date');dates.add(date);
    const unit=Number(r.NAV), accum=r.ACCNAV==null||String(r.ACCNAV).trim()===''?null:Number(r.ACCNAV);
    if(!(unit>0)||!Number.isFinite(unit)||(accum!==null&&(!(accum>0)||!Number.isFinite(accum)))) throw new Error('Invalid overseas NAV value');
    if(r.CURRENCY) currencies.add(r.CURRENCY); else missingCurrencyRows++;
    return {ts_code:`${code}.OF`,end_date:date.replaceAll('-',''),unit_nav:unit,accum_nav:accum,adj_nav:null,source:2};
  }).sort((a,b)=>a.end_date.localeCompare(b.end_date));
  if(currencies.size>1) throw new Error('Overseas share currency changed within history');
  return {records,currency:missingCurrencyRows?null:([...currencies][0]||null),missingCurrencyRows};
}

export function insertOverseasNav(db,records) {
  const stmt=db.prepare(`INSERT INTO fund_nav(ts_code,end_date,unit_nav,accum_nav,adj_nav,source)
    VALUES(@ts_code,@end_date,@unit_nav,@accum_nav,@adj_nav,@source) ON CONFLICT(ts_code,end_date) DO NOTHING`);
  return db.transaction(()=>records.reduce((n,r)=>n+stmt.run(r).changes,0))();
}

async function main() {
  const args=process.argv.slice(2),at=args.indexOf('--run-dir');
  if(at<0||!args[at+1]||args[at+1].startsWith('--'))throw new Error('--run-dir required');
  const dir=path.resolve(args[at+1],'overseas-nav');fs.mkdirSync(dir,{recursive:true});
  const statusPath=path.join(dir,'status.json');
  const db=getDb();
  try {
    const state=args.includes('--resume')?JSON.parse(fs.readFileSync(statusPath,'utf8')):{startedAt:new Date().toISOString(),
      targets:db.prepare(`SELECT b.code,b.name FROM fund_basic b WHERE b.ts_code LIKE '968%.OF'
        AND length(b.code)=6 AND COALESCE(b.fund_type,'')<>'' AND b.fund_type NOT LIKE '%货币%'
        AND NOT EXISTS(SELECT 1 FROM fund_nav n WHERE n.ts_code=b.ts_code) ORDER BY b.code`).all(),results:[]};
    const done=new Set(state.results.filter(r=>r.status!=='error').map(r=>r.code));
    state.results=state.results.filter(r=>r.status!=='error');
    const targets=state.targets.filter(r=>!done.has(r.code));
    const save=()=>{state.updatedAt=new Date().toISOString();fs.writeFileSync(`${statusPath}.tmp`,JSON.stringify(state,null,2));fs.renameSync(`${statusPath}.tmp`,statusPath);};
    let cursor=0,nextSlot=0;
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    async function request(url) {
      for(let attempt=0;attempt<3;attempt++) {
        const now=Date.now(),slot=Math.max(now,nextSlot);nextSlot=slot+100;if(slot>now)await wait(slot-now);
        try {const res=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!res.ok)throw new Error(`Overseas HTTP ${res.status}`);return await res.text();}
        catch(e){if(attempt===2)throw e;await wait(1000*(attempt+1));}
      }
    }
    async function worker() {
      while(cursor<targets.length) {
        const {code}=targets[cursor++],startedAt=new Date().toISOString();
        try {
          const html=await request(`${ORIGIN}/f10/FundJz/${code}`);
          const internal=overseasInternalCode(html,code);
          const raw=[];let total=null;
          for(let page=0;total===null||raw.length<total;page++) {
            const params=new URLSearchParams({api:'HKFDApi',m:'MethodJZ',hkfcode:internal,action:'2',pageindex:String(page),pagesize:String(PAGE_SIZE),date1:'',date2:''});
            const response=JSON.parse(await request(`${ORIGIN}/overseasapi/OpenApiHander.ashx?${params}`));
            fs.writeFileSync(path.join(dir,`${code}-${page}.json`),JSON.stringify({at:new Date().toISOString(),params:Object.fromEntries(params),response}));
            if(String(response.Code)!=='1'||!Array.isArray(response.Data)||!Number.isInteger(response.TotalCount)||response.TotalCount<0)throw new Error('Invalid overseas NAV response');
            if(total!==null&&total!==response.TotalCount)throw new Error('Overseas total changed during pagination');
            total=response.TotalCount;
            if(response.Data.length!==Math.min(PAGE_SIZE,total-raw.length))throw new Error('Incomplete overseas NAV page');
            raw.push(...response.Data);
          }
          const {records,currency,missingCurrencyRows}=normalizeOverseasNav(raw,code,internal);
          const inserted=insertOverseasNav(db,records);
          state.results.push({code,status:records.length?'success':'empty',currency,missingCurrencyRows,returned:records.length,inserted,first:records[0]?.end_date,last:records.at(-1)?.end_date});
          logSync({ts_code:`${code}.OF`,api_name:'eastmoney_overseas_nav',status:'success',record_count:inserted,started_at:startedAt,finished_at:new Date().toISOString()});
        }catch(error){
          state.results.push({code,status:'error',error:error.message});
          logSync({ts_code:`${code}.OF`,api_name:'eastmoney_overseas_nav',status:'error',error_message:error.message,started_at:startedAt,finished_at:new Date().toISOString()});
        }
        save();if(state.results.length%10===0||cursor===targets.length)console.log(`${state.results.length}/${state.targets.length}: ${state.results.filter(r=>r.status==='success').length} with NAV`);
      }
    }
    save();const workers=await Promise.allSettled(Array.from({length:3},worker));
    const failure=workers.find(r=>r.status==='rejected');if(failure)throw failure.reason;
    state.finishedAt=new Date().toISOString();save();
    console.log(JSON.stringify({funds:state.results.length,success:state.results.filter(r=>r.status==='success').length,errors:state.results.filter(r=>r.status==='error').length,inserted:state.results.reduce((n,r)=>n+(r.inserted||0),0)}));
    if(state.results.some(r=>r.status==='error'))process.exitCode=1;
  }finally{closeDb();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
