#!/usr/bin/env node
/** Wind index supplementation; receipts and progress stay private in data/wind.
 * node scripts/nav/sync-wind-index.js --end 2026-09-07 [--discover-only]
 * Scope: indices with daily history or tracked by funds, plus three requested Wind indices.
 */
import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { profileMatchesIndex } from '../../js/domain/index-return.js';
import { callWindIndex, windTables, normalizeWindKline, indexReturnType,
  selectTotalReturnCandidates, ensureIndexReturnLinks, insertWindRows, isUnavailableWindInstrument } from './wind-index-data.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIR = path.join(ROOT, 'data/wind');
const key = value => String(value || '').toUpperCase();
const iso = value => /^\d{8}$/.test(value || '') ? `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}` : null;

export async function syncWindIndices({ end, discoverOnly = false, resume = false, retryInvalid = false } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end || '') || new Date(`${end}T00:00:00Z`).toISOString().slice(0,10) !== end) throw new Error('Explicit --end YYYY-MM-DD is required');
  mkdirSync(DIR, { recursive: true });
  const db = new Database(path.join(ROOT, 'data/fundcal.db'), { readonly: true, fileMustExist: true });
  const basics = db.prepare('SELECT * FROM index_basic').all();
  const scope = db.prepare(`SELECT b.*, count(d.end_date) n, min(d.end_date) first, max(d.end_date) last,
    (SELECT count(*) FROM index_fund_tracker t WHERE t.index_ts_code=b.ts_code) funds
    FROM index_basic b LEFT JOIN index_daily d ON d.ts_code=b.ts_code
    GROUP BY b.ts_code HAVING n>0 OR funds>0 ORDER BY funds DESC, n DESC`).all();
  db.close();
  const byCode = new Map(basics.map(b => [key(b.ts_code), b]));
  const profiles = new Map();
  const statusPath = path.join(DIR, 'sync-status.json');
  const status = resume ? JSON.parse(readFileSync(statusPath,'utf8')) : { startedAt: new Date().toISOString(), end, scopeCount: scope.length, state: 'discovering',
    profiles: [], links: [], results: [], missingProfiles: [], unresolvedReturns: [], excluded: [] };
  if(status.end!==end) throw new Error('--resume must use the original --end date');
  if(retryInvalid && !resume) throw new Error('--retry-invalid requires --resume');
  if(retryInvalid) status.results=status.results.filter(r=>r.status!=='invalid');
  if(resume && status.pendingCode && isUnavailableWindInstrument(status.error)) {
    status.results.push({code:status.pendingCode,status:'unavailable',reason:status.error,inserted:0});
  }
  for(const profile of status.profiles) profiles.set(key(profile['Wind代码']),profile);
  status.links=[];status.missingProfiles=[];status.unresolvedReturns=[];status.excluded=[];
  const save = () => {
    status.profiles = [...profiles.values()];
    status.updatedAt = new Date().toISOString();
    const temporary = `${statusPath}.tmp`;
    writeFileSync(temporary, JSON.stringify(status, null, 2));
    // Single writer; readers see a complete snapshot.
    renameSync(temporary,statusPath);
  };
  async function fetchProfiles(codes, label, batchSize = 15) {
    for (let i=0; i<codes.length; i+=batchSize) {
      const batch = codes.slice(i,i+batchSize);
      const receipt = await callWindIndex('get_index_basicinfo', {
        question: `查询以下${batch.length}条指数各自的档案：${batch.join('、')}。每条只返回Wind代码、证券简称、证券全称、发布机构、基期、收益处理方式、全收益指数代码。全收益指数代码作为原指数的关联字段返回，不要展开列举其它相似指数。`,
      });
      for (const table of windTables(receipt.response)) for (const row of table.records) {
        if (!row['Wind代码']) continue;
        const id = key(row['Wind代码']);
        profiles.set(id, { ...profiles.get(id), ...row, verifiedAt: receipt.requestedAt });
      }
      console.log(`[${label}] ${Math.min(i+batchSize,codes.length)}/${codes.length}, profiles=${profiles.size}`);
      save();
    }
  }
  let writer;
  try {
    // Standard codes verified by the earlier Wind basic-info receipts.
    if(!resume) await fetchProfiles(['881001.WI','8841431.WI','889033.WI'], 'Wind特色');
    const eligible = scope.filter(b => {
      if (/\.(SGE|NYM|CFX|FX)$/i.test(b.ts_code)) { status.excluded.push({ code:b.ts_code, name:b.name, reason:'非指数标的，不走指数服务' }); return false; }
      return true;
    });
    if(!resume) {
    await fetchProfiles(eligible.map(b=>b.ts_code), '现有指数档案');
    // A mixed batch can return no results even when some of its entities exist.
    // Retry the omitted entities individually once, keeping the same requested fields.
    await fetchProfiles(eligible.filter(b=>!profiles.has(key(b.ts_code))).map(b=>b.ts_code), '缺失档案单只核验', 1);
    const candidateCodes = new Set();
    for (const b of eligible) {
      const profile = profiles.get(key(b.ts_code));
      if (!profile?.['证券全称']) { status.missingProfiles.push(b.ts_code); continue; }
      for (const code of String(profile['全收益指数代码'] || '').split(/[;,；]/).filter(Boolean)) {
        const candidate = byCode.get(key(code));
        if (candidate && selectTotalReturnCandidates(profile, [{ 'Wind代码':code,'证券全称':candidate.fullname,'证券简称':candidate.name }]).length) candidateCodes.add(code);
      }
      // For a small linked set, inspect every returned code including variants absent locally.
      const linked = String(profile['全收益指数代码'] || '').split(/[;,；]/).filter(Boolean);
      if (linked.length <= 3) for (const code of linked) candidateCodes.add(code);
    }
    await fetchProfiles([...candidateCodes].filter(c=>!profiles.has(key(c))), '全收益档案');
    }
    const targets = new Map();
    const addTarget = profile => {
      const existing = byCode.get(key(profile['Wind代码']));
      const code = existing?.ts_code || profile['Wind代码'];
      targets.set(code, { code, profile, existing });
      return code;
    };
    for (const b of eligible) {
      const profile = profiles.get(key(b.ts_code));
      if (!profile?.['证券全称']) continue;
      // Refuse entity substitutions. Market aliases are accepted only under an exact full name.
      if (!profileMatchesIndex(b,profile)) {
        status.missingProfiles.push(b.ts_code);
        continue;
      }
      addTarget(profile);
      const returns = selectTotalReturnCandidates(profile, [...profiles.values()]);
      if (!returns.length) status.unresolvedReturns.push({ code:b.ts_code,name:b.name,returnType:indexReturnType(profile),linkedCodes:profile['全收益指数代码'] || '', reason:profile['全收益指数代码'] ? '有关联代码，但尚未确认同口径版本' : 'Wind档案未返回关联全收益代码' });
      for (const variant of returns) {
        const returnCode = addTarget(variant);
        status.links.push({ index_ts_code:b.ts_code, return_ts_code:returnCode, verified_at:profile.verifiedAt });
      }
    }
    for (const profile of profiles.values()) {
      if (['881001.WI','8841431.WI','889033.WI'].includes(key(profile['Wind代码']))) {
        const code=addTarget(profile);
        if (indexReturnType(profile)==='total') status.links.push({index_ts_code:code,return_ts_code:code,verified_at:profile.verifiedAt});
      }
    }
    status.targetCount=targets.size;
    status.state=discoverOnly?'discovered':'syncing';
    delete status.error;
    save();
    if (discoverOnly) return status;
    writer = new Database(path.join(ROOT, 'data/fundcal.db'), { fileMustExist: true });
    writer.pragma('foreign_keys=ON');
    writer.pragma('busy_timeout=5000');
    ensureIndexReturnLinks(writer);
    const register=writer.prepare(`INSERT INTO index_basic(ts_code,code,name,fullname,publisher,base_date,index_type,primary_source)
      VALUES(@code,@shortCode,@name,@fullname,@publisher,@baseDate,@returnType,'wind')
      ON CONFLICT(ts_code) DO UPDATE SET index_type=excluded.index_type,updated_at=datetime('now')`);
    const source=writer.prepare(`INSERT INTO index_source_map(ts_code,source,source_code,notes) VALUES(?,'wind',?,?)
      ON CONFLICT(ts_code,source) DO UPDATE SET source_code=excluded.source_code,notes=excluded.notes,updated_at=datetime('now')`);
    let n=0;
    for (const target of targets.values()) {
      const {code, profile, existing}=target;
      if(resume && status.results.some(r=>r.code===code)) continue;
      const current=writer.prepare('SELECT min(end_date) first,max(end_date) last FROM index_daily WHERE ts_code=?').get(code);
      const begin=[iso(existing?.base_date), iso(current.first), String(profile['基期'] || '').slice(0,10)].filter(v=>/^\d{4}-\d{2}-\d{2}$/.test(v)).sort()[0] || '1990-01-01';
      if (begin>end) { status.results.push({code,status:'skipped',reason:'基期晚于查询结束日'}); save(); continue; }
      status.pendingCode=code;save();
      let receipt;
      try {
        const params={windcode:profile['Wind代码'],begin_date:begin,end_date:end,period:'1d',aftype:'2',count:0};
        try { receipt=await callWindIndex('get_index_kline',params); }
        catch(error) {
          if(!/backend_error: 服务暂时不可用/.test(error.message)) throw error;
          // Pause the batch and retry only this identical request once. A second
          // failure terminates the run; no requests are spread to other entities.
          console.log(`[服务暂不可用] ${code}: 20秒后原请求重试一次`);
          await delay(20000);
          receipt=await callWindIndex('get_index_kline',params);
        }
      } catch(error) {
        if(!isUnavailableWindInstrument(error)) throw error;
        status.results.push({code,status:'unavailable',reason:error.message,inserted:0});
        console.log(`[标的不可用] ${code}: ${error.message}`);save();continue;
      }
      let rows;
      try { rows=normalizeWindKline(receipt.response,code,begin,end); }
      catch(error) {
        status.results.push({code,status:'invalid',reason:error.message,inserted:0});
        console.log(`[校验失败] ${code}: ${error.message}`);save();continue;
      }
      const missingCloseCount=rows.missingCloseDates.length;
      if (!rows.length) {status.results.push({code,status:'empty',begin,end,inserted:0,missingCloseCount});save();continue;}
      // A new source must agree in scale on overlapping dates before extending a series.
      const old=new Map(writer.prepare('SELECT end_date,close FROM index_daily WHERE ts_code=?').all(code).map(r=>[r.end_date,r.close]));
      const conflicts=rows.filter(r=>old.has(r.end_date)&&Math.abs(r.close/old.get(r.end_date)-1)>0.001);
      if (conflicts.length) {
        status.results.push({code,status:'conflict',reason:'与现有重叠日点位偏差超过0.1%，未混接',conflicts:conflicts.length,example:conflicts.slice(0,3).map(r=>({date:r.end_date,existing:old.get(r.end_date),wind:r.close})),inserted:0});
        console.log(`[跳过] ${code}: ${conflicts.length} overlap conflicts`);save();continue;
      }
      const inserted=writer.transaction(()=>{
        register.run({code,shortCode:code.split('.')[0],name:profile['证券简称']||profile['证券全称'],fullname:profile['证券全称'],publisher:profile['发布机构']||null,baseDate:iso(existing?.base_date)?.replaceAll('-','')||String(profile['基期']||'').slice(0,10).replaceAll('-','')||null,returnType:profile['收益处理方式']||null});
        source.run(code,profile['Wind代码'],JSON.stringify({verifiedAt:profile.verifiedAt,returnType:profile['收益处理方式'],units:'OHLC: index points; amount: CNY only when declared; volume not imported'}));
        const count=insertWindRows(writer,rows);
        writer.prepare(`INSERT INTO sync_log(ts_code,api_name,status,record_count,started_at,finished_at) VALUES(?,'wind_index_kline','success',?,?,?)`).run(code,count,receipt.requestedAt,new Date().toISOString());
        return count;
      })();
      status.results.push({code,name:profile['证券全称'],status:'success',returnType:indexReturnType(profile),begin,end,returned:rows.length,inserted,missingCloseCount,first:rows[0].end_date,last:rows.at(-1).end_date});
      console.log(`[日线] ${++n}/${targets.size} ${code} +${inserted} (${rows.length} returned)`);
      save();
    }
    delete status.pendingCode;
    status.state='completed';
    return status;
  } catch(error) {
    status.state='blocked';status.error=error.message;
    throw error;
  } finally {
    if(writer) {
    const link=writer.prepare(`INSERT INTO index_return_links(index_ts_code,return_ts_code,verified_at) VALUES(?,?,?)
      ON CONFLICT(index_ts_code,return_ts_code) DO UPDATE SET verified_at=excluded.verified_at`);
    writer.transaction(()=>{
      for(const r of status.links) if(writer.prepare('SELECT 1 FROM index_basic WHERE ts_code=?').get(r.index_ts_code)&&writer.prepare('SELECT 1 FROM index_basic WHERE ts_code=?').get(r.return_ts_code)) link.run(r.index_ts_code,r.return_ts_code,r.verified_at);
    })();
    }
    save();writer?.close();
  }
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  const end=args[args.indexOf('--end')+1];
  syncWindIndices({end,discoverOnly:args.includes('--discover-only'),resume:args.includes('--resume'),retryInvalid:args.includes('--retry-invalid')}).then(s=>console.log(JSON.stringify({state:s.state,targets:s.targetCount,results:s.results.length}))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
