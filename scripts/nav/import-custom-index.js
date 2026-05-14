#!/usr/bin/env node
/**
 * 通用自定义源指数数据导入器 (CSV / JSON / 自爬虫桥接).
 *
 * source=6 (custom). 用于 tushare/eastmoney 都不给数据的小众指数 (如内部编制 / 中债细分).
 *
 * 输入格式:
 *   CSV (UTF-8, 首行 header):
 *     end_date,open,high,low,close,pre_close,pct_chg,vol,amount
 *     20250101,100.0,101.5,99.8,101.2,99.9,1.30,1234567,890123456
 *
 *   JSON (数组):
 *     [{ "end_date": "20250101", "close": 101.2, ... }, ...]
 *
 * 用法:
 *   # 1. 先 register 指数到 index_basic (一次性, SQL 或单独脚本):
 *   sqlite3 data/fundcal.db "
 *     INSERT INTO index_basic(ts_code, code, name, publisher, category, market, primary_source)
 *     VALUES('CUSTOM-X1.GI','X1','内部指数X1','私有','自定义','OTC','custom');
 *     INSERT INTO index_source_map(ts_code, source, source_code) VALUES('CUSTOM-X1.GI','custom','X1');
 *   "
 *
 *   # 2. 用本脚本导入数据
 *   node scripts/nav/import-custom-index.js --ts-code CUSTOM-X1.GI --file data/external/x1.csv
 *   node scripts/nav/import-custom-index.js --ts-code CUSTOM-X1.GI --file data/external/x1.json --format json
 *
 * 自定义爬虫接口:
 *   写一个独立的 crawler-XXX.js, 输出 JSON 到临时文件, 再调用本脚本导入.
 *   也可直接 import 本脚本的 importRecords(tsCode, records) 函数.
 */

import fs from 'fs';
import path from 'path';
import { getDb, closeDb, upsertIndexDailyRecords, logSync } from './db.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { tsCode: null, file: null, format: 'auto' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ts-code') opts.tsCode = args[++i];
    else if (args[i] === '--file') opts.file = args[++i];
    else if (args[i] === '--format') opts.format = args[++i];
  }
  if (!opts.tsCode || !opts.file) {
    console.log('用法: --ts-code <ts_code> --file <path> [--format csv|json]');
    process.exit(1);
  }
  if (opts.format === 'auto') {
    opts.format = opts.file.toLowerCase().endsWith('.json') ? 'json' : 'csv';
  }
  return opts;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(s => s.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const obj = {};
    for (let j = 0; j < header.length; j++) obj[header[j]] = cols[j]?.trim() || null;
    rows.push(obj);
  }
  return rows;
}

function normalize(raw) {
  const date = String(raw.end_date || raw.date || raw.trade_date || '').replace(/-/g, '');
  if (!/^\d{8}$/.test(date)) return null;
  const close = parseFloat(raw.close);
  if (!Number.isFinite(close)) return null;
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    end_date: date,
    open: num(raw.open),
    high: num(raw.high),
    low: num(raw.low),
    close,
    pre_close: num(raw.pre_close),
    pct_chg: num(raw.pct_chg),
    vol: num(raw.vol),
    amount: num(raw.amount),
    source: 6,
  };
}

/** 程序化导入: 给定 ts_code 和 record 数组, 入库 */
export function importRecords(tsCode, rawRecords) {
  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM index_basic WHERE ts_code = ?').get(tsCode);
  if (!exists) throw new Error(`index_basic 中不存在 ${tsCode}, 请先 INSERT 基础信息`);

  const normalized = rawRecords.map(normalize).filter(Boolean);
  if (!normalized.length) {
    console.warn('  解析后 0 条有效');
    return 0;
  }
  const records = normalized.map(r => ({ ts_code: tsCode, ...r }));
  upsertIndexDailyRecords(records, 6);
  logSync({
    ts_code: tsCode, api_name: 'custom_import', status: 'success',
    record_count: records.length,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
  });
  return records.length;
}

function main() {
  const opts = parseArgs();
  const filePath = path.resolve(opts.file);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ 文件不存在: ${filePath}`);
    process.exit(1);
  }
  const text = fs.readFileSync(filePath, 'utf8');
  let raw;
  if (opts.format === 'json') raw = JSON.parse(text);
  else raw = parseCsv(text);
  if (!Array.isArray(raw)) raw = [raw];

  console.log(`📥 导入自定义指数 ${opts.tsCode}`);
  console.log(`   源文件: ${filePath} (${opts.format})`);
  console.log(`   原始记录: ${raw.length}`);

  const n = importRecords(opts.tsCode, raw);
  console.log(`   ✅ 入库 ${n} 条 (source=6 custom)`);
  closeDb();
}

main();
