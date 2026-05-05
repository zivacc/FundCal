#!/usr/bin/env node
/**
 * 同步 A 股交易日历 (Tushare trade_cal API → trade_calendar 表).
 *
 * 数据源: SSE (上交所; 沪深节假日一致)
 * 字段: cal_date, is_open (0/1), pretrade_date (上一交易日)
 *
 * 用法:
 *   node scripts/nav/sync-trade-calendar.js              # 增量 (从 DB 最新日期开始)
 *   node scripts/nav/sync-trade-calendar.js --full       # 全量重拉 (1990-01-01 ~ 今年+1)
 *   node scripts/nav/sync-trade-calendar.js --start 19900101 --end 20301231
 */

import { tushareAllPages } from './tushare-client.js';
import { getDb, closeDb, logSync } from './db.js';
import { loadEnv } from './env.js';

loadEnv();

const FIELDS = 'cal_date,is_open,pretrade_date';
const EXCHANGE = 'SSE';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { full: false, start: null, end: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--full') opts.full = true;
    else if (args[i] === '--start') opts.start = args[++i];
    else if (args[i] === '--end') opts.end = args[++i];
  }
  return opts;
}

function defaultEnd() {
  const d = new Date();
  return `${d.getFullYear() + 1}1231`;
}

function defaultStart() {
  return '19900101';
}

function nextDay(yyyymmdd) {
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  const next = new Date(y, m, d + 1);
  return `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, '0')}${String(next.getDate()).padStart(2, '0')}`;
}

async function main() {
  const opts = parseArgs();
  const db = getDb();

  let startDate, endDate;
  if (opts.start) {
    startDate = opts.start;
    endDate = opts.end || defaultEnd();
  } else if (opts.full) {
    startDate = defaultStart();
    endDate = defaultEnd();
  } else {
    const latest = db.prepare("SELECT MAX(cal_date) AS d FROM trade_calendar").get().d;
    startDate = latest ? nextDay(latest) : defaultStart();
    endDate = defaultEnd();
  }

  console.log(`📅 同步交易日历 (${EXCHANGE}) ${startDate} ~ ${endDate}`);

  const startedAt = new Date().toISOString();
  let rows;
  try {
    rows = await tushareAllPages('trade_cal', {
      exchange: EXCHANGE,
      start_date: startDate,
      end_date: endDate,
    }, FIELDS);
  } catch (err) {
    console.error(`❌ 拉取失败: ${err.message}`);
    logSync({
      ts_code: null, api_name: 'trade_cal', status: 'error',
      started_at: startedAt, finished_at: new Date().toISOString(),
      error_message: err.message,
    });
    closeDb();
    process.exit(1);
  }

  if (!rows.length) {
    console.log('  无新数据');
    logSync({
      ts_code: null, api_name: 'trade_cal', status: 'success',
      record_count: 0, started_at: startedAt, finished_at: new Date().toISOString(),
    });
    closeDb();
    return;
  }

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO trade_calendar (cal_date, is_open, pretrade_date, updated_at)
    VALUES (?, ?, ?, datetime('now'))
  `);
  const tx = db.transaction((records) => {
    for (const r of records) upsert.run(r.cal_date, r.is_open ?? 0, r.pretrade_date || null);
  });
  tx(rows);

  const total = db.prepare("SELECT COUNT(*) AS n FROM trade_calendar").get().n;
  const open = db.prepare("SELECT COUNT(*) AS n FROM trade_calendar WHERE is_open=1").get().n;

  logSync({
    ts_code: null, api_name: 'trade_cal', status: 'success',
    record_count: rows.length, started_at: startedAt, finished_at: new Date().toISOString(),
  });

  console.log(`  ✅ 写入 ${rows.length} 条 (本次拉取)`);
  console.log(`  📊 累计: ${total} 条, 其中开盘日 ${open} 条`);
  closeDb();
}

main().catch(err => { console.error('💥', err); closeDb(); process.exit(1); });
