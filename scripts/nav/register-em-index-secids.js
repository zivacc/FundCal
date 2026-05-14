#!/usr/bin/env node
/**
 * 从 data/external/em-index-secids.json 批量注册指数到 index_basic + index_source_map.
 *
 * 用 'eastmoney' 作 primary_source. 跑后即可用 `crawl-em-index --all-em` 拉日线.
 *
 * 用法:
 *   node scripts/nav/register-em-index-secids.js
 *   node scripts/nav/register-em-index-secids.js --file data/external/em-index-secids.json
 */

import fs from 'fs';
import path from 'path';
import { getDb, closeDb, upsertIndexBasicRecords, bulkRegisterIndexSources } from './db.js';

const args = process.argv.slice(2);
const fileIdx = args.indexOf('--file');
const filePath = path.resolve(fileIdx !== -1 ? args[fileIdx + 1] : 'data/external/em-index-secids.json');

function main() {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ 文件不存在: ${filePath}`);
    process.exit(1);
  }
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const list = json.indices || [];
  if (!list.length) { console.log('  无指数, 退出'); return; }

  console.log(`📥 注册 ${list.length} 个指数 (eastmoney)`);
  getDb();

  const records = [];
  const sourceMappings = [];
  for (const idx of list) {
    records.push({
      ts_code: idx.ts_code,
      code: idx.code,
      name: idx.name,
      fullname: idx.fullname || null,
      publisher: idx.publisher || null,
      category: idx.category || null,
      market: idx.market || null,
      index_type: idx.index_type || null,
      base_date: idx.base_date || null,
      base_point: idx.base_point ?? null,
      description: idx.description || null,
      primary_source: 'eastmoney',
    });
    sourceMappings.push({
      ts_code: idx.ts_code, source: 'eastmoney', source_code: idx.secid, notes: idx._notes || null,
    });
  }

  const stats = upsertIndexBasicRecords(records, 'eastmoney');
  bulkRegisterIndexSources(sourceMappings);

  console.log(`  ✅ index_basic: 新 ${stats.inserted} / 更 ${stats.updated}`);
  console.log(`  ✅ index_source_map: ${list.length} 条 (source=eastmoney)`);

  closeDb();
}

main();
