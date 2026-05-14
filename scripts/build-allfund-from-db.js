#!/usr/bin/env node
/**
 * 从 fundcal.db 重建 data/allfund/* 静态文件
 *
 * 输出 (服务器化后保留的小文件; 大文件已下线 → archive/):
 *   data/allfund/funds/<code>.json     — 单基金分片 (灾备 fallback / 纯静态站点)
 *   data/allfund/search-index.json     — [{code, name, initials}]
 *   data/allfund/index-search-index.json — 指数搜索池
 *
 * 已停产 (生产走 /api/fund/list 与 /api/fund/:code/fee, 历史归档至 archive/):
 *   data/allfund/allfund.json   (75 MB)
 *   data/allfund/list-index.json (26 MB)
 *
 * 字段策略：fund_basic 已是裁决后权威值 (apply-merge-rules 写入)
 *   - name / fundType / fundManager / performanceBenchmark / establishmentDate 均直接读 fund_basic
 *   - 仅当 fund_basic 字段意外为空时, 回退 *_crawler / *_tushare 影子列做兜底
 *
 * 用法:
 *   node scripts/build-allfund-from-db.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pinyin } from 'pinyin-pro';
import { getDb, closeDb } from './nav/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ALLFUND_DIR = path.join(ROOT, 'data', 'allfund');
const SEARCH_INDEX_PATH = path.join(ALLFUND_DIR, 'search-index.json');
const INDEX_SEARCH_PATH = path.join(ALLFUND_DIR, 'index-search-index.json');
const SHARDED_FUNDS_DIR = path.join(ALLFUND_DIR, 'funds');

const SEG_KIND_TO_KEY = {
  subscribe_front: 'subscribeFrontSegments',
  purchase_front:  'purchaseFrontSegments',
  purchase_back:   'purchaseBackSegments',
  redeem:          'redeemSegments',
  sell:            'sellFeeSegments',
};

function getInitials(text) {
  if (!text || typeof text !== 'string') return '';
  try {
    const arr = pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' });
    return (arr || []).join('').toLowerCase();
  } catch {
    return '';
  }
}

/** 优先 authoritative (fund_basic), 兜底 crawler 影子, 再兜底 tushare 影子 */
function fallback(...vals) {
  for (const v of vals) {
    if (v != null && String(v).trim() !== '') return v;
  }
  return '';
}

/** 拼装单个基金完整 JSON（向后兼容旧 schema 字段） */
function buildFundObject(row, segsByKind, stageReturns) {
  const name = fallback(row.name, row.name_crawler, row.name_tushare);
  const fundType = fallback(row.fund_type, row.fund_type_crawler, row.fund_type_tushare);
  const fundManager = fallback(row.management, row.management_crawler, row.management_tushare);
  const benchmark = fallback(row.benchmark, row.benchmark_crawler, row.benchmark_tushare);
  const establishmentDate = fallback(row.found_date_normalized, row.found_date_tushare);

  const obj = {
    code: row.code,
    name,
    source: row.source === 'both' ? 'eastmoney' : (row.source || 'crawler'),
    updatedAt: row.crawler_updated_at || '',
    trackingTarget: row.tracking_target || '',
    fundManager,
    performanceBenchmark: benchmark,
    fundType,
    shareClass: row.share_class || null,
    tradingStatus: (row.trading_subscribe || row.trading_redeem) ? {
      subscribe: row.trading_subscribe || '',
      redeem: row.trading_redeem || '',
    } : null,
    operationFees: {
      managementFee: row.mgmt_fee ?? 0,
      custodyFee: row.custody_fee ?? 0,
      salesServiceFee: row.sales_service_fee ?? 0,
      total: row.operation_fee_total ?? 0,
    },
    buyFee: row.buy_fee ?? 0,
    annualFee: row.annual_fee ?? 0,
    isFloatingAnnualFee: !!row.is_floating_annual_fee,
    netAssetScale: row.net_asset_text ? {
      text: row.net_asset_text,
      amountText: row.net_asset_amount_text || '',
      asOfDate: row.net_asset_as_of || '',
    } : null,
    stageReturns,
    stageReturnsAsOf: row.stage_returns_as_of || null,
    establishmentDate,
  };

  for (const [kind, key] of Object.entries(SEG_KIND_TO_KEY)) {
    obj[key] = (segsByKind[kind] || []).map(s => ({
      to: s.to_days,
      rate: s.rate,
    }));
  }

  return obj;
}

