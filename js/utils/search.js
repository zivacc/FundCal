import { BENCHMARK_CANDIDATES } from '../core/benchmarks.js';

/** 联想搜索 / 导入识别：防抖 ms、下拉最多条数 */
export const SEARCH_DEBOUNCE_MS = 50;
export const SEARCH_MAX_ITEMS = 100;

export const normalizeSearchText = value => String(value ?? '').normalize('NFKD')
  .toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');

const englishAliases = {
  'NDX.GI': ['NASDAQ100', 'NASDAQ 100', '纳指100'],
  'SPX.GI': ['SP500', 'S&P500', '标普500指数'],
  'HSI.HI': ['HANG SENG', '恒生'],
  '000300.SH': ['CSI300'], '000905.SH': ['CSI500'],
  '000852.SH': ['CSI1000'], '000510.CSI': ['CSIA500'],
};
const aliasGroups = BENCHMARK_CANDIDATES.map(b => [b.tsCode, b.tsCode.split('.')[0], b.label,
  ...(englishAliases[b.tsCode] || [])].map(normalizeSearchText));
const indexNameKey = value => normalizeSearchText(value).replace(/指数$/u, '');
const prepared = new WeakMap();
function prepare(item) {
  if (prepared.has(item)) return prepared.get(item);
  const kind = item.kind || (item.label != null || String(item.code || '').includes('.') ? 'index' : 'fund');
  const aliases = Array.isArray(item.aliases) ? item.aliases : [];
  const fields = [item.code, item.name ?? item.label, item.fullname, item.initials, ...aliases]
    .map(normalizeSearchText).filter(Boolean);
  if (kind === 'index') {
    const keys = [item.code, item.name, item.label].filter(Boolean).map(indexNameKey);
    for (const group of aliasGroups) if (group.some(a => keys.includes(indexNameKey(a)))) fields.push(...group);
    if (item.code) fields.push(normalizeSearchText(String(item.code).split('.')[0]));
  }
  const value = { kind, fields: [...new Set(fields)], code: normalizeSearchText(item.code), name: normalizeSearchText(item.name ?? item.label) };
  prepared.set(item, value);
  return value;
}

function subsequence(needle, haystack) {
  let i = 0;
  for (const c of haystack) if (c === needle[i] && ++i === needle.length) return true;
  return false;
}
function oneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a[i] === b[j + 1] && a[i + 1] === b[j]) { i += 2; j += 2; continue; }
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (i < a.length || j < b.length ? 1 : 0) <= 1;
}
function typoSubstring(token, text) {
  for (let n = token.length - 1; n <= token.length + 1; n++) {
    for (let i = 0; i + n <= text.length; i++) if (oneEdit(token, text.slice(i, i + n))) return true;
  }
  return false;
}

/** Shared by browser suggestions and server pagination. Lower score is better. */
export function createSearchScorer(query, { fuzzy = true } = {}) {
  const tokens = String(query ?? '').trim().slice(0, 128).split(/\s+/).map(normalizeSearchText).filter(Boolean);
  return item => {
    if (!tokens.length || !item) return Infinity;
    const { fields, code, name } = prepare(item);
    let total = 0;
    for (const token of tokens) {
      let best = Infinity;
      for (const field of fields) {
        if (field === token) best = Math.min(best, field === code ? 0 : field === name ? 1 : 2);
        else if (field.startsWith(token)) best = Math.min(best, 4);
        else if (field.includes(token)) best = Math.min(best, 8);
      }
      // Short abbreviations use literal containment: fuzzy two-letter queries are too noisy.
      if (fuzzy && !Number.isFinite(best) && token.length >= 3 && !/^\d+$/.test(token)) {
        if (fields.some(f => subsequence(token, f))) best = 20;
        else if (/^[a-z]{4,}$/.test(token) && fields.some(f => /^[a-z0-9]+$/.test(f) && typoSubstring(token, f))) best = 30;
      }
      if (!Number.isFinite(best)) return Infinity;
      total += best;
    }
    return total;
  };
}

/** Scope is caller configuration, never a separate matching implementation. Index items must be immutable. */
export function filterSearchIndex(list, q, { limit = SEARCH_MAX_ITEMS, kinds, predicate } = {}) {
  if (!normalizeSearchText(q)) return [];
  const candidates = (list || []).filter(item => item && (!kinds || kinds.includes(prepare(item).kind)) && (!predicate || predicate(item)));
  const rank = score => candidates.map((item, order) => ({ item, order, score: score(item) + (item.needsCrawl ? 0.01 : 0) }))
    .filter(r => Number.isFinite(r.score));
  // Fuzzy is a fallback, not noise appended to an already successful literal search.
  let matches = rank(createSearchScorer(q, { fuzzy: false }));
  if (!matches.length) matches = rank(createSearchScorer(q));
  const seen = new Set();
  return matches
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .filter(({ item }) => {
      const key = `${prepare(item).kind}:${item.code || item.label || item.name}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    })
    .slice(0, limit).map(r => r.item);
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
