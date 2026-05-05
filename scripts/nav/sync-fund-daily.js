#!/usr/bin/env node
/**
 * 同步场内基金日线行情 (Tushare fund_daily API), 并写入 fund_nav 表.
 *
 * 适用范围: ETF / LOF / 封闭基金等场内交易基金 (ts_code 后缀 .SH / .SZ / .BJ).
 * 这些基金在 fund_nav 接口几乎无数据, 必须走 fund_daily.
 *
 * 字段映射 (fund_daily → fund_nav):
 *   ts_code      → ts_code
 *   trade_date   → end_date
 *   close        → unit_nav    (场内基金的"日净值"近似用收盘价)
 *   close        → adj_nav     (无独立复权; 与 unit_nav 同, 计算 pct_change 兼容)
 *   NULL         → accum_nav, accum_div, ann_date, net_asset, total_netasset
 *
 * 用法:
 *   node scripts/nav/sync-fund-daily.js --codes 159315,510050
 *   node scripts/nav/sync-fund-daily.js --all                # 全部场内
 *   node scripts/nav/sync-fund-daily.js --all --include-dead # 含已退市
 *   node scripts/nav/sync-fund-daily.js --file codes.txt
 *   node scripts/nav/sync-fund-daily.js --codes 510050 --full  # 强制全量
 */

import fs from 'fs';
import { tushareAllPages } from './tushare-client.js';
import {
  getDb, closeDb, getLatestNavDate, upsertNavRecords, logSync,
} from './db.js';
import { loadEnv } from './env.js';

loadEnv();

const DAILY_FIELDS = 'ts_code,trade_date,pre_close,open,high,low,close,change,pct_chg,vol,amount';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { codes: [], file: null, all: false, full: false, includeDead: false, concurrency: 3 };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--codes':
        opts.codes = (args[++i] || '').split(',').map(c => c.trim()).filter(Boolean);
        break;
      case '--file':
        opts.file = args[++i];
        break;
      case '--all':
        opts.all = true;
        break;
      case '--include-dead':
        opts.includeDead = true;
        break;
      case '--full':
        opts.full = true;
        break;
      case '--concurrency':
      case '-c':
        opts.concurrency = Math.max(1, parseInt(args[++i], 10) || 3);
        break;
      default:
        if (/^\d{6}$/.test(args[i])) opts.codes.push(args[i]);
    }
  }
  return opts;
}

/** 选场内 ts_code (.SH/.SZ/.BJ); 同 code 多行时取第一个场内的 */
function pickExchangeTsCode(db, code) {
  const row = db.prepare(`
    SELECT ts_code FROM fund_basic WHERE code = ?
      AND (ts_code LIKE '%.SH' OR ts_code LIKE '%.SZ' OR ts_code LIKE '%.BJ')
    LIMIT 1
  `).get(code);
  return row?.ts_code || null;
}

function resolveTsCodes(opts) {
  const db = getDb();
  let tsCodes = [];

  if (opts.codes.length) {
    for (const c of opts.codes) {
      const ts = pickExchangeTsCode(db, c);
      if (ts) tsCodes.push(ts);
      else console.warn(`  ⚠️ ${c} 无场内 ts_code, 跳过`);
    }
  } else if (opts.file) {
    if (!fs.existsSync(opts.file)) { console.error(`❌ 文件不存在: ${opts.file}`); process.exit(1); }
    const codes = fs.readFileSync(opts.file, 'utf8')
      .split(/[\r\n,]+/).map(c => c.trim()).filter(c => /^\d{6}$/.test(c));
    for (const c of codes) {
      const ts = pickExchangeTsCode(db, c);
      if (ts) tsCodes.push(ts);
    }
  } else if (opts.all) {
    const sql = opts.includeDead
      ? "SELECT ts_code FROM fund_basic WHERE (ts_code LIKE '%.SH' OR ts_code LIKE '%.SZ' OR ts_code LIKE '%.BJ') AND status IN ('L','D','I')"
      : "SELECT ts_code FROM fund_basic WHERE (ts_code LIKE '%.SH' OR ts_code LIKE '%.SZ' OR ts_code LIKE '%.BJ') AND status IN ('L','I')";
    tsCodes = db.prepare(sql).all().map(r => r.ts_code);
  } else {
    console.log('用法:');
    console.log('  --codes 159315,510050  指定基金代码');
    console.log('  --file  codes.txt      从文件读取');
    console.log('  --all                  所有场内 status=L/I 基金');
    console.log('  --all --include-dead   含已退市');
    console.log('  --full                 全量 (忽略增量)');
    process.exit(0);
  }

  return [...new Set(tsCodes)];
}

