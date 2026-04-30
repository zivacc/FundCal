#!/usr/bin/env node
/**
 * Crawler JSON → SQLite ETL
 *
 * 把 data/funds/<code>.json (26740) 合并入 fundcal.db。
 * 重叠字段：Tushare 非空优先，crawler 原值入 *_crawler 影子列做兜底/审计。
 * 独占字段：crawler 进 fund_meta / fund_fee_segments / fund_stage_returns。
 * 幂等：可反复跑。
 *
 * 用法:
 *   node scripts/migrate-crawler-to-db.js          # 实写
 *   node scripts/migrate-crawler-to-db.js --dry    # 试跑
 *   node scripts/migrate-crawler-to-db.js --limit 100  # 只跑前 100 只
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, closeDb } from './nav/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const FUNDS_DIR = path.join(ROOT, 'data', 'funds');
const REPORT_PATH = path.join(ROOT, 'data', 'migration-report.json');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 0;

/** YYYY-MM-DD 或 YYYYMMDD 都接受，统一输出 YYYY-MM-DD */
function normalizeDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return null;
}

/** YYYY-MM-DD → YYYYMMDD（fund_basic.found_date 用） */
function toCompactDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  if (/^\d{8}$/.test(t)) return t;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t.replace(/-/g, '');
  return null;
}

function isEmpty(v) {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

const SEGMENT_KIND_MAP = {
  subscribeFrontSegments: 'subscribe_front',
  purchaseFrontSegments: 'purchase_front',
  purchaseBackSegments: 'purchase_back',
  redeemSegments: 'redeem',
  sellFeeSegments: 'sell',
};

const OVERLAP_FIELDS = [
  ['name', 'name'],
  ['fund_type', 'fundType'],
  ['management', 'fundManager'],
  ['benchmark', 'performanceBenchmark'],
  ['found_date', 'establishmentDate'], // 比较时归一化日期
];

function loadCodes() {
  const idx = path.join(FUNDS_DIR, 'index.json');
  if (fs.existsSync(idx)) {
    try {
      const o = JSON.parse(fs.readFileSync(idx, 'utf8'));
      if (Array.isArray(o.codes) && o.codes.length) return o.codes;
    } catch {}
  }
  // 回退：扫目录
  return fs.readdirSync(FUNDS_DIR)
    .filter(n => /^\d{6}\.json$/.test(n))
    .map(n => n.replace('.json', ''));
}

function main() {
  const t0 = Date.now();
  console.log(`🔧 Crawler → SQLite 迁移 ${dry ? '(试跑)' : ''}`);

  const db = getDb();
  let codes = loadCodes();
  if (limit > 0) codes = codes.slice(0, limit);
  console.log(`📋 待处理 ${codes.length} 只基金`);

  // Prepared statements
  const selBasic = db.prepare('SELECT * FROM fund_basic WHERE code = ?');
  const insBasicStub = db.prepare(`
    INSERT OR REPLACE INTO fund_basic
      (ts_code, code, name, management, fund_type, found_date, benchmark, status, market, updated_at)
    VALUES (@ts_code, @code, @name, @management, @fund_type, @found_date, @benchmark, @status, @market, datetime('now'))
  `);
  const upsertMeta = db.prepare(`
    INSERT OR REPLACE INTO fund_meta (
      ts_code, code, source,
      tracking_target, trading_subscribe, trading_redeem,
      buy_fee, annual_fee, is_floating_annual_fee,
      mgmt_fee, custody_fee, sales_service_fee, operation_fee_total,
      net_asset_text, net_asset_amount_text, net_asset_as_of,
      stage_returns_as_of, crawler_updated_at, found_date_normalized,
      name_crawler, fund_type_crawler, management_crawler, benchmark_crawler, found_date_crawler,
      updated_at
    ) VALUES (
      @ts_code, @code, @source,
      @tracking_target, @trading_subscribe, @trading_redeem,
      @buy_fee, @annual_fee, @is_floating_annual_fee,
      @mgmt_fee, @custody_fee, @sales_service_fee, @operation_fee_total,
      @net_asset_text, @net_asset_amount_text, @net_asset_as_of,
      @stage_returns_as_of, @crawler_updated_at, @found_date_normalized,
      @name_crawler, @fund_type_crawler, @management_crawler, @benchmark_crawler, @found_date_crawler,
      datetime('now')
    )
  `);
  const delSegs = db.prepare('DELETE FROM fund_fee_segments WHERE ts_code = ?');
  const insSeg = db.prepare(`
    INSERT INTO fund_fee_segments (ts_code, kind, seq, to_days, rate)
    VALUES (?, ?, ?, ?, ?)
  `);
  const delStages = db.prepare('DELETE FROM fund_stage_returns WHERE ts_code = ?');
  const insStage = db.prepare(`
    INSERT INTO fund_stage_returns (ts_code, period, return_pct, return_text)
    VALUES (?, ?, ?, ?)
  `);

  const stats = {
    matched: 0,
    crawlerOnly: 0,
    parseErrors: 0,
    fileMissing: 0,
  };
  const conflicts = { name: 0, fund_type: 0, management: 0, benchmark: 0, found_date: 0 };
  const samples = { name: [], fund_type: [], management: [], benchmark: [], found_date: [] };

  function processOne(code) {
    const fp = path.join(FUNDS_DIR, `${code}.json`);
    if (!fs.existsSync(fp)) { stats.fileMissing++; return; }
    let crawler;
    try {
      crawler = JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch (e) { stats.parseErrors++; return; }

    const tushare = selBasic.get(code);
    const isMatched = !!tushare;
    const tsCode = tushare ? tushare.ts_code : `${code}.OF`;

    // 冲突计数（仅当两边非空且值不同）
    if (isMatched) {
      for (const [tsField, crField] of OVERLAP_FIELDS) {
        let tv = tushare[tsField];
        let cv = crawler[crField];
        if (tsField === 'found_date') {
          tv = normalizeDate(tv);
          cv = normalizeDate(cv);
        }
        if (!isEmpty(tv) && !isEmpty(cv) && String(tv).trim() !== String(cv).trim()) {
          conflicts[tsField]++;
          if (samples[tsField].length < 20) {
            samples[tsField].push({ code, tushare: tv, crawler: cv });
          }
        }
      }
      stats.matched++;
    } else {
      // crawler-only：插 fund_basic stub
      const cd = normalizeDate(crawler.establishmentDate);
      insBasicStub.run({
        ts_code: tsCode,
        code,
        name: crawler.name || null,
        management: crawler.fundManager || null,
        fund_type: crawler.fundType || null,
        found_date: cd ? toCompactDate(cd) : null,
        benchmark: crawler.performanceBenchmark || null,
        status: null,
        market: null,
      });
      stats.crawlerOnly++;
    }

    const op = crawler.operationFees || {};
    const ns = crawler.netAssetScale || {};
    const ts = crawler.tradingStatus || {};

    upsertMeta.run({
      ts_code: tsCode,
      code,
      source: isMatched ? 'both' : 'crawler',
      tracking_target: crawler.trackingTarget || null,
      trading_subscribe: ts.subscribe || null,
      trading_redeem: ts.redeem || null,
      buy_fee: crawler.buyFee ?? null,
      annual_fee: crawler.annualFee ?? null,
      is_floating_annual_fee: crawler.isFloatingAnnualFee ? 1 : 0,
      mgmt_fee: op.managementFee ?? null,
      custody_fee: op.custodyFee ?? null,
      sales_service_fee: op.salesServiceFee ?? null,
      operation_fee_total: op.total ?? null,
      net_asset_text: ns.text || null,
      net_asset_amount_text: ns.amountText || null,
      net_asset_as_of: ns.asOfDate || null,
      stage_returns_as_of: crawler.stageReturnsAsOf || null,
      crawler_updated_at: crawler.updatedAt || null,
      found_date_normalized: normalizeDate(
        (isMatched ? tushare.found_date : null) || crawler.establishmentDate
      ),
      name_crawler: crawler.name || null,
      fund_type_crawler: crawler.fundType || null,
      management_crawler: crawler.fundManager || null,
      benchmark_crawler: crawler.performanceBenchmark || null,
      found_date_crawler: normalizeDate(crawler.establishmentDate),
    });

    // 替换分段
    delSegs.run(tsCode);
    for (const [crKey, kind] of Object.entries(SEGMENT_KIND_MAP)) {
      const arr = crawler[crKey];
      if (!Array.isArray(arr)) continue;
      arr.forEach((s, i) => {
        const to = s.to !== undefined ? s.to : null;
        insSeg.run(tsCode, kind, i, to == null ? null : to, s.rate ?? null);
      });
    }

    // 替换 stage returns
    delStages.run(tsCode);
    if (Array.isArray(crawler.stageReturns)) {
      for (const sr of crawler.stageReturns) {
        if (!sr || !sr.period) continue;
        insStage.run(tsCode, sr.period, sr.returnPct ?? null, sr.returnText ?? null);
      }
    }
  }

  const tx = db.transaction((batch) => {
    for (const c of batch) processOne(c);
  });

  if (dry) {
    console.log('  (dry-run：仅遍历不写盘)');
    for (let i = 0; i < codes.length; i++) {
      const fp = path.join(FUNDS_DIR, `${codes[i]}.json`);
      if (!fs.existsSync(fp)) stats.fileMissing++;
    }
  } else {
    const BATCH = 1000;
    for (let i = 0; i < codes.length; i += BATCH) {
      tx(codes.slice(i, i + BATCH));
      if ((i / BATCH) % 5 === 0) {
        process.stdout.write(`\r  进度 ${Math.min(i + BATCH, codes.length)}/${codes.length}`);
      }
    }
    process.stdout.write('\n');

    // 收尾：给孤儿 fund_basic 行（Tushare-only）插 fund_meta 占位
    console.log('🔍 扫描 Tushare-only 基金...');
    const orphans = db.prepare(`
      SELECT b.ts_code, b.code FROM fund_basic b
      LEFT JOIN fund_meta m ON m.ts_code = b.ts_code
      WHERE m.ts_code IS NULL
    `).all();
    const insOrphan = db.prepare(`
      INSERT OR IGNORE INTO fund_meta (ts_code, code, source, found_date_normalized)
      VALUES (?, ?, 'tushare', ?)
    `);
    const txOrphan = db.transaction((rows) => {
      for (const r of rows) {
        const fd = db.prepare('SELECT found_date FROM fund_basic WHERE ts_code = ?').get(r.ts_code);
        insOrphan.run(r.ts_code, r.code, normalizeDate(fd?.found_date));
      }
    });
    txOrphan(orphans);
    stats.tushareOnly = orphans.length;
    console.log(`  ➕ ${orphans.length} 只 Tushare-only 占位插入`);
  }

  // 报告
  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      processed: codes.length,
      matched: stats.matched,
      crawlerOnly: stats.crawlerOnly,
      tushareOnly: stats.tushareOnly ?? 0,
      fileMissing: stats.fileMissing,
      parseErrors: stats.parseErrors,
    },
    conflicts,
    samples,
  };
  if (!dry) fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n📊 结果');
  console.table(report.totals);
  console.log('字段冲突 (两边均非空且值不同):');
  console.table(conflicts);
  console.log(`\n⏱ 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!dry) console.log(`📝 报告: ${REPORT_PATH}`);

  closeDb();
}

main();
