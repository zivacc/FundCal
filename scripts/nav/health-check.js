#!/usr/bin/env node
/**
 * 数据健康体检脚本
 * 输出 markdown 报告 + 退码 (0=健康, 1=有警告, 2=有严重问题)
 *
 * 用法:
 *   node scripts/nav/health-check.js                # 控制台输出 markdown
 *   node scripts/nav/health-check.js --json         # 输出 JSON
 *   node scripts/nav/health-check.js --out report.md
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, closeDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const outIdx = args.indexOf('--out');
const outPath = outIdx !== -1 ? args[outIdx + 1] : null;

const SEVERITY = { ok: 0, warn: 1, fail: 2 };
const checks = [];

function record(name, severity, detail, data) {
  checks.push({ name, severity, detail, data });
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDate(yyyymmdd, deltaDays) {
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  const dt = new Date(y, m, d + deltaDays);
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`;
}

function runChecks(db) {
  // C1 — fund_basic 总数 / source / status 分布
  const total = db.prepare('SELECT COUNT(*) AS n FROM fund_basic').get().n;
  const bySource = db.prepare('SELECT source, COUNT(*) AS n FROM fund_meta GROUP BY source').all();
  const byStatus = db.prepare("SELECT COALESCE(NULLIF(status,''),'(空)') AS status, COUNT(*) AS n FROM fund_basic GROUP BY status").all();
  record('C1 fund_basic 全景', SEVERITY.ok, `共 ${total} 条`, { total, bySource, byStatus });

  // C2 — 空 status 但 source=both
  const emptyStatusBoth = db.prepare(`
    SELECT COUNT(*) AS n FROM fund_basic b
    JOIN fund_meta m ON m.ts_code = b.ts_code
    WHERE (b.status IS NULL OR b.status = '') AND m.source = 'both'
  `).get().n;
  record(
    'C2 空 status (source=both)',
    emptyStatusBoth > 0 ? SEVERITY.fail : SEVERITY.ok,
    emptyStatusBoth > 0 ? `${emptyStatusBoth} 条本应有 status 却为空` : '无',
    { count: emptyStatusBoth },
  );

  // C3 — 空 fund_type
  const emptyType = db.prepare("SELECT COUNT(*) AS n FROM fund_basic WHERE fund_type IS NULL OR fund_type = ''").get().n;
  record(
    'C3 空 fund_type',
    emptyType > 100 ? SEVERITY.warn : SEVERITY.ok,
    `${emptyType} 条`,
    { count: emptyType },
  );

  // C4 — status='L' 但无 nav
  const lNoNavRows = db.prepare(`
    SELECT b.ts_code, b.code, b.name, b.found_date FROM fund_basic b
    WHERE b.status = 'L'
      AND b.ts_code NOT IN (SELECT DISTINCT ts_code FROM fund_nav)
    LIMIT 10
  `).all();
  const lNoNav = db.prepare(`
    SELECT COUNT(*) AS n FROM fund_basic
    WHERE status = 'L' AND ts_code NOT IN (SELECT DISTINCT ts_code FROM fund_nav)
  `).get().n;
  record(
    'C4 status=L 但无 nav',
    lNoNav > 50 ? SEVERITY.fail : (lNoNav > 0 ? SEVERITY.warn : SEVERITY.ok),
    `${lNoNav} 条`,
    { count: lNoNav, sample: lNoNavRows },
  );

  // C5 — nav 最新日 < 今天-3 工作日
  const navLatest = db.prepare('SELECT MAX(end_date) AS d FROM fund_nav').get().d;
  const cutoff = shiftDate(todayStr(), -5);
  const navStale = navLatest && navLatest < cutoff;
  record(
    'C5 nav 数据新鲜度',
    navStale ? SEVERITY.fail : SEVERITY.ok,
    `最新 end_date=${navLatest}，阈值=${cutoff}`,
    { latest: navLatest, cutoff, stale: navStale },
  );

  // C6 — crawler 数据 > 30 天未更新 (近期 fund_meta.crawler_updated_at)
  const crawlerLatest = db.prepare("SELECT MAX(crawler_updated_at) AS d FROM fund_meta WHERE crawler_updated_at IS NOT NULL").get().d;
  const thirtyDayCutoff = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();
  const crawlerStale = crawlerLatest && crawlerLatest < thirtyDayCutoff;
  record(
    'C6 crawler 数据新鲜度',
    crawlerStale ? SEVERITY.warn : SEVERITY.ok,
    `最新 crawler_updated_at=${crawlerLatest}，阈值=${thirtyDayCutoff}`,
    { latest: crawlerLatest, cutoff: thirtyDayCutoff, stale: crawlerStale },
  );

  // C7 — fund_meta.source 与子表存在性一致性
  const bothNoStage = db.prepare(`
    SELECT COUNT(*) AS n FROM fund_meta m
    WHERE m.source = 'both'
      AND m.ts_code NOT IN (SELECT DISTINCT ts_code FROM fund_stage_returns)
  `).get().n;
  const bothNoFee = db.prepare(`
    SELECT COUNT(*) AS n FROM fund_meta m
    WHERE m.source = 'both'
      AND m.ts_code NOT IN (SELECT DISTINCT ts_code FROM fund_fee_segments)
  `).get().n;
  const consistencyFail = bothNoStage > 100 || bothNoFee > 100;
  record(
    'C7 source=both 子表完整性',
    consistencyFail ? SEVERITY.warn : SEVERITY.ok,
    `无 stage_returns: ${bothNoStage}，无 fee_segments: ${bothNoFee}`,
    { bothNoStage, bothNoFee },
  );

  // C8 — 近 24h sync_log 错误率
  const since = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString();
  })();
  const successCnt = db.prepare("SELECT COUNT(*) AS n FROM sync_log WHERE finished_at >= ? AND status='success'").get(since).n;
  const errorCnt = db.prepare("SELECT COUNT(*) AS n FROM sync_log WHERE finished_at >= ? AND status='error'").get(since).n;
  const totalCalls = successCnt + errorCnt;
  const errorRate = totalCalls > 0 ? errorCnt / totalCalls : 0;
  const topErrors = db.prepare(`
    SELECT error_message, COUNT(*) AS n FROM sync_log
    WHERE finished_at >= ? AND status='error'
    GROUP BY error_message ORDER BY n DESC LIMIT 5
  `).all(since);
  record(
    'C8 近 24h sync_log 错误率',
    errorRate > 0.2 ? SEVERITY.fail : (errorRate > 0.05 ? SEVERITY.warn : SEVERITY.ok),
    `success=${successCnt} error=${errorCnt} (错误率 ${(errorRate * 100).toFixed(1)}%)`,
    { successCnt, errorCnt, errorRate, topErrors },
  );

  // C9 — 字段合并冲突 (基于影子列)
  const conflicts = db.prepare(`
    SELECT
      SUM(CASE WHEN m.name_crawler IS NOT NULL AND m.name_crawler <> '' AND b.name IS NOT NULL AND b.name <> '' AND b.name <> m.name_crawler THEN 1 ELSE 0 END) AS name_diff,
      SUM(CASE WHEN m.fund_type_crawler IS NOT NULL AND m.fund_type_crawler <> '' AND b.fund_type IS NOT NULL AND b.fund_type <> '' AND b.fund_type <> m.fund_type_crawler THEN 1 ELSE 0 END) AS type_diff,
      SUM(CASE WHEN m.management_crawler IS NOT NULL AND m.management_crawler <> '' AND b.management IS NOT NULL AND b.management <> '' AND b.management <> m.management_crawler THEN 1 ELSE 0 END) AS mgmt_diff,
      SUM(CASE WHEN m.benchmark_crawler IS NOT NULL AND m.benchmark_crawler <> '' AND b.benchmark IS NOT NULL AND b.benchmark <> '' AND b.benchmark <> m.benchmark_crawler THEN 1 ELSE 0 END) AS bench_diff,
      SUM(CASE WHEN m.found_date_crawler IS NOT NULL AND m.found_date_crawler <> '' AND b.found_date IS NOT NULL AND b.found_date <> '' AND substr(b.found_date,1,4)||'-'||substr(b.found_date,5,2)||'-'||substr(b.found_date,7,2) <> m.found_date_crawler THEN 1 ELSE 0 END) AS founded_diff
    FROM fund_basic b JOIN fund_meta m ON m.ts_code = b.ts_code
  `).get();
  const totalDiff = (conflicts.name_diff || 0) + (conflicts.type_diff || 0) + (conflicts.mgmt_diff || 0) + (conflicts.bench_diff || 0) + (conflicts.founded_diff || 0);
  record(
    'C9 字段合并冲突 (apply-merge-rules 待跑)',
    totalDiff > 1000 ? SEVERITY.warn : SEVERITY.ok,
    `name=${conflicts.name_diff} type=${conflicts.type_diff} mgmt=${conflicts.mgmt_diff} bench=${conflicts.bench_diff} found=${conflicts.founded_diff}`,
    conflicts,
  );

  // C10 — fund_nav 覆盖率 (有 nav 的基金 / status='L' 总基金)
  const lTotal = db.prepare("SELECT COUNT(*) AS n FROM fund_basic WHERE status='L'").get().n;
  const lWithNav = db.prepare(`
    SELECT COUNT(DISTINCT b.ts_code) AS n FROM fund_basic b
    WHERE b.status='L' AND b.ts_code IN (SELECT ts_code FROM fund_nav)
  `).get().n;
  const navCoverage = lTotal > 0 ? lWithNav / lTotal : 1;
  record(
    'C10 nav 覆盖率 (status=L)',
    navCoverage < 0.95 ? SEVERITY.warn : SEVERITY.ok,
    `${lWithNav}/${lTotal} (${(navCoverage * 100).toFixed(2)}%)`,
    { lTotal, lWithNav, coverage: navCoverage },
  );
}

function severityLabel(n) {
  return n === 0 ? '✅ OK' : n === 1 ? '⚠️ WARN' : '❌ FAIL';
}

function toMarkdown() {
  const maxSev = checks.reduce((m, c) => Math.max(m, c.severity), 0);
  const lines = [];
  lines.push(`# 数据健康体检报告`);
  lines.push('');
  lines.push(`生成时间: ${new Date().toISOString()}`);
  lines.push(`总体: **${severityLabel(maxSev)}** (检查 ${checks.length} 项)`);
  lines.push('');
  lines.push('| 项 | 等级 | 摘要 |');
  lines.push('|---|---|---|');
  for (const c of checks) {
    lines.push(`| ${c.name} | ${severityLabel(c.severity)} | ${c.detail} |`);
  }
  lines.push('');
  lines.push('## 详情');
  for (const c of checks) {
    lines.push('');
    lines.push(`### ${c.name} — ${severityLabel(c.severity)}`);
    lines.push('');
    lines.push(`摘要: ${c.detail}`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(c.data, null, 2));
    lines.push('```');
  }
  return lines.join('\n');
}

function main() {
  const db = getDb();
  runChecks(db);
  closeDb();

  const maxSev = checks.reduce((m, c) => Math.max(m, c.severity), 0);

  if (asJson) {
    const out = JSON.stringify({ generatedAt: new Date().toISOString(), severity: maxSev, checks }, null, 2);
    if (outPath) fs.writeFileSync(path.resolve(ROOT, outPath), out, 'utf8');
    else console.log(out);
  } else {
    const md = toMarkdown();
    if (outPath) fs.writeFileSync(path.resolve(ROOT, outPath), md, 'utf8');
    else console.log(md);
  }

  process.exit(maxSev === 2 ? 2 : (maxSev === 1 ? 1 : 0));
}

main();
