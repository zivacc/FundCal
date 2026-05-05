#!/usr/bin/env node
/**
 * 从天天基金 (api.fund.eastmoney.com/f10/lsjz) 抓取场外净值历史,
 * 写入 fund_nav 表 (ts_code = <code>.OF, source = 2).
 *
 * 适用范围: tushare fund_nav 给 0 行的场外基金 (主要是 LOF / 部分子类 / Reits).
 *
 * 字段映射:
 *   FSRQ → end_date (YYYYMMDD)
 *   DWJZ → unit_nav
 *   LJJZ → accum_nav
 *   LJJZ → adj_nav  (无独立复权数据, 用累计净值近似)
 *   FHFCZ + 当日累计分红信息 → 暂不入分红表
 *   SGZT/SHZT → 申赎状态 (写 fund_meta.trading_subscribe / trading_redeem)
 *
 * 用法:
 *   node scripts/nav/crawl-eastmoney-nav.js --codes 161226,510050     # 指定
 *   node scripts/nav/crawl-eastmoney-nav.js --missing                  # 自动: tushare 给 0 行的 L 基金
 *   node scripts/nav/crawl-eastmoney-nav.js --file codes.txt
 *   node scripts/nav/crawl-eastmoney-nav.js --missing --concurrency 5  # 默认 3
 *   node scripts/nav/crawl-eastmoney-nav.js --codes 161226 --full      # 强制全量 (忽略增量)
 *   node scripts/nav/crawl-eastmoney-nav.js --missing --limit 100      # 仅前 N 个
 */

import fs from 'fs';
import { getDb, closeDb, upsertNavRecords, getLatestNavDate, logSync } from './db.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0';
const HEADERS = { 'User-Agent': UA, 'Referer': 'http://fundf10.eastmoney.com/' };
const PAGE_SIZE = 20;  // eastmoney 单页硬上限 ~20, 多了也只返 20
const REQUEST_GAP_MS = parseInt(process.env.EASTMONEY_GAP_MS || '50', 10);
const MAX_RETRIES = 3;

let nextSlotAt = 0;
async function reserveSlot() {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + REQUEST_GAP_MS;
  const wait = slot - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { codes: [], file: null, missing: false, full: false, concurrency: 3, limit: 0 };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--codes': opts.codes = (args[++i] || '').split(',').map(c => c.trim()).filter(Boolean); break;
      case '--file': opts.file = args[++i]; break;
      case '--missing': opts.missing = true; break;
      case '--full': opts.full = true; break;
      case '--concurrency':
      case '-c': opts.concurrency = Math.max(1, parseInt(args[++i], 10) || 3); break;
      case '--limit': opts.limit = Math.max(0, parseInt(args[++i], 10) || 0); break;
      default:
        if (/^\d{6}$/.test(args[i])) opts.codes.push(args[i]);
    }
  }
  return opts;
}

function resolveCodes(opts) {
  const db = getDb();
  let codes = [];
  if (opts.codes.length) codes = opts.codes;
  else if (opts.file) {
    if (!fs.existsSync(opts.file)) { console.error(`❌ 文件不存在: ${opts.file}`); process.exit(1); }
    codes = fs.readFileSync(opts.file, 'utf8').split(/[\r\n,]+/).map(c => c.trim()).filter(c => /^\d{6}$/.test(c));
  } else if (opts.missing) {
    const rows = db.prepare(`
      SELECT b.code FROM fund_basic b
      WHERE b.status='L' AND b.ts_code LIKE '%.OF'
        AND b.ts_code NOT IN (SELECT DISTINCT ts_code FROM fund_nav)
      ORDER BY b.code
    `).all();
    codes = rows.map(r => r.code);
  } else {
    console.log('用法:');
    console.log('  --codes 161226,510050  指定基金代码');
    console.log('  --file  codes.txt      从文件读取');
    console.log('  --missing              自动: tushare 给 0 行的 L 场外基金');
    console.log('  --full                 全量模式 (忽略增量)');
    console.log('  --concurrency N        并发 (默认 3)');
    console.log('  --limit N              仅前 N 个');
    process.exit(0);
  }
  if (opts.limit > 0) codes = codes.slice(0, opts.limit);
  return [...new Set(codes)];
}

async function fetchPage(code, pageIndex, startDate = '', endDate = '') {
  const params = new URLSearchParams({
    fundCode: code,
    pageIndex: String(pageIndex),
    pageSize: String(PAGE_SIZE),
    startDate, endDate,
  });
  const url = `https://api.fund.eastmoney.com/f10/lsjz?${params}`;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await reserveSlot();
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return {
        total: json?.TotalCount ?? 0,
        rows: json?.Data?.LSJZList ?? [],
      };
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}

