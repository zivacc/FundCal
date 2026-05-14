#!/usr/bin/env node
/**
 * 同步 Tushare index_basic → index_basic 表 + index_source_map (source='tushare').
 *
 * 多个 market 类别一次性拉:
 *   SSE   上交所
 *   SZSE  深交所
 *   CSI   中证 (沪深 + 跨市场)
 *   SW    申万行业
 *   MSCI  MSCI 国际指数
 *   CICC  中金
 *   OTH   其他
 *
 * 用法:
 *   node scripts/nav/sync-index-basic.js                    # 全部 market
 *   node scripts/nav/sync-index-basic.js --market CSI       # 单 market
 *   node scripts/nav/sync-index-basic.js --markets CSI,SW   # 多 market
 */

import { tushare } from './tushare-client.js';
import {
  getDb, closeDb,
  upsertIndexBasicRecords, bulkRegisterIndexSources, logSync,
} from './db.js';
import { loadEnv } from './env.js';

loadEnv();

const FIELDS = [
  'ts_code', 'name', 'fullname', 'market', 'publisher',
  'index_type', 'category', 'base_date', 'base_point', 'list_date',
  'weight_rule', 'desc',
].join(',');

const DEFAULT_MARKETS = ['SSE', 'SZSE', 'CSI', 'SW', 'MSCI', 'CICC', 'OTH'];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { markets: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--market') opts.markets = [args[++i].toUpperCase()];
    else if (args[i] === '--markets') opts.markets = (args[++i] || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  }
  return opts;
}

function extractCode(tsCode) {
  // tushare ts_code 形如 000300.SH / 932000.CSI / NDX.GI
  // 我们的 code 取主代码部分
  if (!tsCode) return '';
  return tsCode.split('.')[0];
}

async function syncMarket(market) {
  const startedAt = new Date().toISOString();
  console.log(`\n📡 拉 index_basic market=${market} ...`);
  let rows;
  try {
    rows = await tushare('index_basic', { market }, FIELDS);
  } catch (e) {
    console.error(`  ❌ ${market}: ${e.message}`);
    logSync({
      ts_code: null, api_name: 'index_basic', status: 'error',
      started_at: startedAt, finished_at: new Date().toISOString(),
      error_message: `market=${market}: ${e.message}`,
    });
    return 0;
  }

  if (!rows.length) {
    console.log(`  ⚠️ ${market} 空`);
    return 0;
  }

  const records = rows.map(r => ({
    ts_code: r.ts_code,
    code: extractCode(r.ts_code),
    name: r.name || null,
    fullname: r.fullname || null,
    publisher: r.publisher || null,
    category: r.category || null,
    market: r.market || market,
    index_type: r.index_type || null,
    base_date: r.base_date || null,
    base_point: r.base_point ?? null,
    list_date: r.list_date || null,
    weight_rule: r.weight_rule || null,
    description: r.desc || null,
    primary_source: 'tushare',
  }));

  const stats = upsertIndexBasicRecords(records, 'tushare');

  bulkRegisterIndexSources(
    records.map(r => ({ ts_code: r.ts_code, source: 'tushare', source_code: r.ts_code }))
  );

  logSync({
    ts_code: null, api_name: 'index_basic', status: 'success',
    record_count: records.length,
    started_at: startedAt, finished_at: new Date().toISOString(),
  });

  console.log(`  ✅ ${market}: ${records.length} 条 (新 ${stats.inserted} / 更 ${stats.updated})`);
  return records.length;
}

async function main() {
  const opts = parseArgs();
  const markets = opts.markets || DEFAULT_MARKETS;
  getDb();

  console.log(`🔄 同步指数基础信息 (Tushare index_basic)`);
  console.log(`   markets: ${markets.join(', ')}`);

  let total = 0;
  for (const m of markets) {
    total += await syncMarket(m);
  }

  const db = getDb();
  const cnt = db.prepare('SELECT COUNT(*) AS n FROM index_basic').get().n;
  const mapCnt = db.prepare("SELECT COUNT(*) AS n FROM index_source_map WHERE source='tushare'").get().n;

  console.log(`\n📊 index_basic 累计 ${cnt} 条, source_map (tushare) ${mapCnt} 条`);
  console.log(`✅ 本次拉取 ${total} 条`);

  closeDb();
}

main().catch(e => { console.error('💥', e); closeDb(); process.exit(1); });
