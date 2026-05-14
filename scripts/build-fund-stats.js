/**
 * 基于 fundcal.db 生成 data/allfund/fund-stats.json (体积 ~1.7 MB, 静态兜底用)
 * 维度: tracking / manager / benchmark / fundType (与 /api/fund/stats 输出对齐)
 *
 * 已停产: fund-stats-detail.json (21 MB, 现由 /api/fund/stats/detail 按需提供, 历史归档至 archive/)
 *
 * 用法: node scripts/build-fund-stats.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pinyin } from 'pinyin-pro';
import { getDb, closeDb } from './nav/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALLFUND_DIR = path.join(__dirname, '..', 'data', 'allfund');
const FUND_STATS_PATH = path.join(ALLFUND_DIR, 'fund-stats.json');

function getInitials(text) {
  if (!text || typeof text !== 'string') return '';
  try {
    const arr = pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' });
    return (arr || []).join('').toLowerCase();
  } catch {
    return '';
  }
}

function buildStats(db) {
  const rows = db.prepare(`
    SELECT m.code, m.tracking_target,
      COALESCE(b.management, m.management_crawler) AS manager,
      COALESCE(b.benchmark, m.benchmark_crawler) AS benchmark,
      COALESCE(b.fund_type, m.fund_type_crawler) AS fund_type
    FROM fund_meta m LEFT JOIN fund_basic b ON b.ts_code = m.ts_code
    WHERE m.source IN ('both', 'crawler')
  `).all();

  const trackingMap = new Map();
  const managerMap = new Map();
  const benchmarkMap = new Map();
  const fundTypeMap = new Map();
  let trackingFundCount = 0;

  const inc = (map, key, code) => {
    const k = key || '';
    let entry = map.get(k);
    if (!entry) { entry = { label: k, count: 0, codes: [] }; map.set(k, entry); }
    entry.count += 1;
    if (code) entry.codes.push(code);
  };

  for (const r of rows) {
    const rawTracking = (r.tracking_target || '').trim();
    const isNoTracking = !rawTracking || rawTracking.includes('该基金无跟踪标的');
    const fundManager = (r.manager || '').trim();
    const performanceBenchmark = (r.benchmark || '').trim();
    const fundType = (r.fund_type || '').trim();

    if (!isNoTracking) {
      trackingFundCount += 1;
      inc(trackingMap, rawTracking, r.code);
    }
    if (fundManager) inc(managerMap, fundManager, r.code);
    if (performanceBenchmark) inc(benchmarkMap, performanceBenchmark, r.code);
    if (fundType) inc(fundTypeMap, fundType, r.code);
  }

  const toSortedArray = (m) =>
    Array.from(m.values())
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));

  const tracking = toSortedArray(trackingMap).map(item => ({
    ...item,
    initials: getInitials(item.label),
  }));

  return {
    total: rows.length,
    trackingFundCount,
    tracking,
    manager: toSortedArray(managerMap),
    benchmark: toSortedArray(benchmarkMap),
    fundType: toSortedArray(fundTypeMap),
  };
}

function main() {
  const db = getDb();
  const stats = buildStats(db);
  fs.mkdirSync(ALLFUND_DIR, { recursive: true });
  fs.writeFileSync(FUND_STATS_PATH, JSON.stringify(stats), 'utf8');
  console.log(`已生成 ${FUND_STATS_PATH}, total=${stats.total}, trackingFundCount=${stats.trackingFundCount}`);
  closeDb();
}

main();
