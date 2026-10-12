import { filterSearchIndex } from '../../utils/search.js';

export const PAGE_SIZE = 50;
export function parseIndexRoute(hash) {
  const match = /^#\/index-detail(?:\/([^/?#]+))?\/?$/.exec(hash || '');
  if (!match) return null;
  try {
    const code = decodeURIComponent(match[1] || '');
    return code === '' || (code.length <= 80 && /^[A-Z0-9][A-Z0-9._-]*\.[A-Z]{1,8}$/i.test(code)) ? code : null;
  } catch { return null; }
}
export function dateLabel(date) {
  if (!date) return '—';
  const raw = String(date).replaceAll('-', '');
  return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}` : String(date);
}
export function numberLabel(value, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
}
export const percentLabel = value => typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '—';
export const sourceLabel = source => ({ csindex: '中证官方', cnindex: '国证官方', tushare: 'Tushare', wind: 'Wind', eastmoney: '东方财富', custom: '自定义', 1: 'Tushare', 2: '东方财富', 3: '中证', 4: 'Wind', 6: '自定义' }[source] || source || '—');
export const returnLabel = type => ({ price: '价格指数', total: '全收益指数', net: '净收益指数', full_price: '全价指数' }[type] || '收益口径未标明');

export function tableRows(rows, query, sort) {
  const filtered = query.trim() ? filterSearchIndex(rows, query, { limit: Infinity }) : [...rows];
  return filtered.sort((a, b) => {
    if (sort === 'weight') return (b.weightPct - a.weightPct) || a.code.localeCompare(b.code);
    if (sort === 'fee') {
      const av = Number.isFinite(a.annualFee) ? a.annualFee : Infinity;
      const bv = Number.isFinite(b.annualFee) ? b.annualFee : Infinity;
      return (av - bv) || a.code.localeCompare(b.code);
    }
    return String(a[sort] || '').localeCompare(String(b[sort] || ''), 'zh-CN') || a.code.localeCompare(b.code);
  });
}
export function pageRows(rows, page, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.max(1, Math.min(pages, page));
  return { rows: rows.slice((current - 1) * size, current * size), page: current, pages, total: rows.length };
}
export function weightSummary(rows) {
  const sorted = [...rows].sort((a, b) => b.weightPct - a.weightPct || a.code.localeCompare(b.code));
  return { top: sorted.slice(0, 10), top10: sorted.slice(0, 10).reduce((sum, r) => sum + r.weightPct, 0),
    total: sorted.reduce((sum, r) => sum + r.weightPct, 0), count: rows.length };
}
export function snapshotWarning(snapshot) {
  if (snapshot?.source !== 'wind') return '';
  return snapshot.asOfDate === '2026-09-28'
    ? '这批 Wind 快照的标注日期存在核验疑点，部分权重与 8 月底文件一致。此处保留原始日期，不认作已核实的 9 月 28 日生效权重；如有官方快照，可切换对照。'
    : 'Wind 快照使用来源标注日期，尚未独立核验权重生效日期；快照日期与行情日期分别展示。';
}
