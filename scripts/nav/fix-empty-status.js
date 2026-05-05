#!/usr/bin/env node
/**
 * 修复 fund_basic.status 为空的历史欠账.
 *
 * 现状: 部分基金 Tushare fund_basic 返回 status=NULL, 但 crawler 抓取成功 (说明在线).
 * 启发:
 *   - 若 crawler_updated_at 在近 90 天内 → status='L' (active)
 *   - 否则 status 留空 (人工核查)
 *
 * 同时把 market 推断为 'O' (默认场外); E 市场基金 ts_code 后缀 .SH/.SZ 已自带 status.
 *
 * 用法:
 *   node scripts/nav/fix-empty-status.js              # 实写
 *   node scripts/nav/fix-empty-status.js --dry        # 干跑
 */

import { getDb, closeDb } from './db.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');

function main() {
  console.log(`🔧 fix-empty-status ${dry ? '(dry)' : ''}`);
  const db = getDb();

  const candidates = db.prepare(`
    SELECT b.ts_code, b.code, b.name, m.crawler_updated_at, m.stage_returns_as_of
    FROM fund_basic b
    JOIN fund_meta m ON m.ts_code = b.ts_code
    WHERE (b.status IS NULL OR b.status = '')
  `).all();

  console.log(`  候选 ${candidates.length} 条`);

  const ninetyDaysAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  })();

  const toMarkL = candidates.filter(r =>
    r.crawler_updated_at && r.crawler_updated_at.slice(0, 10) >= ninetyDaysAgo
  );
  const skipped = candidates.length - toMarkL.length;

  console.log(`  推断 status='L': ${toMarkL.length} (crawler_updated_at >= ${ninetyDaysAgo})`);
  console.log(`  跳过 (crawler 数据陈旧或缺失): ${skipped}`);

  if (toMarkL.length > 0) {
    console.log(`  样本 5: ${toMarkL.slice(0, 5).map(r => `${r.code} ${r.name}`).join(' | ')}`);
  }

  if (!dry && toMarkL.length > 0) {
    const upd = db.prepare(`
      UPDATE fund_basic SET status='L', market=COALESCE(market,'O'), updated_at=datetime('now')
      WHERE ts_code = ?
    `);
    const tx = db.transaction((rows) => { for (const r of rows) upd.run(r.ts_code); });
    tx(toMarkL);

    // 同步刷新 fund_meta.status_tushare = 'L' (推断值, 标记来源为 inferred 并不清, 但保持兼容)
    const updMeta = db.prepare(`UPDATE fund_meta SET status_tushare = COALESCE(NULLIF(status_tushare,''), 'L') WHERE ts_code = ?`);
    const tx2 = db.transaction((rows) => { for (const r of rows) updMeta.run(r.ts_code); });
    tx2(toMarkL);

    console.log(`  ✅ 已写入 ${toMarkL.length} 条`);
  }

  closeDb();
}

main();
