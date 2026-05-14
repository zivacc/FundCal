#!/usr/bin/env node
/**
 * 同步 Tushare index_daily → index_daily 表 (source=1, 主源).
 *
 * 用法:
 *   node scripts/nav/sync-index-daily.js --codes 000300.SH,000905.SH
 *   node scripts/nav/sync-index-daily.js --tracked          # 仅同步被基金跟踪的指数 (热度优先)
 *   node scripts/nav/sync-index-daily.js --all              # 全部 index_basic 中已注册 tushare 源的指数
 *   node scripts/nav/sync-index-daily.js --file codes.txt
 *   node scripts/nav/sync-index-daily.js --codes 000300.SH --full   # 强制全量
 *   node scripts/nav/sync-index-daily.js --tracked -c 5     # 并发
 */

import fs from 'fs';
import { tushareAllPages } from './tushare-client.js';
import {
  getDb, closeDb,
  upsertIndexDailyRecords, getLatestIndexDailyDate, logSync,
} from './db.js';
import { loadEnv } from './env.js';

loadEnv();

const FIELDS = 'ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { codes: [], file: null, tracked: false, all: false, full: false, concurrency: 3 };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--codes': opts.codes = (args[++i] || '').split(',').map(c => c.trim()).filter(Boolean); break;
      case '--file': opts.file = args[++i]; break;
      case '--tracked': opts.tracked = true; break;
      case '--all': opts.all = true; break;
      case '--full': opts.full = true; break;
      case '--concurrency':
      case '-c': opts.concurrency = Math.max(1, parseInt(args[++i], 10) || 3); break;
    }
  }
  return opts;
}

function resolveTsCodes(opts) {
  const db = getDb();
  if (opts.codes.length) return [...new Set(opts.codes)];
  if (opts.file) {
    if (!fs.existsSync(opts.file)) { console.error(`❌ 文件不存在: ${opts.file}`); process.exit(1); }
    return [...new Set(fs.readFileSync(opts.file, 'utf8').split(/[\r\n,]+/).map(c => c.trim()).filter(Boolean))];
  }
  if (opts.tracked) {
    // 仅同步被基金跟踪的指数 (跟踪关系表 / fund_meta.tracking_target 反查)
    const rows = db.prepare(`
      SELECT DISTINCT m.source_code FROM index_source_map m
      JOIN index_fund_tracker t ON t.index_ts_code = m.ts_code
      WHERE m.source = 'tushare' AND m.is_active = 1
    `).all();
    return rows.map(r => r.source_code);
  }
  if (opts.all) {
    const rows = db.prepare(`
      SELECT source_code FROM index_source_map WHERE source = 'tushare' AND is_active = 1
    `).all();
    return rows.map(r => r.source_code);
  }
  console.log('用法见文件头注释');
  process.exit(0);
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

async function syncOne(tsCode, idx, total, fullMode, nameMap) {
  const prefix = `[${String(idx + 1).padStart(String(total).length, ' ')}/${total}]`;
  const name = nameMap.get(tsCode) || tsCode;

  let startDate = '19900101';
  if (!fullMode) {
    const latest = getLatestIndexDailyDate(tsCode);
    if (latest) {
      startDate = nextDay(latest);
      if (startDate > todayStr()) {
        console.log(`${prefix} ${tsCode} ${name} — 已是最新 (${latest})`);
        return 0;
      }
    }
  }

  const startedAt = new Date().toISOString();
  try {
    const rows = await tushareAllPages('index_daily',
      { ts_code: tsCode, start_date: startDate, end_date: todayStr() }, FIELDS);

    if (!rows.length) {
      console.log(`${prefix} ${tsCode} ${name} — 无新数据`);
      logSync({
        ts_code: tsCode, api_name: 'index_daily', status: 'success',
        record_count: 0, started_at: startedAt, finished_at: new Date().toISOString(),
      });
      return 0;
    }

    const records = rows.map(r => ({
      ts_code: r.ts_code || tsCode,
      end_date: r.trade_date || '',
      open: r.open ?? null,
      high: r.high ?? null,
      low: r.low ?? null,
      close: r.close ?? null,
      pre_close: r.pre_close ?? null,
      pct_chg: r.pct_chg ?? null,
      vol: r.vol ?? null,
      amount: r.amount ?? null,
      source: 1,
    })).filter(r => r.end_date && r.close != null);

    upsertIndexDailyRecords(records, 1);

    logSync({
      ts_code: tsCode, api_name: 'index_daily', status: 'success',
      record_count: records.length, started_at: startedAt, finished_at: new Date().toISOString(),
    });

    console.log(`${prefix} ${tsCode} ${name} +${records.length} 条`);
    return records.length;
  } catch (e) {
    console.error(`${prefix} ${tsCode} ${name} ❌ ${e.message}`);
    logSync({
      ts_code: tsCode, api_name: 'index_daily', status: 'error',
      started_at: startedAt, finished_at: new Date().toISOString(),
      error_message: e.message,
    });
    return 0;
  }
}

async function main() {
  const opts = parseArgs();
  const tsCodes = resolveTsCodes(opts);

  console.log(`🔄 同步指数日线 (Tushare index_daily)`);
  console.log(`   指数数: ${tsCodes.length}, 并发: ${opts.concurrency}, 模式: ${opts.full ? '全量' : '增量'}`);

  if (tsCodes.length === 0) { closeDb(); return; }

  const nameMap = new Map(
    getDb().prepare('SELECT ts_code, name FROM index_basic').all()
      .map(r => [r.ts_code, r.name])
  );

  let totalRows = 0, success = 0, error = 0;
  const start = Date.now();
  let cursor = 0;
  async function worker() {
    while (cursor < tsCodes.length) {
      const i = cursor++;
      try {
        const n = await syncOne(tsCodes[i], i, tsCodes.length, opts.full, nameMap);
        totalRows += n; success++;
      } catch (e) {
        error++;
        console.error(`worker error ${tsCodes[i]}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: opts.concurrency }, worker));

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✅ 完成: 成功 ${success} / 失败 ${error}, +${totalRows} 行, 耗时 ${elapsed}s`);
  closeDb();
}

main().catch(e => { console.error('💥', e); closeDb(); process.exit(1); });
