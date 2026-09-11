#!/usr/bin/env node
/** Fill missing .OF basic-info shadows from Eastmoney, then run apply-merge-rules.
 * Does not refresh fees, stage returns, status or the full-crawl timestamp.
 * Usage: node scripts/nav/repair-fund-basics.js --run-dir data/repair-YYYYMMDD [--resume --retry-empty]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFundBasicInfo } from '../crawl-fund-fee.js';
import { getDb, closeDb } from './db.js';

export const missingBasicValue = v => v == null || /^(?:\s*|-+|暂无|不详)$/.test(String(v).trim());
const fields = [
  ['management', 'management_crawler', 'fundManager'],
  ['fund_type', 'fund_type_crawler', 'fundType'],
  ['benchmark', 'benchmark_crawler', 'performanceBenchmark'],
  ['found_date', 'found_date_crawler', 'establishmentDate'],
];

export function selectBasicGaps(db) {
  return db.prepare(`SELECT b.ts_code,b.code,b.name,b.management,b.fund_type,b.benchmark,b.found_date
    FROM fund_basic b WHERE b.ts_code LIKE '%.OF' ORDER BY b.code`).all()
    .filter(row => fields.some(([basic]) => missingBasicValue(row[basic])));
}

export function applyBasicInfoPatch(db, code, info) {
  if (!/^\d{6}$/.test(code)) throw new Error('Expected six-digit .OF fund code');
  const tsCode = `${code}.OF`;
  return db.transaction(() => {
    const basic = db.prepare('SELECT * FROM fund_basic WHERE ts_code=?').get(tsCode);
    const meta = db.prepare('SELECT * FROM fund_meta WHERE ts_code=?').get(tsCode);
    if (!basic || !meta) throw new Error(`Missing .OF basic/meta row: ${code}`);
    const changes = [];
    for (const [field, shadow, input] of fields) {
      const value = info[input];
      if (!missingBasicValue(basic[field]) || !missingBasicValue(meta[shadow]) || missingBasicValue(value)) continue;
      if (input === 'establishmentDate' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
      db.prepare(`UPDATE fund_meta SET ${shadow}=?, updated_at=datetime('now') WHERE ts_code=?`).run(String(value).trim(), tsCode);
      changes.push({field, value:String(value).trim()});
    }
    // Existing consumers use source=crawler/both as a full fee-crawl marker.
    // A basic-info-only patch must not promote that marker or enable empty fees.
    return changes;
  })();
}

async function main() {
  const args=process.argv.slice(2);
  const at=args.indexOf('--run-dir');
  if(at<0 || !args[at+1] || args[at+1].startsWith('--')) throw new Error('--run-dir is required for private audit receipts');
  const dir=path.resolve(args[at+1]); fs.mkdirSync(dir,{recursive:true});
  const statusPath=path.join(dir,'basic-repair.json');
  const db=getDb();
  try {
    const state=args.includes('--resume') ? JSON.parse(fs.readFileSync(statusPath,'utf8'))
      : {startedAt:new Date().toISOString(),targets:selectBasicGaps(db),results:[]};
    if(args.includes('--retry-empty')) {
      state.previousEmptyAttempts=(state.previousEmptyAttempts||[]).concat(state.results.filter(r=>r.status==='empty_or_failed'));
      state.results=state.results.filter(r=>r.status!=='empty_or_failed');
    }
    const done=new Set(state.results.map(r=>r.code));
    const targets=state.targets.filter(r=>!done.has(r.code));
    const save=()=>{state.updatedAt=new Date().toISOString();fs.writeFileSync(`${statusPath}.tmp`,JSON.stringify(state,null,2));fs.renameSync(`${statusPath}.tmp`,statusPath);};
    save(); let cursor=0, nextSlot=0;
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    async function fetchBasic(code) {
      let info;
      for(let attempt=0;attempt<3;attempt++) {
        const now=Date.now(), slot=Math.max(now,nextSlot);nextSlot=slot+200;
        if(slot>now) await wait(slot-now);
        try { info=await fetchFundBasicInfo(code,{strict:true}); }
        catch(error) {info={error:error.message};}
        if(fields.some(([, ,field])=>!missingBasicValue(info[field]))) return info;
        if(attempt<2) await wait(1000*(attempt+1));
      }
      return info;
    }
    async function worker() {
      while(cursor<targets.length) {
        const row=targets[cursor++];
        if (!/^\d{6}$/.test(row.code)) {
          state.results.push({code:row.code,at:new Date().toISOString(),changes:[],status:'unsupported_code'});
          save(); continue;
        }
        const info=await fetchBasic(row.code);
        const changes=applyBasicInfoPatch(db,row.code,info);
        state.results.push({code:row.code,at:new Date().toISOString(),info,changes,
          status:fields.some(([, ,field])=>!missingBasicValue(info[field]))?'returned':'empty_or_failed'});
        save();
        if(state.results.length%50===0 || cursor===targets.length) console.log(`${state.results.length}/${state.targets.length}: ${state.results.filter(r=>r.changes.length).length} patched`);
      }
    }
    const workers=await Promise.allSettled(Array.from({length:4},worker));
    const failed=workers.find(result=>result.status==='rejected');
    if(failed) throw failed.reason;
    state.finishedAt=new Date().toISOString();save();
    console.log(JSON.stringify({total:state.results.length,patched:state.results.filter(r=>r.changes.length).length,emptyOrFailed:state.results.filter(r=>r.status==='empty_or_failed').length}));
  } finally {closeDb();}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
