#!/usr/bin/env node
/**
 * 分段费率字段迁移：{days, rate, unbounded?} → {to, rate}
 *
 * 旧语义:
 *   - 普通段: days = 区间右端点，含义 (prev.days, this.days]
 *   - unbounded: days = 区间左端点，含义 [days, +∞)
 *
 * 新语义:
 *   - 每段 {to, rate}，含义 (prev.to ?? 0, to]
 *   - to: null 代表 (prev.to, +∞)
 *
 * 处理范围:
 *   - data/funds/*.json
 *   - data/allfund/allfund.json
 *   - data/allfund/list-index.json
 *
 * 用法:
 *   node scripts/migrate-segments.js          # 实写
 *   node scripts/migrate-segments.js --dry    # 试跑，仅统计不写盘
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const FUNDS_DIR = path.join(ROOT, 'data', 'funds');
const ALLFUND_JSON = path.join(ROOT, 'data', 'allfund', 'allfund.json');
const LIST_INDEX_JSON = path.join(ROOT, 'data', 'allfund', 'list-index.json');

const SEGMENT_FIELDS = ['sellFeeSegments', 'redeemSegments', 'purchaseBackSegments'];

const dry = process.argv.includes('--dry');

/**
 * 把单段从旧格式转新格式。
 * 已是新格式（含 'to' 键）则原样返回。
 */
function convertSeg(seg) {
  if (!seg || typeof seg !== 'object') return seg;
  if ('to' in seg) return seg; // 已新格式
  const out = { ...seg };
  if (seg.unbounded) {
    out.to = null;
  } else {
    out.to = seg.days != null ? seg.days : null;
  }
  delete out.days;
  delete out.unbounded;
  return out;
}

/**
 * 转换一个 fund 对象的所有 segment 字段。
 * 返回 [新对象, 是否变更]
 */
function migrateFund(fund) {
  if (!fund || typeof fund !== 'object') return [fund, false];
  let changed = false;
  const out = { ...fund };
  for (const key of SEGMENT_FIELDS) {
    if (!Array.isArray(out[key])) continue;
    const before = JSON.stringify(out[key]);
    out[key] = out[key].map(convertSeg);
    if (JSON.stringify(out[key]) !== before) changed = true;
  }
  return [out, changed];
}

function migrateFundsDir() {
  console.log(`\n📁 扫描 ${FUNDS_DIR}`);
  if (!fs.existsSync(FUNDS_DIR)) {
    console.log('  ⚠ 目录不存在，跳过');
    return;
  }
  const files = fs.readdirSync(FUNDS_DIR).filter(n => n.endsWith('.json') && n !== 'index.json');
  let changed = 0;
  let unchanged = 0;
  let errors = 0;
  for (const name of files) {
    const fp = path.join(FUNDS_DIR, name);
    try {
      const txt = fs.readFileSync(fp, 'utf8');
      const data = JSON.parse(txt);
      const [next, didChange] = migrateFund(data);
      if (didChange) {
        if (!dry) fs.writeFileSync(fp, JSON.stringify(next, null, 2), 'utf8');
        changed++;
      } else {
        unchanged++;
      }
    } catch (e) {
      errors++;
      console.error(`  ❌ ${name}: ${e.message}`);
    }
  }
  console.log(`  ✅ 变更 ${changed}  未变 ${unchanged}  错误 ${errors}  共 ${files.length} 文件`);
}

function migrateAllfund() {
  console.log(`\n📄 ${ALLFUND_JSON}`);
  if (!fs.existsSync(ALLFUND_JSON)) {
    console.log('  ⚠ 不存在，跳过');
    return;
  }
  const data = JSON.parse(fs.readFileSync(ALLFUND_JSON, 'utf8'));
  const funds = data.funds || data;
  let changed = 0;
  for (const code of Object.keys(funds)) {
    const [next, didChange] = migrateFund(funds[code]);
    if (didChange) {
      funds[code] = next;
      changed++;
    }
  }
  console.log(`  ✅ ${changed} 条记录已转换 / 共 ${Object.keys(funds).length}`);
  if (!dry && changed) fs.writeFileSync(ALLFUND_JSON, JSON.stringify(data, null, 2), 'utf8');
}

function migrateListIndex() {
  console.log(`\n📄 ${LIST_INDEX_JSON}`);
  if (!fs.existsSync(LIST_INDEX_JSON)) {
    console.log('  ⚠ 不存在，跳过');
    return;
  }
  const arr = JSON.parse(fs.readFileSync(LIST_INDEX_JSON, 'utf8'));
  let changed = 0;
  for (let i = 0; i < arr.length; i++) {
    const [next, didChange] = migrateFund(arr[i]);
    if (didChange) {
      arr[i] = next;
      changed++;
    }
  }
  console.log(`  ✅ ${changed} 条记录已转换 / 共 ${arr.length}`);
  if (!dry && changed) fs.writeFileSync(LIST_INDEX_JSON, JSON.stringify(arr, null, 2), 'utf8');
}

console.log(`🔧 分段格式迁移 ${dry ? '(试跑模式)' : ''}`);
const t0 = Date.now();
migrateFundsDir();
migrateAllfund();
migrateListIndex();
console.log(`\n⏱ 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
