#!/usr/bin/env node
/**
 * 重放 sync_log 中失败的 fund_nav 同步任务.
 *
 * 默认: 取近 7 天 status='error' 且最新一次仍未成功的 ts_code, 调 sync-fund-nav 重跑增量.
 *
 * 用法:
 *   node scripts/nav/replay-failed-syncs.js
 *   node scripts/nav/replay-failed-syncs.js --since 2026-04-01
 *   node scripts/nav/replay-failed-syncs.js --concurrency 3
 *   node scripts/nav/replay-failed-syncs.js --dry            # 仅打印待重跑列表
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, closeDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { since: null, concurrency: 3, dry: false, limit: 0 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--since') opts.since = args[++i];
    else if (args[i] === '--concurrency') opts.concurrency = Math.max(1, parseInt(args[++i], 10) || 3);
    else if (args[i] === '--dry') opts.dry = true;
    else if (args[i] === '--limit') opts.limit = Math.max(0, parseInt(args[++i], 10) || 0);
  }
  return opts;
}

function defaultSince() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}

function findFailedTsCodes(since) {
  const db = getDb();
  // 找出: 在 since 之后, 该 ts_code 最近一次状态为 error
  const rows = db.prepare(`
    WITH last_status AS (
      SELECT ts_code,
             status,
             error_message,
             ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY finished_at DESC) AS rn
      FROM sync_log
      WHERE api_name = 'fund_nav' AND ts_code IS NOT NULL AND finished_at >= ?
    )
    SELECT ts_code, error_message FROM last_status
    WHERE rn = 1 AND status = 'error'
    ORDER BY ts_code
  `).all(since);
  return rows;
}

async function runSyncNavBatch(codes, concurrency) {
  return new Promise((resolve, reject) => {
    const node = process.execPath;
    const script = path.join(__dirname, 'sync-fund-nav.js');
    const args = [
      script,
      '--codes', codes.join(','),
      '--concurrency', String(concurrency),
    ];
    const child = spawn(node, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`sync-fund-nav exited with code ${code}`));
    });
  });
}

async function main() {
  const opts = parseArgs();
  const since = opts.since || defaultSince();
  console.log(`🔁 重放失败 fund_nav 任务 (since=${since})`);

  const failed = findFailedTsCodes(since);
  console.log(`  发现 ${failed.length} 个 ts_code 最近一次同步为 error`);

  if (failed.length === 0) {
    console.log('  无需重放. 退出.');
    closeDb();
    return;
  }

  // 错误归类
  const byMsg = new Map();
  for (const r of failed) {
    const k = (r.error_message || '').slice(0, 80);
    byMsg.set(k, (byMsg.get(k) || 0) + 1);
  }
  console.log('  错误类型分布 (前 5):');
  [...byMsg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([msg, n]) => {
    console.log(`    ${n.toString().padStart(5)}  ${msg}`);
  });

  let codes = failed.map(r => r.ts_code.split('.')[0]).filter(c => /^\d{6}$/.test(c) || /^F?\d+[A-Z]?$/.test(c));
  // 去重
  codes = [...new Set(codes)];
  if (opts.limit > 0) codes = codes.slice(0, opts.limit);

  if (opts.dry) {
    console.log(`\n[DRY] 待重跑 ${codes.length} 只:`);
    console.log(codes.slice(0, 30).join(','), codes.length > 30 ? `... +${codes.length - 30}` : '');
    closeDb();
    return;
  }

  closeDb();

  // 分批执行 (避免命令行参数过长)
  const BATCH = 200;
  for (let i = 0; i < codes.length; i += BATCH) {
    const chunk = codes.slice(i, i + BATCH);
    console.log(`\n▶ 批 ${Math.floor(i / BATCH) + 1} / ${Math.ceil(codes.length / BATCH)} (${chunk.length} 只)`);
    try {
      await runSyncNavBatch(chunk, opts.concurrency);
    } catch (e) {
      console.error(`批失败: ${e.message}`);
    }
  }

  console.log('\n✅ 重放完成');
}

main().catch(e => { console.error(e); process.exit(1); });
