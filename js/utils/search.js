/**
 * 基金费率计算器 - 搜索索引工具
 */

/** 联想搜索 / 导入识别：防抖 ms、下拉最多条数 */
export const SEARCH_DEBOUNCE_MS = 50;
export const SEARCH_MAX_ITEMS = 100;

export function filterSearchIndex(list, q) {
  if (!q) return [];
  const s = String(q).trim().toLowerCase();
  if (!s) return [];
  const numOnly = s.replace(/\D/g, '');
  const filtered = list.filter(({ code, name, initials }) => {
    if (numOnly && (code.startsWith(numOnly) || code.includes(numOnly))) return true;
    if (name.toLowerCase().includes(s)) return true;
    if (initials && initials.startsWith(s)) return true;
    return false;
  });
  const score = (item) => {
    const nameLower = item.name.toLowerCase();
    if (numOnly && item.code.startsWith(numOnly)) return 0;
    if (numOnly && item.code.includes(numOnly)) return 1;
    if (nameLower.startsWith(s)) return 2;
    if (item.initials && item.initials.startsWith(s)) return 3;
    return 4;
  };
  filtered.sort((a, b) => score(a) - score(b));
  return filtered.slice(0, SEARCH_MAX_ITEMS);
}

export function buildSearchIndexMaps(list) {
  const byCode = new Map();
  const byName = new Map();
  list.forEach(item => {
    if (item.code) byCode.set(String(item.code).trim(), item);
    if (item.name) byName.set(String(item.name).trim(), item);
  });
  return { byCode, byName };
}
