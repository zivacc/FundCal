/** Audit reproduction only: public DB reads; all writes use an OS temporary fixture. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cachedJsonFetch } from '../../../js/data/idb-cache.js';
import { downsample, computeStats } from '../../../js/domain/nav-stats.js';
import { findCrossoverPoints, calcTotalFeeRate } from '../../../js/domain/fee-calculator.js';
import { mergePoints, rangeOfPoints, computeMissingRanges } from '../../../js/data/nav-cache.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const results = {};
const originalFetch = globalThis.fetch;
try {
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(JSON.stringify({ marker: 'present' }), { headers: { ETag: 'audit' } }); };
  const first = await cachedJsonFetch('https://audit.invalid/data', { key: 'audit-repeated' });
  const second = await cachedJsonFetch('https://audit.invalid/data', { key: 'audit-repeated' });
  results.memoryCache = { first: first.data, secondIsUndefined: second.data === undefined, secondSource: second.source, requests };
} finally { globalThis.fetch = originalFetch; }

const rows = Array.from({length: 100}, (_, i) => ({
  end_date: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0,10).replaceAll('-', ''),
  unit_nav: 1 + i * .001 + (i % 3) * .003,
}));
const sampled = downsample(rows, 'weekly');
const daily = computeStats(rows.map(r=>r.end_date), rows.map(r=>r.unit_nav));
const weekly = computeStats(sampled.map(r=>r.end_date), sampled.map(r=>r.unit_nav), {interval:'weekly'});
results.sampling = { dailyRows: rows.length, weeklyRows: sampled.length, annualVolatilityRatio: weekly.volatility / daily.volatility };
const separated = mergePoints([{date:'20260101'},{date:'20260131'}],[{date:'20260301'},{date:'20260331'}]);
results.cacheInternalGap = {requested:{start:'20260201',end:'20260228'},reportedMissing:computeMissingRanges(rangeOfPoints(separated),{start:'20260201',end:'20260228'})};
const a = { name:'A', buyFee:0, annualFee:0, sellFeeSegments:[{to:7,rate:.015},{to:null,rate:0}] };
const b = { name:'B', buyFee:.001, annualFee:0, sellFeeSegments:[] };
results.crossover = findCrossoverPoints(a,b,30).map(c=>({...c, actualFeeA:calcTotalFeeRate(a,c.days),actualFeeB:calcTotalFeeRate(b,c.days)}));

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'fundcal-audit-'));
try {
  fs.cpSync(path.join(root, 'scripts'), path.join(fixture, 'scripts'), {recursive:true});
  fs.cpSync(path.join(root, 'js'), path.join(fixture, 'js'), {recursive:true});
  fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
  const mod = await import(pathToFileURL(path.join(fixture, 'scripts/nav/db.js')));
  const db = mod.getDb();
  results.freshSchema = { hasShareClass: db.prepare('pragma table_info(fund_meta)').all().some(r=>r.name==='share_class') };
  const build = spawnSync(process.execPath, ['scripts/build-allfund-from-db.js'], {cwd:fixture,encoding:'utf8',timeout:10000});
  results.freshSchema.buildExit = build.status;
  results.freshSchema.buildMissingColumn = /no such column: m.share_class/.test(build.stderr);

  mod.upsertCrawlerData({code:'999991',name:'test',annualFee:.01,operationFees:{total:.01},
    purchaseFrontSegments:[{amountCondition:'less than 1000000',rate:.01}],
    redeemSegments:[{to:7,rate:.015}],sellFeeSegments:[{to:7,rate:.015}]});
  mod.upsertCrawlerData({code:'999991',name:'test',annualFee:0,operationFees:{managementFee:0,custodyFee:0,salesServiceFee:0,total:0},
    sellFeeSegments:[{to:null,rate:0}]});
  results.partialCrawlerWrite = { meta: db.prepare('select annual_fee,operation_fee_total,mgmt_fee from fund_meta where code=?').get('999991'),
    remainingKinds: db.prepare('select kind from fund_fee_segments where ts_code=?').all('999991.OF').map(r=>r.kind) };
  db.prepare('insert into fund_basic(ts_code,code,name) values(?,?,?)').run('999992.SH','999992','exchange first');
  db.prepare('insert into fund_basic(ts_code,code,name) values(?,?,?)').run('999992.OF','999992','OTC');
  results.crawlerIdentity = { resolver: mod.codeToTsCode('999992'), writer: mod.upsertCrawlerData({code:'999992',name:'OTC updated'}).tsCode };
  const fund = await import(pathToFileURL(path.join(fixture, 'scripts/fund-api.js')));
  try { await fund.createFundRouter()({url:'/api/fund/list?q=%',method:'GET'},{}); }
  catch(e) { results.malformedUrl = { uncaughtRouterRejection:e.name,message:e.message }; }
  mod.closeDb();
} finally { fs.rmSync(fixture,{recursive:true,force:true}); }
console.log(JSON.stringify(results,null,2));
