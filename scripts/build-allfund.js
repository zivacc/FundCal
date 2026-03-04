/**
 * 聚合 data/funds 目录下的单只基金文件，生成 data/allfund/allfund.json
 * 方便后续 API 与前端一次性加载全部基金信息。
 *
 * 使用：
 *   node scripts/build-allfund.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pinyin } from 'pinyin-pro';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FUNDS_DIR = path.join(__dirname, '..', 'data', 'funds');
const INDEX_PATH = path.join(FUNDS_DIR, 'index.json');
const ALLFUND_DIR = path.join(__dirname, '..', 'data', 'allfund');
const ALLFUND_PATH = path.join(ALLFUND_DIR, 'allfund.json');
const SEARCH_INDEX_PATH = path.join(ALLFUND_DIR, 'search-index.json');

function getInitials(text) {
  if (!text || typeof text !== 'string') return '';
  try {
    const arr = pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' });
    return (arr || []).join('').toLowerCase();
  } catch {
    return '';
  }
}

function main() {
  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`未找到索引文件：${INDEX_PATH}，请先运行 crawl-all-fund-fee.js 或 crawl-fund-fee.js`);
    process.exit(1);
  }

  /** @type {{codes?: string[]}} */
  let index;
  try {
    index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  } catch (e) {
    console.error('读取或解析 index.json 失败：', e);
    process.exit(1);
  }

  const codes = (index.codes || []).map(c => String(c).trim()).filter(c => c.length === 6);
  if (!codes.length) {
    console.warn('index.json 中没有任何基金代码，将生成空的 allfund.json');
  }

  const funds = {};
  let ok = 0;
  let fail = 0;

  for (const code of codes) {
    const filePath = path.join(FUNDS_DIR, `${code}.json`);
    if (!fs.existsSync(filePath)) {
      fail++;
      continue;
    }
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      funds[code] = data;
      ok++;
    } catch {
      fail++;
    }
  }

  fs.mkdirSync(ALLFUND_DIR, { recursive: true });
  const payload = { codes, funds };
  fs.writeFileSync(ALLFUND_PATH, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`已生成 ${ALLFUND_PATH}：成功聚合 ${ok} 只基金，失败 ${fail}。`);

  // 同步生成基于 allfund.json 的搜索索引
  try {
    const list = [];
    for (const code of codes) {
      const data = funds[code] || {};
      const name = (data.name || data.fundName || '').trim() || `基金${code}`;
      const initials = getInitials(name);
      list.push({ code: String(code), name, initials });
    }
    fs.writeFileSync(SEARCH_INDEX_PATH, JSON.stringify(list, null, 2), 'utf8');
    console.log(`已生成 ${SEARCH_INDEX_PATH}，共 ${list.length} 条索引。`);
  } catch (e) {
    console.error('生成搜索索引失败：', e);
  }
}

main();

