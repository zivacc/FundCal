#!/usr/bin/env node
/**
 * 字段裁决 (合并规则落实)
 *
 * 输入: fund_meta.{name|fund_type|management|benchmark|found_date}_{crawler,tushare} 影子列
 * 输出: 写入 fund_basic 对应字段
 *
 * 规则矩阵:
 *   主源 = crawler, 兜底 = tushare:  name, fund_type, management, benchmark, found_date
 *   主源 = tushare 唯一:              status, market, custodian (本脚本不动)
 *
 * 归一化:
 *   - benchmark: '×' → '*', 多空格折叠, 圆角括号统一为半角
 *   - found_date: 紧凑格式 (YYYYMMDD) 写入 fund_basic; ISO (YYYY-MM-DD) 写入 fund_meta.found_date_normalized
 *
 * 用法:
 *   node scripts/nav/apply-merge-rules.js              # 实写
 *   node scripts/nav/apply-merge-rules.js --dry        # 仅打印 diff
 *   node scripts/nav/apply-merge-rules.js --audit out.json  # 输出变更明细 JSON
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, closeDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const auditIdx = args.indexOf('--audit');
const auditPath = auditIdx !== -1 ? args[auditIdx + 1] : null;

function isEmpty(v) {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

/** crawler 优先, 兜底 tushare; 双空回 null */
function pick(crawlerVal, tushareVal) {
  if (!isEmpty(crawlerVal)) return String(crawlerVal).trim();
  if (!isEmpty(tushareVal)) return String(tushareVal).trim();
  return null;
}

/** 业绩比较基准归一化 */
function normalizeBenchmark(s) {
  if (isEmpty(s)) return null;
  let t = String(s).trim();
  t = t.replace(/×/g, '*');
  t = t.replace(/（/g, '(').replace(/）/g, ')');
  t = t.replace(/\s+/g, '');
  return t;
}

/** YYYY-MM-DD 或 YYYYMMDD → YYYYMMDD */
function toCompactDate(s) {
  if (isEmpty(s)) return null;
  const t = String(s).trim();
  if (/^\d{8}$/.test(t)) return t;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t.replace(/-/g, '');
  return null;
}

/** YYYY-MM-DD 或 YYYYMMDD → YYYY-MM-DD */
function toIsoDate(s) {
  if (isEmpty(s)) return null;
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (/^\d{8}$/.test(t)) return `${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}`;
  return null;
}

function main() {
  const t0 = Date.now();
  console.log(`🔧 应用字段合并规则 ${dry ? '(dry-run)' : ''}`);

  const db = getDb();

  // 拉所有需要裁决的行
  const rows = db.prepare(`
    SELECT
      b.ts_code, b.code,
      b.name AS name_basic, b.fund_type AS fund_type_basic, b.management AS management_basic,
      b.benchmark AS benchmark_basic, b.found_date AS found_date_basic,
      m.name_crawler, m.fund_type_crawler, m.management_crawler, m.benchmark_crawler, m.found_date_crawler,
      m.name_tushare, m.fund_type_tushare, m.management_tushare, m.benchmark_tushare, m.found_date_tushare
    FROM fund_basic b
    JOIN fund_meta m ON m.ts_code = b.ts_code
  `).all();

  const updBasic = db.prepare(`
    UPDATE fund_basic SET
      name       = @name,
      fund_type  = @fund_type,
      management = @management,
      benchmark  = @benchmark,
      found_date = @found_date,
      updated_at = datetime('now')
    WHERE ts_code = @ts_code
  `);
  const updMetaFoundIso = db.prepare(`
    UPDATE fund_meta SET found_date_normalized = @iso, updated_at = datetime('now')
    WHERE ts_code = @ts_code
  `);

  const stats = {
    total: rows.length,
    changed: 0,
    name_changed: 0, fund_type_changed: 0, management_changed: 0, benchmark_changed: 0, found_date_changed: 0,
  };
  const audit = [];

  const tx = db.transaction((batch) => {
    for (const r of batch) {
      const newName       = pick(r.name_crawler, r.name_tushare);
      const newFundType   = pick(r.fund_type_crawler, r.fund_type_tushare);
      const newMgmt       = pick(r.management_crawler, r.management_tushare);
      const benchRaw      = pick(r.benchmark_crawler, r.benchmark_tushare);
      const newBench      = normalizeBenchmark(benchRaw);
      const dateRaw       = pick(r.found_date_crawler, r.found_date_tushare);
      const newFoundCompact = toCompactDate(dateRaw);
      const newFoundIso   = toIsoDate(dateRaw);

      const diff = {};
      if (!isEmpty(newName) && newName !== r.name_basic) {
        diff.name = { from: r.name_basic, to: newName };
        stats.name_changed++;
      }
      if (!isEmpty(newFundType) && newFundType !== r.fund_type_basic) {
        diff.fund_type = { from: r.fund_type_basic, to: newFundType };
        stats.fund_type_changed++;
      }
      if (!isEmpty(newMgmt) && newMgmt !== r.management_basic) {
        diff.management = { from: r.management_basic, to: newMgmt };
        stats.management_changed++;
      }
      if (!isEmpty(newBench) && newBench !== normalizeBenchmark(r.benchmark_basic)) {
        diff.benchmark = { from: r.benchmark_basic, to: newBench };
        stats.benchmark_changed++;
      }
      if (!isEmpty(newFoundCompact) && newFoundCompact !== r.found_date_basic) {
        diff.found_date = { from: r.found_date_basic, to: newFoundCompact };
        stats.found_date_changed++;
      }

      if (Object.keys(diff).length > 0) {
        stats.changed++;
        if (audit.length < 100000) {
          audit.push({ ts_code: r.ts_code, code: r.code, diff });
        }
        if (!dry) {
          updBasic.run({
            ts_code: r.ts_code,
            name: newName ?? r.name_basic,
            fund_type: newFundType ?? r.fund_type_basic,
            management: newMgmt ?? r.management_basic,
            benchmark: newBench ?? r.benchmark_basic,
            found_date: newFoundCompact ?? r.found_date_basic,
          });
        }
      }
      if (!dry && newFoundIso) {
        updMetaFoundIso.run({ ts_code: r.ts_code, iso: newFoundIso });
      }
    }
  });

  const BATCH = 2000;
  for (let i = 0; i < rows.length; i += BATCH) {
    tx(rows.slice(i, i + BATCH));
    if ((i / BATCH) % 5 === 0) {
      process.stdout.write(`\r  进度 ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
    }
  }
  process.stdout.write('\n');

  console.log('\n📊 裁决结果');
  console.table({
    扫描: stats.total,
    变更行: stats.changed,
    name: stats.name_changed,
    fund_type: stats.fund_type_changed,
    management: stats.management_changed,
    benchmark: stats.benchmark_changed,
    found_date: stats.found_date_changed,
  });

  if (auditPath) {
    const out = path.resolve(ROOT, auditPath);
    fs.writeFileSync(out, JSON.stringify({
      generatedAt: new Date().toISOString(),
      dryRun: dry,
      stats,
      sample: audit.slice(0, 200),
      total_audit_records: audit.length,
    }, null, 2), 'utf8');
    console.log(`📝 audit: ${out} (${audit.length} 条变更)`);
  }

  console.log(`⏱  耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  closeDb();
}

main();
