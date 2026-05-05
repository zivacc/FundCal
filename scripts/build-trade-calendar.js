#!/usr/bin/env node
/**
 * 从 trade_calendar 表导出 data/allfund/trade-calendar.json (前端用).
 *
 * 输出格式:
 *   {
 *     version:   "ISO timestamp",
 *     exchange:  "SSE",
 *     from:      "19900101",
 *     to:        "20271231",
 *     openDays:  ["19901219", ..., "20271231"]   // YYYYMMDD 字符串数组
 *   }
 *
 * 前端用法 (示例):
 *   const cal = await fetch('/data/allfund/trade-calendar.json').then(r=>r.json());
 *   const openSet = new Set(cal.openDays);
 *   const isTradingDay = (d) => openSet.has(d);
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, closeDb } from './nav/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'allfund', 'trade-calendar.json');

function main() {
  const t0 = Date.now();
  console.log('📅 build-trade-calendar');
  const db = getDb();

  const openDays = db.prepare(
    "SELECT cal_date FROM trade_calendar WHERE is_open=1 ORDER BY cal_date"
  ).all().map(r => r.cal_date);

  const range = db.prepare(
    "SELECT MIN(cal_date) AS f, MAX(cal_date) AS t FROM trade_calendar"
  ).get();

  const payload = {
    version: new Date().toISOString(),
    exchange: 'SSE',
    from: range.f,
    to: range.t,
    openDays,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload), 'utf8');

  const stat = fs.statSync(OUT_PATH);
  console.log(`  ✅ ${OUT_PATH}`);
  console.log(`     ${openDays.length} 个开盘日, ${(stat.size / 1024).toFixed(1)} KB`);
  console.log(`     范围 ${range.f} ~ ${range.t}`);
  console.log(`  ⏱  ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  closeDb();
}

main();