function nextDay(yyyymmdd) {
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  const next = new Date(y, m, d + 1);
  return `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, '0')}${String(next.getDate()).padStart(2, '0')}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

async function syncOne(tsCode, index, total, fullMode) {
  const db = getDb();
  const code = tsCode.split('.')[0];
  const nameRow = db.prepare('SELECT name FROM fund_basic WHERE ts_code = ?').get(tsCode);
  const name = nameRow?.name || tsCode;
  const prefix = `[${String(index + 1).padStart(String(total).length, ' ')}/${total}]`;

  let startDate = '20000101';
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
      'fund_daily',
      { ts_code: tsCode, start_date: startDate, end_date: todayStr() },
      DAILY_FIELDS,
    );

    if (!rows.length) {
      console.log(`${prefix} ${code} ${name} — 无新数据 (自 ${startDate})`);
      logSync({
        ts_code: tsCode, api_name: 'fund_daily', status: 'success',
        record_count: 0, started_at: startedAt, finished_at: new Date().toISOString(),
      });
      return 0;
    }

    const records = rows
      .map(r => ({
        ts_code: r.ts_code || tsCode,
        end_date: r.trade_date || '',
        ann_date: null,
        unit_nav: r.close ?? null,
        accum_nav: null,
        accum_div: null,
        net_asset: null,
        total_netasset: null,
        adj_nav: r.close ?? null,
      }))
      .filter(r => r.end_date && r.unit_nav != null);

    upsertNavRecords(records);

    logSync({
      ts_code: tsCode, api_name: 'fund_daily', status: 'success',
      record_count: records.length, started_at: startedAt, finished_at: new Date().toISOString(),
    });

    console.log(`${prefix} ${code} ${name} +${records.length} 条`);
    return records.length;
  } catch (err) {
    console.error(`${prefix} ${code} ${name} ❌ ${err.message}`);
    logSync({
      ts_code: tsCode, api_name: 'fund_daily', status: 'error',
      started_at: startedAt, finished_at: new Date().toISOString(),
      error_message: err.message,
    });
    return 0;
  }
}

async function main() {
  const opts = parseArgs();
  const tsCodes = resolveTsCodes(opts);
  const concurrency = opts.concurrency;

  console.log(`🔄 同步场内基金日线 (fund_daily → fund_nav)`);
  console.log(`   基金数量: ${tsCodes.length}`);
  console.log(`   并发: ${concurrency}`);
  console.log(`   模式: ${opts.full ? '全量' : '增量'}`);
  console.log('');

  if (tsCodes.length === 0) {
    console.log('无可同步基金, 退出');
    closeDb();
    return;
  }

  let totalRecords = 0;
  let successCount = 0;
  let errorCount = 0;
  const startTime = Date.now();

  let cursor = 0;
  async function worker() {
    while (cursor < tsCodes.length) {
      const i = cursor++;
      try {
        const n = await syncOne(tsCodes[i], i, tsCodes.length, opts.full);
        totalRecords += n;
        successCount++;
      } catch (e) {
        errorCount++;
        console.error(`  worker error on ${tsCodes[i]}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log(`✅ 同步完成`);
  console.log(`   成功: ${successCount}  失败: ${errorCount}`);
  console.log(`   新增/更新记录: ${totalRecords}`);
  console.log(`   耗时: ${elapsed}s`);

  closeDb();
}

main().catch(e => { console.error('💥 同步失败:', e); closeDb(); process.exit(1); });
