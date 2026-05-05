#!/usr/bin/env node
/**
 * Sync fund basic info from Tushare fund_basic into SQLite.
 * Pulls both E (场内) and O (场外) markets.
 *
 * Usage:
 *   node scripts/nav/sync-fund-basic.js              # 同步全量
 *   node scripts/nav/sync-fund-basic.js --market O    # 只同步场外
 *   node scripts/nav/sync-fund-basic.js --market E    # 只同步场内
 */

import { tushare } from './tushare-client.js';
import { getDb, upsertFundBasicFromTushare, logSync, closeDb } from './db.js';
import { loadEnv } from './env.js';

loadEnv();

const FIELDS = [
  'ts_code', 'name', 'management', 'custodian', 'fund_type',
  'found_date', 'status', 'market', 'benchmark',
].join(',');

function extractCode(tsCode) {
  return tsCode ? tsCode.split('.')[0] : '';
}

async function syncMarket(market) {
  const label = market === 'E' ? '场内' : '场外';
  console.log(`\n📡 拉取${label}基金列表 (market=${market}) ...`);

  const startedAt = new Date().toISOString();
  let rows;

  try {
    rows = await tushare('fund_basic', { market }, FIELDS);
  } catch (err) {
    console.error(`  ❌ 拉取${label}基金列表失败: ${err.message}`);
    logSync({
      ts_code: null,
      api_name: 'fund_basic',
      status: 'error',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      error_message: `market=${market}: ${err.message}`,
    });
    return 0;
  }

  if (!rows.length) {
    console.log(`  ⚠️ ${label}基金列表为空`);
    return 0;
  }

  const records = rows.map((r) => ({
    ts_code: r.ts_code || '',
    code: extractCode(r.ts_code),
    name: r.name || null,
    management: r.management || null,
    custodian: r.custodian || null,
    fund_type: r.fund_type || null,
    found_date: r.found_date || null,
    status: r.status || null,
    market: r.market || market,
    benchmark: r.benchmark || null,
  }));

  const stats = upsertFundBasicFromTushare(records);

  const finishedAt = new Date().toISOString();
  logSync({
    ts_code: null,
    api_name: 'fund_basic',
    status: 'success',
    record_count: records.length,
    started_at: startedAt,
    finished_at: finishedAt,
  });

  console.log(`  ✅ ${label}基金: ${records.length} 条 (新增 ${stats.inserted} / 更新 ${stats.updatedBasic} / 影子 ${stats.updatedShadow})`);
  return records.length;
}

async function main() {
  const args = process.argv.slice(2);
  const marketIdx = args.indexOf('--market');
  const markets = marketIdx !== -1 && args[marketIdx + 1]
    ? [args[marketIdx + 1].toUpperCase()]
    : ['O', 'E'];

  getDb();
  console.log('🔄 开始同步基金基本信息 (fund_basic)');

  let total = 0;
  for (const m of markets) {
    total += await syncMarket(m);
  }

  const db = getDb();
  const { cnt } = db.prepare('SELECT count(*) as cnt FROM fund_basic').get();
  console.log(`\n📊 fund_basic 表总计: ${cnt} 条`);
  console.log(`✅ 本次同步完成，新增/更新 ${total} 条`);

  closeDb();
}

main().catch((err) => {
  console.error('💥 同步失败:', err);
  closeDb();
  process.exit(1);
});
