#!/usr/bin/env node
/**
 * 清理冗余 .OF 行: 同 code 同时有场内 (.SH/.SZ/.BJ) + .OF 时,
 * 如果 .OF 的 fund_nav 行数极少 (<10) 且场内已有充足数据 (>=10),
 * 删除 .OF 那些 nav 垃圾行 (保留 fund_basic + fund_meta 行用于审计).
 *
 * 同时清理 .OF 的 sync_log (按 ts_code), 减少噪声.
 *
 * 用法:
 *   node scripts/nav/cleanup-redundant-of.js          # 实写
 *   node scripts/nav/cleanup-redundant-of.js --dry    # 干跑
 *   node scripts/nav/cleanup-redundant-of.js --threshold 5  # 改阈值 (.OF 行数 < N 且场内 ≥ N 才删)
 */

import { getDb, closeDb } from './db.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const tIdx = args.indexOf('--threshold');
const THRESHOLD = tIdx !== -1 ? parseInt(args[tIdx + 1], 10) : 10;

function main() {
  console.log(`🧹 cleanup-redundant-of (.OF nav < ${THRESHOLD} 且场内 nav ≥ ${THRESHOLD}) ${dry ? '(dry)' : ''}`);
  const db = getDb();

  // 找出: 同 code 同时有 .OF 和场内, 且 .OF 行 nav 行数少, 场内行 nav 行数多
  const candidates = db.prepare(`
    WITH dup_codes AS (
      SELECT code FROM fund_basic
      GROUP BY code
      HAVING SUM(CASE WHEN ts_code LIKE '%.OF' THEN 1 ELSE 0 END) >= 1
        AND SUM(CASE WHEN ts_code LIKE '%.SH' OR ts_code LIKE '%.SZ' OR ts_code LIKE '%.BJ' THEN 1 ELSE 0 END) >= 1
    ),
    of_with_sparse AS (
      SELECT b.code, b.ts_code AS of_ts, COALESCE((SELECT COUNT(*) FROM fund_nav n WHERE n.ts_code = b.ts_code), 0) AS of_navs
      FROM fund_basic b
      WHERE b.code IN (SELECT code FROM dup_codes) AND b.ts_code LIKE '%.OF'
    ),
    ex_with_full AS (
      SELECT b.code, b.ts_code AS ex_ts, COALESCE((SELECT COUNT(*) FROM fund_nav n WHERE n.ts_code = b.ts_code), 0) AS ex_navs
      FROM fund_basic b
      WHERE b.code IN (SELECT code FROM dup_codes) AND (b.ts_code LIKE '%.SH' OR b.ts_code LIKE '%.SZ' OR b.ts_code LIKE '%.BJ')
    )
    SELECT o.code, o.of_ts, o.of_navs, e.ex_ts, e.ex_navs
    FROM of_with_sparse o JOIN ex_with_full e ON e.code = o.code
    WHERE o.of_navs < ? AND o.of_navs > 0 AND e.ex_navs >= ?
    ORDER BY o.code
  `).all(THRESHOLD, THRESHOLD);

  console.log(`  匹配 ${candidates.length} 条 .OF 待清理 nav 行`);

  let totalNavRows = 0;
  for (const c of candidates) totalNavRows += c.of_navs;
  console.log(`  待删 nav 总行数: ${totalNavRows}`);

  if (candidates.length === 0) {
    closeDb();
    return;
  }

  console.log('  样本 5:');
  candidates.slice(0, 5).forEach(c => {
    console.log(`    ${c.code}  .OF nav=${c.of_navs}  ${c.ex_ts} nav=${c.ex_navs}`);
  });

  if (dry) {
    closeDb();
    return;
  }

  const delNav = db.prepare('DELETE FROM fund_nav WHERE ts_code = ?');
  const tx = db.transaction((rows) => {
    for (const r of rows) delNav.run(r.of_ts);
  });
  tx(candidates);

  console.log(`  ✅ 已删 ${candidates.length} 个 .OF 的 ${totalNavRows} 行 nav`);
  closeDb();
}

main();
