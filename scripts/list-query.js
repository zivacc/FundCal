/**
 * Fund list 分页查询的纯函数 SQL builder。
 *
 * 抽离动机: 让 buildListQuery / parseListParams 可单测, 不必启 DB。
 * 路由层 (fund-api.js) 负责拼接 + 执行 + 取 fee_segments。
 */

import { filterSearchIndex } from '../js/utils/search.js';

/** sort key 白名单 → SQL 表达式 (用于 ORDER BY) */
const SORT_EXPR = {
  code:                 'm.code',
  name:                 "COALESCE(NULLIF(b.name,''), m.name_crawler)",
  buyFee:               'm.buy_fee',
  annualFee:            'm.annual_fee',
  fundType:             "COALESCE(NULLIF(b.fund_type,''), m.fund_type_crawler)",
  // sellFee 排序: 取 kind='sell' AND seq=0 的 rate (由 LEFT JOIN sf 提供)
  sellFee:              'sf.rate',
  trackingTarget:       'm.tracking_target',
  performanceBenchmark: "COALESCE(NULLIF(b.benchmark,''), m.benchmark_crawler)",
  fundManager:          "COALESCE(NULLIF(b.management,''), m.management_crawler)",
  subscribe:            'm.trading_subscribe',
  redeem:               'm.trading_redeem',
  updatedAt:            'm.crawler_updated_at',
  establishmentDate:    'm.found_date_normalized',
};

const DEFAULT_SORT = { key: 'code', dir: 'asc' };
const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 100;

/** 把 URL query 对象解析成规范化的 list 查询参数 */
export function parseListParams(qs = {}) {
  const page  = Math.max(1, parseInt(qs.page, 10) || 1);
  const size  = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(qs.size, 10) || DEFAULT_PAGE_SIZE));

  let sort = DEFAULT_SORT;
  if (qs.sort) {
    const [k, d] = String(qs.sort).split(':');
    if (SORT_EXPR[k]) sort = { key: k, dir: d === 'desc' ? 'desc' : 'asc' };
  }

  const q = (qs.q || '').trim();

  const csvToArr = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  const numOrNull = (v) => {
    if (v == null || v === '') return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  const filters = {
    fundType:       csvToArr(qs.fundType),
    fundManager:    csvToArr(qs.fundManager),
    subscribe:      csvToArr(qs.subscribe),
    redeem:         csvToArr(qs.redeem),
    source:         csvToArr(qs.source),    // 兼容 (空 = both,crawler,tushare)
    floatingFee:    qs.floatingFee === 'yes' ? 'yes' : qs.floatingFee === 'no' ? 'no' : '',
    buyFeeMin:      numOrNull(qs.buyFeeMin),
    buyFeeMax:      numOrNull(qs.buyFeeMax),
    annualFeeMin:   numOrNull(qs.annualFeeMin),
    annualFeeMax:   numOrNull(qs.annualFeeMax),
    trackingTarget: (qs.trackingTarget || '').trim(),
  };

  return { page, size, sort, q, filters };
}

/**
 * 构建 list 查询的主 SQL + count SQL + params 数组。
 *
 * @returns {{ sql: string, countSql: string, params: any[] }}
 */
export function buildListQuery(params) {
  const { page, size, sort, q, filters } = params;
  const where = [];
  const bind  = [];

  // Resolve matches with the same engine as browser suggestions, then paginate in SQL.
  let from = 'fund_meta m';
  if (q) {
    if (!Array.isArray(params.searchIndex)) throw new Error('Search queries require a searchIndex');
    const codes = [...new Set(filterSearchIndex(params.searchIndex, q, { limit: Infinity, kinds: ['fund'] }).map(r => r.code))];
    // 固定由小的匹配代码集合驱动索引查找，避免扫描全表后逐行展开 JSON。
    from = 'json_each(?) search_match CROSS JOIN fund_meta m INDEXED BY idx_fund_meta_code ON m.code = search_match.value';
    bind.push(JSON.stringify(codes));
  }

  // 多选筛选
  const inFilter = (col, vals) => {
    if (!vals.length) return;
    where.push(`${col} IN (${vals.map(() => '?').join(',')})`);
    bind.push(...vals);
  };
  inFilter("COALESCE(NULLIF(b.fund_type,''), m.fund_type_crawler)",  filters.fundType);
  inFilter("COALESCE(NULLIF(b.management,''), m.management_crawler)", filters.fundManager);
  inFilter("m.trading_subscribe",                                     filters.subscribe);
  inFilter("m.trading_redeem",                                        filters.redeem);

  // source: 默认仅 both,crawler (排除 tushare-only 占位行); 显式传值才覆盖
  if (filters.source.length) {
    inFilter('m.source', filters.source);
  } else {
    where.push("m.source IN ('both','crawler')");
  }

  // 浮动费率
  if (filters.floatingFee === 'yes') where.push('m.is_floating_annual_fee = 1');
  if (filters.floatingFee === 'no')  where.push('(m.is_floating_annual_fee IS NULL OR m.is_floating_annual_fee = 0)');

  // 数值范围
  if (filters.buyFeeMin    != null) { where.push('COALESCE(m.buy_fee,0) >= ?');    bind.push(filters.buyFeeMin); }
  if (filters.buyFeeMax    != null) { where.push('COALESCE(m.buy_fee,0) <= ?');    bind.push(filters.buyFeeMax); }
  if (filters.annualFeeMin != null) { where.push('COALESCE(m.annual_fee,0) >= ?'); bind.push(filters.annualFeeMin); }
  if (filters.annualFeeMax != null) { where.push('COALESCE(m.annual_fee,0) <= ?'); bind.push(filters.annualFeeMax); }

  // 跟踪标的关键词
  if (filters.trackingTarget) {
    where.push('LOWER(m.tracking_target) LIKE ?');
    bind.push('%' + filters.trackingTarget.toLowerCase() + '%');
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderExpr   = SORT_EXPR[sort.key] || SORT_EXPR.code;
  const orderDir    = sort.dir === 'desc' ? 'DESC' : 'ASC';
  // NULLS LAST (SQLite 默认 ASC NULL 在前): 用 IS NULL 第二级排序
  const relevance = q && sort.key === 'code' && sort.dir === 'asc' ? 'CAST(search_match.key AS INTEGER), ' : '';
  const orderClause = `ORDER BY ${relevance}(${orderExpr}) IS NULL, ${orderExpr} ${orderDir}, m.code ASC`;

  const offset = (page - 1) * size;

  const baseFrom = `
    FROM ${from}
    LEFT JOIN fund_basic b ON b.ts_code = m.ts_code
    LEFT JOIN (
      SELECT ts_code, rate FROM fund_fee_segments WHERE kind='sell' AND seq=0
    ) sf ON sf.ts_code = m.ts_code
    ${whereClause}
  `;

  const sql = `
    SELECT
      m.ts_code, m.code, m.source,
      m.tracking_target, m.trading_subscribe, m.trading_redeem,
      m.buy_fee, m.annual_fee, m.is_floating_annual_fee,
      m.crawler_updated_at, m.found_date_normalized,
      m.name_crawler, m.fund_type_crawler, m.management_crawler, m.benchmark_crawler,
      b.name, b.management, b.fund_type, b.benchmark, b.status
    ${baseFrom}
    ${orderClause}
    LIMIT ${size} OFFSET ${offset}
  `;
  const countSql = `SELECT COUNT(*) AS n ${baseFrom}`;

  return { sql, countSql, params: bind };
}

export { SORT_EXPR, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE };
