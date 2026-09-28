#!/usr/bin/env node
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function constituentCoverage(db) {
  const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='index_constituent_snapshot'").get();
  const snapshots=exists?db.prepare(`SELECT s.*,count(w.constituent_code) stored_count,sum(w.weight_pct) stored_sum_pct
    FROM index_constituent_snapshot s LEFT JOIN index_constituent_weight w ON w.snapshot_id=s.id
    GROUP BY s.id ORDER BY s.as_of_date DESC,CASE s.source WHEN 'csindex' THEN 0 WHEN 'cnindex' THEN 0 WHEN 'eastmoney' THEN 1 WHEN 'wind' THEN 2 ELSE 3 END,s.index_ts_code`).all():[];
  const byCode=new Map();for(const s of snapshots)if(!byCode.has(s.index_ts_code))byCode.set(s.index_ts_code,s);
  const scope=db.prepare(`SELECT b.ts_code,b.name FROM index_basic b
    WHERE EXISTS(SELECT 1 FROM index_daily d WHERE d.ts_code=b.ts_code) OR EXISTS(SELECT 1 FROM index_fund_tracker t WHERE t.index_ts_code=b.ts_code)
    ORDER BY b.ts_code`).all().filter(r=>! /\.(SGE|NYM|CFX|FX)$/i.test(r.ts_code));
  const covered=scope.filter(r=>byCode.has(r.ts_code));
  const sourceSnapshots={},latestDates={};
  for(const s of snapshots) sourceSnapshots[s.source]=(sourceSnapshots[s.source]||0)+1;
  for(const r of covered) {const date=byCode.get(r.ts_code).as_of_date;latestDates[date]=(latestDates[date]||0)+1;}
  return {generatedAt:new Date().toISOString(),scopeCount:scope.length,coveredCount:covered.length,
    missingCount:scope.length-covered.length,snapshotCount:snapshots.length,
    sourceSnapshots,latestDates,
    weightRows:snapshots.reduce((s,r)=>s+r.stored_count,0),
    invalidStoredSnapshots:snapshots.filter(s=>s.stored_count!==s.expected_count||Math.abs(s.stored_sum_pct-s.weight_sum_pct)>1e-8||s.validation!=='complete'),
    covered:covered.map(r=>({...r,asOfDate:byCode.get(r.ts_code).as_of_date,count:byCode.get(r.ts_code).stored_count,source:byCode.get(r.ts_code).source})),
    missing:scope.filter(r=>!byCode.has(r.ts_code))};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const db=new Database(path.join(root,'data/fundcal.db'),{readonly:true,fileMustExist:true});
  try {
    const report=constituentCoverage(db);const dir=path.join(root,'data/wind/constituents');mkdirSync(dir,{recursive:true});
    writeFileSync(path.join(dir,'coverage.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({...report,covered:undefined,missing:undefined},null,2));
    if(report.invalidStoredSnapshots.length)process.exitCode=1;
  }finally{db.close();}
}