function main() {
  const t0 = Date.now();
  console.log('🔧 build-allfund-from-db');

  const db = getDb();

  // 主查询：拉所有 fund_meta + fund_basic JOIN
  const rows = db.prepare(`
    SELECT
      m.ts_code, m.code, m.source,
      m.tracking_target, m.trading_subscribe, m.trading_redeem,
      m.buy_fee, m.annual_fee, m.is_floating_annual_fee,
      m.mgmt_fee, m.custody_fee, m.sales_service_fee, m.operation_fee_total,
      m.net_asset_text, m.net_asset_amount_text, m.net_asset_as_of,
      m.stage_returns_as_of, m.crawler_updated_at, m.found_date_normalized,
      m.name_crawler, m.fund_type_crawler, m.management_crawler, m.benchmark_crawler,
      m.name_tushare, m.fund_type_tushare, m.management_tushare, m.benchmark_tushare, m.found_date_tushare,
      m.share_class,
      b.name, b.management, b.fund_type, b.benchmark, b.status
    FROM fund_meta m
    LEFT JOIN fund_basic b ON b.ts_code = m.ts_code
    ORDER BY m.code
  `).all();

  console.log(`📋 读取 ${rows.length} 行`);

  // 预拉所有 segments 一次
  const allSegs = db.prepare(`
    SELECT ts_code, kind, seq, to_days, rate
    FROM fund_fee_segments
    ORDER BY ts_code, kind, seq
  `).all();
  const segMap = new Map();
  for (const s of allSegs) {
    if (!segMap.has(s.ts_code)) segMap.set(s.ts_code, {});
    const buckets = segMap.get(s.ts_code);
    if (!buckets[s.kind]) buckets[s.kind] = [];
    buckets[s.kind].push(s);
  }
  console.log(`📋 读取 ${allSegs.length} 段`);

  // 预拉所有 stage_returns
  const allStages = db.prepare(`
    SELECT ts_code, period, return_pct, return_text
    FROM fund_stage_returns
    ORDER BY ts_code
  `).all();
  const stageMap = new Map();
  for (const r of allStages) {
    if (!stageMap.has(r.ts_code)) stageMap.set(r.ts_code, []);
    stageMap.get(r.ts_code).push({
      period: r.period,
      returnPct: r.return_pct,
      returnText: r.return_text || '',
    });
  }
  console.log(`📋 读取 ${allStages.length} stage returns`);

  fs.mkdirSync(ALLFUND_DIR, { recursive: true });
  fs.mkdirSync(SHARDED_FUNDS_DIR, { recursive: true });

  // search-index 含 tushare-only 占位行 (needsCrawl=true, 前端灰显 + 补全按钮)
  // 单基金分片 funds/<code>.json 仅 crawler-having (有费率字段, 能计算)
  let writtenShards = 0;
  const searchList = [];

  for (const row of rows) {
    const code = row.code;
    const segsByKind = segMap.get(row.ts_code) || {};
    const stageReturns = stageMap.get(row.ts_code) || [];
    const obj = buildFundObject(row, segsByKind, stageReturns);
    const needsCrawl = row.source === 'tushare';

    if (!needsCrawl) {
      fs.writeFileSync(
        path.join(SHARDED_FUNDS_DIR, `${code}.json`),
        JSON.stringify(obj),
        'utf8'
      );
      writtenShards++;
    }

    const initials = getInitials(obj.name);
    searchList.push({ code, name: obj.name, initials, needsCrawl });
  }

  console.log(`📝 写入 ${writtenShards} 只单基金分片到 ${SHARDED_FUNDS_DIR}`);

  fs.writeFileSync(SEARCH_INDEX_PATH, JSON.stringify(searchList), 'utf8');
  console.log(`📝 写入 search-index.json (${searchList.length} 条)`);

  // ─── 指数搜索索引 (与基金共享 typeahead) ───
  // 仅含 index_daily 实际有数据的指数; ts_code 直接作为 code 字段, 与基金 6 位 code 共存
  const indexRows = db.prepare(`
    SELECT b.ts_code, b.name, b.fullname
    FROM index_basic b
    WHERE EXISTS (SELECT 1 FROM index_daily d WHERE d.ts_code = b.ts_code)
    ORDER BY b.ts_code
  `).all();
  const indexSearchList = indexRows.map(r => ({
    code: r.ts_code,
    name: r.name || r.ts_code,
    fullname: r.fullname || '',
    initials: getInitials(r.name || ''),
    kind: 'index',
    isPrice: !/全收益/.test(r.fullname || ''),
  }));
  fs.writeFileSync(INDEX_SEARCH_PATH, JSON.stringify(indexSearchList), 'utf8');
  console.log(`📝 写入 ${indexSearchList.length} 条 index-search-index.json`);

  console.log(`\n⏱ 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  closeDb();
}

main();
