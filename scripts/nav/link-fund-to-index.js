#!/usr/bin/env node
/**
 * 把 fund_meta.tracking_target → index_basic 做关联, 写 index_fund_tracker.
 *
 * 匹配策略 (优先级递降):
 *   1. exact     — 归一后字符串完全一致 (跟 index_basic.name)
 *   2. fullname  — 跟 index_basic.fullname 一致
 *   3. fuzzy     — 去括号 / 后缀 (价格/总值/全收益/净收益) / 指数 后再比
 *
 * 用法:
 *   node scripts/nav/link-fund-to-index.js          # 实写 + 输出未匹配 top 30
 *   node scripts/nav/link-fund-to-index.js --dry    # 干跑, 仅报告
 *   node scripts/nav/link-fund-to-index.js --report data/index-link-report.json
 */

import fs from 'fs';
import { getDb, closeDb } from './db.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const reportIdx = args.indexOf('--report');
const reportPath = reportIdx !== -1 ? args[reportIdx + 1] : null;

const SUFFIX_RE = /(全收益指数|净收益指数|价格指数|全价总值指数|全价指数|总值指数|净价指数|全收益|净收益|价格|全价总值|全价|总值|净价|指数)$/;

/** 归一: 去括号注释, 反复剥离词尾后缀直到稳定, 折叠空格 */
function normalize(s) {
  if (!s) return '';
  let t = String(s).trim().replace(/[（(][^)）]*[)）]/g, '');
  let prev;
  do { prev = t; t = t.replace(SUFFIX_RE, ''); } while (t !== prev);
  return t.replace(/\s+/g, '').trim();
}

function main() {
  console.log(`🔗 link-fund-to-index ${dry ? '(dry)' : ''}`);
  const db = getDb();

  // 加载 index_basic 全表, 建立两个查找 map
  const indices = db.prepare('SELECT ts_code, name, fullname FROM index_basic').all();
  const byName = new Map();
  const byFullname = new Map();
  const byNorm = new Map();   // normalized → list of ts_code
  for (const idx of indices) {
    if (idx.name) byName.set(idx.name.trim(), idx.ts_code);
    if (idx.fullname) byFullname.set(idx.fullname.trim(), idx.ts_code);
    const n = normalize(idx.name);
    if (n) {
      if (!byNorm.has(n)) byNorm.set(n, []);
      byNorm.get(n).push(idx.ts_code);
    }
    const fn = normalize(idx.fullname);
    if (fn && fn !== n) {
      if (!byNorm.has(fn)) byNorm.set(fn, []);
      byNorm.get(fn).push(idx.ts_code);
    }
  }
  console.log(`  index_basic: ${indices.length}, name keys=${byName.size}, fuzzy keys=${byNorm.size}`);

  // 加载所有有 tracking_target 的 fund_meta
  const targets = db.prepare(`
    SELECT m.ts_code AS fund_ts_code, m.tracking_target, COUNT(*) OVER (PARTITION BY m.tracking_target) AS group_size
    FROM fund_meta m
    WHERE m.tracking_target IS NOT NULL AND m.tracking_target != ''
      AND m.tracking_target NOT LIKE '%无跟踪%'
  `).all();
  console.log(`  fund_meta: ${targets.length} 条带 tracking_target`);

  const stats = { exact: 0, fullname: 0, fuzzy: 0, ambiguous: 0, unmatched: 0 };
  const records = [];
  const unmatchedAgg = new Map();

  for (const t of targets) {
    const raw = t.tracking_target.trim();

    let indexTs = null, matchType = null;

    // 1. exact name
    if (byName.has(raw)) {
      indexTs = byName.get(raw); matchType = 'exact';
      stats.exact++;
    }
    // 2. fullname
    else if (byFullname.has(raw)) {
      indexTs = byFullname.get(raw); matchType = 'fullname';
      stats.fullname++;
    }
    // 3. fuzzy
    else {
      const norm = normalize(raw);
      const cands = byNorm.get(norm);
      if (cands && cands.length === 1) {
        indexTs = cands[0]; matchType = 'fuzzy';
        stats.fuzzy++;
      } else if (cands && cands.length > 1) {
        // 多候选: 优先 SSE/SZSE/CSI 主流, 再不行取第一个
        const preferred = cands.find(ts => /\.(SH|SZ|CSI)$/.test(ts));
        indexTs = preferred || cands[0];
        matchType = 'fuzzy';
        stats.fuzzy++;
        stats.ambiguous++;
      }
    }

    if (indexTs) {
      records.push({ index_ts_code: indexTs, fund_ts_code: t.fund_ts_code, match_type: matchType });
    } else {
      stats.unmatched++;
      unmatchedAgg.set(raw, (unmatchedAgg.get(raw) || 0) + 1);
    }
  }

  console.log('');
  console.log('📊 匹配结果');
  console.table({
    扫描: targets.length,
    exact: stats.exact,
    fullname: stats.fullname,
    fuzzy: stats.fuzzy,
    含歧义_fuzzy: stats.ambiguous,
    未匹配: stats.unmatched,
    覆盖率: ((targets.length - stats.unmatched) / targets.length * 100).toFixed(1) + '%',
  });

  if (!dry && records.length > 0) {
    const ins = db.prepare(`
      INSERT OR REPLACE INTO index_fund_tracker (index_ts_code, fund_ts_code, match_type)
      VALUES (?, ?, ?)
    `);
    const tx = db.transaction((rows) => {
      // 清空旧关系再写 (避免历史脏数据残留)
      db.prepare('DELETE FROM index_fund_tracker').run();
      for (const r of rows) ins.run(r.index_ts_code, r.fund_ts_code, r.match_type);
    });
    tx(records);
    console.log(`  ✅ 写入 ${records.length} 条 index_fund_tracker`);
  }

  // 未匹配 top 25
  const sortedUnmatched = [...unmatchedAgg.entries()].sort((a, b) => b[1] - a[1]);
  console.log('\n📋 未匹配头部 (按基金数排) top 25:');
  sortedUnmatched.slice(0, 25).forEach(([name, n]) => {
    console.log('  ' + n.toString().padStart(4), name);
  });

  if (reportPath) {
    fs.writeFileSync(reportPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      stats,
      unmatched: sortedUnmatched.map(([name, n]) => ({ tracking_target: name, fund_count: n })),
    }, null, 2), 'utf8');
    console.log(`\n📝 报告: ${reportPath}`);
  }

  closeDb();
}

main();
