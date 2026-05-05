#!/usr/bin/env node
/**
 * 从 fund_basic.name 解析份额类别 (A/B/C/D/E/H/I/O/R/Y 等), 写入 fund_meta.share_class.
 *
 * 识别策略 (优先级从高到低):
 *   1. F 前缀 / 968 前缀 → 标记 'overseas' (海外/中港互认)
 *   2. name 末尾紧贴汉字 + 1-3 字符字母组合 (含 /) → 取该字母组合
 *   3. 移除币种 (人民币/美元/港币/欧元 等) 后再次尝试
 *   4. 无后缀 → null (单一份额)
 *
 * 用法:
 *   node scripts/nav/parse-share-class.js          # 实写
 *   node scripts/nav/parse-share-class.js --dry    # 干跑
 */

import { getDb, closeDb } from './db.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');

const CURRENCY_SUFFIX = /(?:人民币|美元|港币|欧元|英镑|日元|澳元|加元)$/;
const STRUCTURE_SUFFIX = /(?:持有期?|定开|定期开放|每日申赎|滚动持有|一年|两年|三年|五年|六个月|三个月)$/;

const VALID_CLASSES = new Set(['A','B','C','D','E','F','G','H','I','O','R','Y','M','N','S','T','U','V','W','X','Z']);

function ensureColumn(db) {
  const cols = db.prepare("PRAGMA table_info(fund_meta)").all().map(r => r.name);
  if (!cols.includes('share_class')) {
    db.exec(`ALTER TABLE fund_meta ADD COLUMN share_class TEXT`);
    console.log('[db] 已添加 fund_meta.share_class 列');
  }
}

function parseShareClass(code, name) {
  if (!name) return { value: null, note: 'no_name' };

  // 海外标识
  if (/^968\d{3}$/.test(code) || /^F\d/.test(code)) {
    // 海外基金继续走解析以识别其内部份额, 但加 overseas 注解
  }

  let n = String(name).trim();
  // 剥离币种后缀
  n = n.replace(CURRENCY_SUFFIX, '').trim();
  // 剥离期限/结构后缀
  n = n.replace(STRUCTURE_SUFFIX, '').trim();
  // 移除尾部空白和括号
  n = n.replace(/[\s)\]）】]+$/, '').trim();

  // 后缀: 1) 组合 A/B、A/C、A/B/C 等
  const combo = n.match(/([A-Z](?:\/[A-Z]){1,3})$/);
  if (combo) return { value: combo[1], note: 'combo' };

  // 后缀: 2) 单字符或双字符 (E/H/Y 等紧贴汉字)
  // 要求字母前是汉字或 ) 等结束符号, 防止把 "HSGS" 误分
  const single = n.match(/[一-龥）)]([A-Z]{1,2})$/);
  if (single) {
    const cls = single[1];
    // 验证: 双字符必须是已知组合 (例 BC), 否则视为产品代号不分类
    if (cls.length === 2 && !['BC', 'AC', 'AB'].includes(cls)) {
      return { value: null, note: `unknown_double_${cls}` };
    }
    if (cls.length === 1 && !VALID_CLASSES.has(cls)) {
      return { value: null, note: `unknown_single_${cls}` };
    }
    return { value: cls, note: 'suffix' };
  }

  return { value: null, note: 'no_suffix' };
}

function main() {
  console.log(`🔧 parse-share-class ${dry ? '(dry)' : ''}`);
  const db = getDb();
  if (!dry) ensureColumn(db);

  const rows = db.prepare(`
    SELECT b.ts_code, b.code, b.name FROM fund_basic b
    JOIN fund_meta m ON m.ts_code = b.ts_code
  `).all();

  console.log(`  扫描 ${rows.length} 只基金`);

  const stats = { withClass: 0, noSuffix: 0, unknown: 0, byClass: {} };
  const updates = [];

  for (const r of rows) {
    const { value, note } = parseShareClass(r.code, r.name);
    if (value) {
      stats.withClass++;
      stats.byClass[value] = (stats.byClass[value] || 0) + 1;
      updates.push({ ts_code: r.ts_code, share_class: value });
    } else if (note === 'no_suffix' || note === 'no_name') {
      stats.noSuffix++;
    } else {
      stats.unknown++;
    }
  }

  console.log(`  有份额标识: ${stats.withClass}  无后缀: ${stats.noSuffix}  未知双字符: ${stats.unknown}`);
  console.log('  分类分布:');
  Object.entries(stats.byClass)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`    ${k.padEnd(6)} ${n}`));

  if (!dry && updates.length > 0) {
    if (!ensureColumn) ensureColumn(db);
    const upd = db.prepare(`UPDATE fund_meta SET share_class = ?, updated_at = datetime('now') WHERE ts_code = ?`);
    const tx = db.transaction((rows) => { for (const r of rows) upd.run(r.share_class, r.ts_code); });
    tx(updates);
    console.log(`  ✅ 已写入 ${updates.length} 条 share_class`);
  }

  closeDb();
}

main();
