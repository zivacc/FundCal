#!/usr/bin/env node
/**
 * Sync fund NAV (净值) data from Tushare fund_nav into SQLite.
 * Supports incremental sync — only fetches records newer than the latest in DB.
 *
 * Usage:
 *   node scripts/nav/sync-fund-nav.js --codes 000001,000002
 *   node scripts/nav/sync-fund-nav.js --file codes.txt
 *   node scripts/nav/sync-fund-nav.js --type 股票型
 *   node scripts/nav/sync-fund-nav.js --all
 *   node scripts/nav/sync-fund-nav.js --codes 000001 --full   # 忽略增量，全量拉取
 */

import fs from 'fs';
import { tushareAllPages } from './tushare-client.js';
import {
  getDb, closeDb, codeToTsCode,
  getLatestNavDate, upsertNavRecords, logSync,
} from './db.js';
import { loadEnv } from './env.js';

loadEnv();

// Broker uses nav_date instead of end_date
const NAV_FIELDS = 'ts_code,ann_date,nav_date,unit_nav,accum_nav,accum_div,net_asset,total_netasset,adj_nav';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { codes: [], file: null, type: null, all: false, full: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--codes':
        opts.codes = (args[++i] || '').split(',').map((c) => c.trim()).filter(Boolean);
        break;
      case '--file':
        opts.file = args[++i];
        break;
      case '--type':
        opts.type = args[++i];
        break;
      case '--all':
        opts.all = true;
        break;
      case '--full':
        opts.full = true;
        break;
      default:
        if (/^\d{6}$/.test(args[i])) opts.codes.push(args[i]);
    }
  }
  return opts;
}

function resolveCodes(opts) {
  const db = getDb();
  let codes = [];

  if (opts.codes.length) {
    codes = opts.codes;
  } else if (opts.file) {
    if (!fs.existsSync(opts.file)) {
      console.error(`❌ 文件不存在: ${opts.file}`);
      process.exit(1);
    }
    codes = fs.readFileSync(opts.file, 'utf8')
      .split(/[\r\n,]+/)
      .map((c) => c.trim())
      .filter((c) => /^\d{6}$/.test(c));
  } else if (opts.type) {
    const rows = db.prepare(
      'SELECT code FROM fund_basic WHERE fund_type LIKE ? AND status = ?'
    ).all(`%${opts.type}%`, 'L');
    codes = rows.map((r) => r.code);
    if (!codes.length) {
      console.error(`❌ fund_basic 中未找到类型包含「${opts.type}」的基金，请先运行 sync-fund-basic.js`);
      process.exit(1);
    }
  } else if (opts.all) {
    const rows = db.prepare("SELECT code FROM fund_basic WHERE status = 'L'").all();
    codes = rows.map((r) => r.code);
    if (!codes.length) {
      console.error('❌ fund_basic 表为空，请先运行 sync-fund-basic.js');
      process.exit(1);
    }
  } else {
    console.log('用法:');
    console.log('  --codes 000001,000002   指定基金代码');
    console.log('  --file  codes.txt       从文件读取代码列表');
    console.log('  --type  股票型          按 fund_type 筛选 (需先 sync-fund-basic)');
    console.log('  --all                   同步 fund_basic 中所有上市基金');
    console.log('  --full                  忽略增量逻辑，全量拉取');
    process.exit(0);
  }

  return [...new Set(codes)];
}

function nextDay(dateStr) {
  const y = parseInt(dateStr.slice(0, 4), 10);
  const m = parseInt(dateStr.slice(4, 6), 10) - 1;
  const d = parseInt(dateStr.slice(6, 8), 10);
  const next = new Date(y, m, d + 1);
  const ny = next.getFullYear();
  const nm = String(next.getMonth() + 1).padStart(2, '0');
  const nd = String(next.getDate()).padStart(2, '0');
  return `${ny}${nm}${nd}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

async function syncOneFund(code, index, total, fullMode) {
  const db = getDb();
  const tsCode = codeToTsCode(code);

  const nameRow = db.prepare('SELECT name FROM fund_basic WHERE code = ?').get(code);
  const name = nameRow ? nameRow.name : tsCode;

  const prefix = `[${String(index + 1).padStart(String(total).length, ' ')}/${total}]`;

  let startDate = '19980101';
  if (!fullMode) {
    const latest = getLatestNavDate(tsCode);
    if (latest) {
      startDate = nextDay(latest);
      if (startDate > todayStr()) {
        console.log(`${prefix} ${code} ${name} — 已是最新 (${latest})`);
        return 0;
      }
    }
  }

  const startedAt = new Date().toISOString();

  try {
    const rows = await tushareAllPages(
      'fund_nav',
      { ts_code: tsCode, start_date: startDate, end_date: todayStr() },
      NAV_FIELDS,
    );

    if (!rows.length) {
      console.log(`${prefix} ${code} ${name} — 无新数据 (自 ${startDate})`);
      logSync({
        ts_code: tsCode, api_name: 'fund_nav', status: 'success',
        record_count: 0, started_at: startedAt, finished_at: new Date().toISOString(),
      });
      return 0;
    }

    const records = rows
      .map((r) => ({
        ts_code: r.ts_code || tsCode,
        end_date: r.nav_date || r.end_date || '',
        ann_date: r.ann_date || null,
        unit_nav: r.unit_nav ?? null,
        accum_nav: r.accum_nav ?? null,
        accum_div: r.accum_div ?? null,
        net_asset: r.net_asset ?? null,
        total_netasset: r.total_netasset ?? null,
        adj_nav: r.adj_nav ?? null,
      }))
      .filter((r) => r.end_date);

    upsertNavRecords(records);

    const finishedAt = new Date().toISOString();
    logSync({
      ts_code: tsCode, api_name: 'fund_nav', status: 'success',
      record_count: records.length, started_at: startedAt, finished_at: finishedAt,
    });

    console.log(`${prefix} ${code} ${name} +${records.length} 条`);
    return records.length;
  } catch (err) {
    console.error(`${prefix} ${code} ${name} ❌ ${err.message}`);
    logSync({
      ts_code: tsCode, api_name: 'fund_nav', status: 'error',
      started_at: startedAt, finished_at: new Date().toISOString(),
      error_message: err.message,
    });
    return 0;
  }
}

async function main() {
  const opts = parseArgs();
  const codes = resolveCodes(opts);

  console.log(`🔄 开始同步基金净值 (fund_nav)`);
  console.log(`   基金数量: ${codes.length}`);
  console.log(`   模式: ${opts.full ? '全量' : '增量'}`);
  console.log('');

  let totalRecords = 0;
  let successCount = 0;
  let errorCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < codes.length; i++) {
    const n = await syncOneFund(codes[i], i, codes.length, opts.full);
    if (n >= 0) {
      totalRecords += n;
      successCount++;
    } else {
      errorCount++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('');
  console.log(`✅ 同步完成`);
  console.log(`   成功: ${successCount}  失败: ${errorCount}`);
  console.log(`   新增/更新记录: ${totalRecords}`);
  console.log(`   耗时: ${elapsed}s`);

  const db = getDb();
  const { cnt } = db.prepare('SELECT count(*) as cnt FROM fund_nav').get();
  console.log(`   fund_nav 表总记录: ${cnt}`);

  closeDb();
}

main().catch((err) => {
  console.error('💥 同步失败:', err);
  closeDb();
  process.exit(1);
});