async function fetchAll(code, startDate, endDate) {
  // 第 1 页拿 total, 后续页按 total/PAGE_SIZE 决定
  const first = await fetchPage(code, 1, startDate, endDate);
  const allRows = [...first.rows];
  const total = first.total;
  if (allRows.length >= total || total === 0) return allRows;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  for (let p = 2; p <= totalPages; p++) {
    const r = await fetchPage(code, p, startDate, endDate);
    allRows.push(...r.rows);
    if (allRows.length >= total) break;
  }
  return allRows;
}

function parseRow(code, raw) {
  const fsrq = (raw.FSRQ || '').replace(/-/g, '');
  if (!/^\d{8}$/.test(fsrq)) return null;
  const dwjz = parseFloat(raw.DWJZ);
  const ljjz = parseFloat(raw.LJJZ);
  if (!Number.isFinite(dwjz)) return null;
  return {
    ts_code: `${code}.OF`,
    end_date: fsrq,
    ann_date: null,
    unit_nav: dwjz,
    accum_nav: Number.isFinite(ljjz) ? ljjz : null,
    accum_div: null,
    net_asset: null,
    total_netasset: null,
    adj_nav: Number.isFinite(ljjz) ? ljjz : dwjz,  // 用累计净值近似复权
    source: 2,
  };
}

async function syncOne(code, idx, total, fullMode) {
  const tsCode = `${code}.OF`;
  const prefix = `[${String(idx + 1).padStart(String(total).length, ' ')}/${total}]`;
  const startedAt = new Date().toISOString();

  // 增量: 从 DB 最新日期 +1 天起
  let startDate = '';
  if (!fullMode) {
    const latest = getLatestNavDate(tsCode);
    if (latest) {
      const y = latest.slice(0, 4), m = latest.slice(4, 6), d = latest.slice(6, 8);
      const next = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10) + 1);
      startDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    }
  }

  try {
    const rows = await fetchAll(code, startDate, '');
    if (!rows.length) {
      console.log(`${prefix} ${code} — 无新数据 (自 ${startDate || 'beginning'})`);
      logSync({
        ts_code: tsCode, api_name: 'eastmoney_lsjz', status: 'success',
        record_count: 0, started_at: startedAt, finished_at: new Date().toISOString(),
      });
      return 0;
    }
    const records = rows.map(r => parseRow(code, r)).filter(Boolean);
    if (records.length === 0) {
      console.log(`${prefix} ${code} — 解析后 0 条`);
      return 0;
    }
    upsertNavRecords(records, 2);
    console.log(`${prefix} ${code} +${records.length} 条 (eastmoney)`);
    logSync({
      ts_code: tsCode, api_name: 'eastmoney_lsjz', status: 'success',
      record_count: records.length, started_at: startedAt, finished_at: new Date().toISOString(),
    });
    return records.length;
  } catch (e) {
    console.error(`${prefix} ${code} ❌ ${e.message}`);
    logSync({
      ts_code: tsCode, api_name: 'eastmoney_lsjz', status: 'error',
      started_at: startedAt, finished_at: new Date().toISOString(), error_message: e.message,
    });
    return 0;
  }
}

async function main() {
  const opts = parseArgs();
  const codes = resolveCodes(opts);

  console.log(`🌐 eastmoney lsjz 同步`);
  console.log(`   基金数量: ${codes.length}`);
  console.log(`   并发: ${opts.concurrency}`);
  console.log(`   模式: ${opts.full ? '全量' : '增量'}`);
  console.log('');

  if (codes.length === 0) { console.log('无可同步基金, 退出'); closeDb(); return; }

  let total = 0, success = 0, error = 0;
  const start = Date.now();
  let cursor = 0;
  async function worker() {
    while (cursor < codes.length) {
      const i = cursor++;
      try {
        const n = await syncOne(codes[i], i, codes.length, opts.full);
        total += n;
        success++;
      } catch (e) {
        error++;
        console.error(`worker error on ${codes[i]}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: opts.concurrency }, worker));

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('');
  console.log(`✅ 同步完成`);
  console.log(`   成功: ${success}  失败: ${error}`);
  console.log(`   新增/更新记录: ${total}`);
  console.log(`   耗时: ${elapsed}s`);
  closeDb();
}

main().catch(e => { console.error('💥', e); closeDb(); process.exit(1); });
