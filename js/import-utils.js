/**
 * 基金费率计算器 - 导入解析工具
 * 支持从文本、CSV、Excel 中解析基金代码/名称
 */

import { buildSearchIndexMaps } from './search-utils.js';

export function normalizeImportText(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

/**
 * 从自由文本中解析基金代码和名称
 * @param {string} rawText
 * @param {() => Promise<Array>} ensureSearchIndex - 返回搜索索引的异步函数
 */
export async function parseImportFromText(rawText, ensureSearchIndex) {
  const text = normalizeImportText(rawText);
  if (!text.trim()) return [];
  const index = await ensureSearchIndex();
  if (!index.length) return [];
  const { byCode, byName } = buildSearchIndexMaps(index);
  const results = [];
  const seen = new Set();

  const codeMatches = text.match(/\b\d{6}\b/g) || [];
  codeMatches.forEach(codeRaw => {
    const code = String(codeRaw).trim();
    if (seen.has('code:' + code)) return;
    const item = byCode.get(code);
    if (item) {
      seen.add('code:' + code);
      results.push({
        code: item.code,
        name: item.name || `基金${item.code}`,
        source: code
      });
    }
  });

  const lowerText = text.toLowerCase();
  let matchedCount = 0;
  for (const item of index) {
    if (!item.name) continue;
    const name = String(item.name).trim();
    if (name.length < 3) continue;
    const key = 'name:' + name;
    if (seen.has(key)) continue;
    if (lowerText.includes(name.toLowerCase())) {
      seen.add(key);
      results.push({
        code: item.code,
        name,
        source: name
      });
      matchedCount++;
      if (matchedCount >= 200) break;
    }
  }
  return results;
}

/**
 * 从行列表中解析基金代码和名称
 * @param {string[]} lines
 * @param {() => Promise<Array>} ensureSearchIndex - 返回搜索索引的异步函数
 */
export async function parseImportFromLines(lines, ensureSearchIndex) {
  const index = await ensureSearchIndex();
  if (!index.length) return [];
  const { byCode, byName } = buildSearchIndexMaps(index);
  const results = [];
  const seen = new Set();

  for (const raw of lines) {
    const cell = String(raw || '').trim();
    if (!cell) continue;
    const numOnly = cell.replace(/\D/g, '');
    if (numOnly.length === 6 && byCode.has(numOnly)) {
      if (seen.has('code:' + numOnly)) continue;
      const item = byCode.get(numOnly);
      seen.add('code:' + numOnly);
      results.push({
        code: item.code,
        name: item.name || `基金${item.code}`,
        source: cell
      });
      continue;
    }
    const byNameHit = byName.get(cell);
    if (byNameHit) {
      const key = 'name:' + cell;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        code: byNameHit.code,
        name: byNameHit.name,
        source: cell
      });
      continue;
    }
  }
  return results;
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(String(e.target.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsText(file, 'utf-8');
  });
}

export function readExcelFirstColumn(file) {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.XLSX) {
      resolve([]);
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = window.XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          resolve([]);
          return;
        }
        const sheet = workbook.Sheets[sheetName];
        const range = window.XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
        const lines = [];
        for (let r = range.s.r; r <= range.e.r; r++) {
          const cellAddr = window.XLSX.utils.encode_cell({ r, c: 0 });
          const cell = sheet[cellAddr];
          if (!cell || cell.v == null) continue;
          lines.push(String(cell.v));
        }
        resolve(lines);
      } catch (err) {
        resolve([]);
      }
    };
    reader.onerror = () => reject(reader.error || new Error('读取 Excel 失败'));
    reader.readAsArrayBuffer(file);
  });
}
