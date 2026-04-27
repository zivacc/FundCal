#!/usr/bin/env node
/**
 * CLI tool to query fund NAV data from the local SQLite database.
 *
 * Usage:
 *   node scripts/nav/query-nav.js 000001                              # 最新净值
 *   node scripts/nav/query-nav.js 000001 --start 20240101 --end 20241231  # 历史区间
 *   node scripts/nav/query-nav.js 000001 --last 30                    # 最近 N 条
 *   node scripts/nav/query-nav.js --stats                             # 数据库统计
 *   node scripts/nav/query-nav.js --log                               # 最近同步日志
 */

import { getDb, closeDb, codeToTsCode } from './db.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { code: null, start: null, end: null, last: null, stats: false, log: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--start': opts.start = args[++i]; break;
      case '--end':   opts.end = args[++i]; break;
      case '--last':  opts.last = parseInt(args[++i], 10) || 30; break;
      case '--stats': opts.stats = true; break;
      case '--log':   opts.log = true; break;
      default:
        if (/^\d{6}$/.test(args[i])) opts.code = args[i];
    }
  }
  return opts;
}

function fmtDate(d) {
  if (!d || d.length !== 8) return d || '-';
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function fmtNav(v) {
  return v != null ? Number(v).toFixed(4) : '-';
}

function showLatest(code) {
  const db = getDb();
  const tsCode = codeToTsCode(code);

  const basic = db.prepare('SELECT * FROM fund_basic WHERE code = ?').get(code);
  const latest = db.prepare(
    'SELECT * FROM fund_nav WHERE ts_code = ? ORDER BY end_date DESC LIMIT 1'
  ).get(tsCode);

  const navCount = db.prepare(
    'SELECT count(*) as cnt FROM fund_nav WHERE ts_code = ?'
  ).get(tsCode);

  console.log(`\n基金: ${basic ? basic.name : code} (${code})`);
  console.log(`ts_code: ${tsCode}`);
  if (basic) {
    console.log(`类型: ${basic.fund_type || '-'}  管理人: ${basic.management || '-'}`);
    console.log(`成立日期: ${fmtDate(basic.found_date)}  状态: ${basic.status || '-'}`);
  }
  console.log(`净值记录数: ${navCount.cnt}`);

  if (latest) {
    console.log('');
    console.log(`📊 最新净值 (${fmtDate(latest.end_date)}):`);
    console.log(`   单位净值:   ${fmtNav(latest.unit_nav)}`);
    console.log(`   累计净值:   ${fmtNav(latest.accum_nav)}`);
    console.log(`   复权净值:   ${fmtNav(latest.adj_nav)}`);
    console.log(`   累计分红:   ${fmtNav(latest.accum_div)}`);
    console.log(`   资产净值:   ${latest.net_asset != null ? latest.net_asset : '-'} 万元`);
  } else {
    console.log('\n⚠️ 无净值数据，请先运行 sync-fund-nav.js');
  }
}

function showHistory(code, opts) {
  const db = getDb();
  const tsCode = codeToTsCode(code);
  const basic = db.prepare('SELECT name FROM fund_basic WHERE code = ?').get(code);
  const name = basic ? basic.name : code;

  let sql, params;
  if (opts.last) {
    sql = 'SELECT * FROM fund_nav WHERE ts_code = ? ORDER BY end_date DESC LIMIT ?';
    params = [tsCode, opts.last];
  } else {
    const conditions = ['ts_code = ?'];
    params = [tsCode];
    if (opts.start) { conditions.push('end_date >= ?'); params.push(opts.start); }
    if (opts.end)   { conditions.push('end_date <= ?'); params.push(opts.end); }
    sql = `SELECT * FROM fund_nav WHERE ${conditions.join(' AND ')} ORDER BY end_date ASC`;
  }

  const rows = db.prepare(sql).all(...params);

  console.log(`\n${name} (${code}) — ${rows.length} 条记录\n`);

  if (!rows.length) {
    console.log('无数据');
    return;
  }

  // reverse if using --last so newest is at bottom
  if (opts.last) rows.reverse();

  const header = '日期        | 单位净值 | 累计净值 | 复权净值 | 累计分红';
  const sep    = '------------|----------|----------|----------|--------';
  console.log(header);
  console.log(sep);
  for (const r of rows) {
    const line = [
      fmtDate(r.end_date).padEnd(10),
      fmtNav(r.unit_nav).padStart(8),
      fmtNav(r.accum_nav).padStart(8),
      fmtNav(r.adj_nav).padStart(8),
      fmtNav(r.accum_div).padStart(8),
    ].join(' | ');
    console.log(line);
  }
}

function showStats() {
  const db = getDb();

  const basicCount = db.prepare('SELECT count(*) as cnt FROM fund_basic').get().cnt;
  const navCount = db.prepare('SELECT count(*) as cnt FROM fund_nav').get().cnt;
  const fundWithNav = db.prepare('SELECT count(DISTINCT ts_code) as cnt FROM fund_nav').get().cnt;

  const earliest = db.prepare('SELECT min(end_date) as d FROM fund_nav').get().d;
  const latest = db.prepare('SELECT max(end_date) as d FROM fund_nav').get().d;

  const typeBreakdown = db.prepare(`
    SELECT b.fund_type, count(DISTINCT n.ts_code) as fund_count, count(*) as nav_count
    FROM fund_nav n
    LEFT JOIN fund_basic b ON n.ts_code = b.ts_code
    GROUP BY b.fund_type
    ORDER BY nav_count DESC
    LIMIT 15
  `).all();

  console.log('\n📊 数据库统计\n');
  console.log(`fund_basic 基金数:  ${basicCount}`);
  console.log(`fund_nav 总记录:    ${navCount}`);
  console.log(`有净值数据的基金:   ${fundWithNav}`);
  console.log(`日期范围:           ${fmtDate(earliest)} ~ ${fmtDate(latest)}`);

  if (typeBreakdown.length) {
    console.log('\n按类型分布:');
    console.log('类型                     | 基金数 | 净值记录');
    console.log('-------------------------|--------|--------');
    for (const r of typeBreakdown) {
      const type = (r.fund_type || '未知').padEnd(23);
      console.log(`${type} | ${String(r.fund_count).padStart(6)} | ${String(r.nav_count).padStart(8)}`);
    }
  }
}

function showLog() {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM sync_log ORDER BY id DESC LIMIT 20'
  ).all();

  console.log('\n📋 最近同步日志 (最新 20 条)\n');

  if (!rows.length) {
    console.log('无日志记录');
    return;
  }

  for (const r of rows) {
    const icon = r.status === 'success' ? '✅' : '❌';
    const ts = r.ts_code || 'ALL';
    const count = r.record_count || 0;
    const time = r.finished_at ? r.finished_at.slice(0, 19) : '-';
    const err = r.error_message ? ` — ${r.error_message}` : '';
    console.log(`${icon} [${time}] ${r.api_name} ${ts} ${count}条${err}`);
  }
}

function main() {
  const opts = parseArgs();

  if (opts.stats) { showStats(); closeDb(); return; }
  if (opts.log)   { showLog();   closeDb(); return; }

  if (!opts.code) {
    console.log('用法:');
    console.log('  node scripts/nav/query-nav.js <6位代码>                  查看最新净值');
    console.log('  node scripts/nav/query-nav.js <6位代码> --last 30        最近30条');
    console.log('  node scripts/nav/query-nav.js <6位代码> --start YYYYMMDD --end YYYYMMDD');
    console.log('  node scripts/nav/query-nav.js --stats                    数据库统计');
    console.log('  node scripts/nav/query-nav.js --log                      同步日志');
    process.exit(0);
  }

  if (opts.start || opts.end || opts.last) {
    showHistory(opts.code, opts);
  } else {
    showLatest(opts.code);
  }

  closeDb();
}

main();
