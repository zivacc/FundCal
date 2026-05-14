/**
 * 根据 data/funds/*.json 生成搜索索引 search-index.json
 * 包含 code、name、initials（拼音首字母），供前端联想补全使用
 * 使用 pinyin-pro 生成首字母，支持多音字、词境识别
 * 使用：node scripts/build-search-index.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pinyin } from 'pinyin-pro';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALLFUND_DIR = path.join(__dirname, '..', 'data', 'allfund');
const ALLFUND_PATH = path.join(ALLFUND_DIR, 'allfund.json');
const SEARCH_INDEX_PATH = path.join(ALLFUND_DIR, 'search-index.json');

/**
 * 用 pinyin-pro 取拼音首字母（多音字按词境识别，无空格拼接为小写）
 */
function getInitials(text) {
  if (!text || typeof text !== 'string') return '';
  try {
    const arr = pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' });
    return (arr || []).join('').toLowerCase();
  } catch (_) {
    return '';
  }
}

function buildSearchIndex() {
  if (!fs.existsSync(ALLFUND_PATH)) {
    console.warn('allfund.json 不存在，将生成空索引');
    fs.writeFileSync(SEARCH_INDEX_PATH, JSON.stringify([], null, 2), 'utf8');
    return;
  }
  const all = JSON.parse(fs.readFileSync(ALLFUND_PATH, 'utf8'));
  const fundsMap = all.funds || {};
  const codes = all.codes || Object.keys(fundsMap);
  const list = [];
  for (const code of codes) {
    try {
      const data = fundsMap[code] || {};
      const name = (data.name || data.fundName || '').trim() || `基金${code}`;
      const initials = getInitials(name);
      list.push({ code: String(code), name, initials });
    } catch (e) {
      // skip invalid file
    }
  }
  fs.writeFileSync(SEARCH_INDEX_PATH, JSON.stringify(list, null, 2), 'utf8');
  console.log(`已生成 search-index.json，共 ${list.length} 条（pinyin-pro 首字母）`);
}

buildSearchIndex();
