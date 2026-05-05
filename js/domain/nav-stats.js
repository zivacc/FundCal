/**
 * NAV 数据加工的纯函数集合：从 SQLite 行降采样、计算 CAGR / 波动率 / 最大回撤 / Sharpe。
 *
 * 抽到独立模块的原因：
 * 1. nav-api.js 嵌着 SQLite 查询，没法离线跑；这里全是无副作用纯函数，便于 node --test。
 * 2. 历史 nav-api.js 内联实现里有 3 个静默 bug（见 P1.A），这里统一修复。
 *
 * 三个修复（vs. 旧 nav-api.js 内联实现）：
 *   1. **weekly 降采样 keep last-of-week**
 *      旧实现下"如果 _wkey 与上一行不同就 push 新行"，于是新一周的"首个交易日"被保留，
 *      然后只在跟其同周的下一行才被替换；但因为代码以 _wkey 匹配上一行而不是当前行，
 *      实际上保留的是"周首日"而不是用户预期的"周末日"。
 *      新实现：先按 ISO 周分组，每组取最后一行。
 *
 *   2. **volatility 年化系数随 interval 变化**
 *      旧实现写死 sqrt(252)，意思是"日收益率年化"。当 interval=weekly/monthly 时，
 *      `rets[]` 是周/月收益率，正确的年化系数应该是 sqrt(52) / sqrt(12)。
 *      旧实现下 weekly 波动率被夸大约 sqrt(252/52) ≈ 2.20 倍，
 *      monthly 夸大约 sqrt(252/12) ≈ 4.58 倍，Sharpe 同步失真。
 *
 *   3. **range 用 min/max 而非 first/last**
 *      旧实现：`series.flatMap(s=>s.dates)` 然后取 [0]/[last]。这只在 series 都同长且
 *      已按时间顺序串接时才正确；不同基金成立日不同时，结果取决于 codes 顺序。
 *      新实现（暴露 computeUnionRange）：min(series.start), max(series.end)。
 */

import { computeMA, computeDrawdown } from './nav-statistics.js';

/* ========== 降采样 ========== */

/**
 * 按 interval 降采样原始日序列。
 * @param {Array<{end_date:string, unit_nav:number, adj_nav?:number|null}>} rows
 *        必须按 end_date ASC 排序；end_date 为 'YYYYMMDD' 字符串
 * @param {'daily'|'weekly'|'monthly'} interval
 * @returns {Array<{end_date:string, unit_nav:number, adj_nav?:number|null}>}
 */
export function downsample(rows, interval) {
  if (!rows || rows.length === 0) return [];
  if (interval === 'daily' || rows.length < 800) return rows;

  if (interval === 'weekly') {
    return groupByKeyKeepLast(rows, isoWeekKey);
  }
  if (interval === 'monthly') {
    return groupByKeyKeepLast(rows, monthKey);
  }
  return rows;
}

/**
 * 通用「按 key 分组、每组保留最后一条」工具。要求 rows 按时间升序。
 * @template T
 * @param {Array<T>} rows
 * @param {(row: T) => string} keyFn
 * @returns {Array<T>}
 */
function groupByKeyKeepLast(rows, keyFn) {
  const out = [];
  let lastKey = null;
  for (const r of rows) {
    const k = keyFn(r);
    if (k === lastKey) {
      // 同一组：用当前行替换上一行（保留最后一条）
      out[out.length - 1] = r;
    } else {
      out.push(r);
      lastKey = k;
    }
  }
  return out;
}

/**
 * ISO 周键 'YYYY-Www'。同一周（周一到周日）内的所有日期映射到同一键。
 * @param {{end_date:string}} row
 * @returns {string}
 */
function isoWeekKey(row) {
  const d = parseYYYYMMDD(row.end_date);
  // 复制为 UTC 中午，避免时区抖动
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dt = new Date(utc);
  // ISO: 周一为周的第一天
  const dayNum = (dt.getUTCDay() + 6) % 7; // 周一=0, 周日=6
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3); // 跳到本周周四
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((dt - firstThursday) / (7 * 86400000));
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * 月键 'YYYYMM'。同一自然月内的所有日期映射到同一键。
 * @param {{end_date:string}} row
 * @returns {string}
 */
function monthKey(row) {
  return row.end_date.slice(0, 6);
}

/* ========== 统计指标 ========== */

/**
 * @typedef {Object} NavStats
 * @property {number|null} startNav
 * @property {number|null} endNav
 * @property {number|null} totalReturn   首尾累计收益率
 * @property {number|null} cagr          年化复合收益率
 * @property {number|null} maxDrawdown   最大回撤（负数或 0）
 * @property {number|null} volatility    年化波动率
 * @property {number|null} sharpe        (cagr - rf) / volatility
 */

/**
 * 计算 NAV 序列的全局统计指标。
 *
 * @param {string[]} dates    与 navs 同长，'YYYYMMDD' 升序
 * @param {Array<number|null>} navs  优先用复权净值（adj_nav）
 * @param {Object} [opts]
 * @param {'daily'|'weekly'|'monthly'} [opts.interval='daily']
 *        年化波动率系数取决于 interval：daily→√252, weekly→√52, monthly→√12
 * @param {number} [opts.riskFreeRate=0.02]   无风险利率，年化
 * @returns {NavStats}
 */
export function computeStats(dates, navs, opts = {}) {
  const interval = opts.interval || 'daily';
  const rf = opts.riskFreeRate ?? 0.02;

  const empty = {
    startNav: null, endNav: null, totalReturn: null,
    cagr: null, maxDrawdown: null, volatility: null, sharpe: null,
  };
  if (!navs || navs.length < 2 || !dates || dates.length !== navs.length) {
    return empty;
  }

  const startNav = navs[0];
  const endNav = navs[navs.length - 1];
  if (startNav == null || endNav == null || startNav <= 0) return empty;

  const totalReturn = endNav / startNav - 1;

  // CAGR（年化复合）：基于真实跨年数
  const startDate = parseYYYYMMDD(dates[0]);
  const endDate = parseYYYYMMDD(dates[dates.length - 1]);
  const days = (endDate - startDate) / 86400000;
  const years = days / 365.25;
  const cagr = years > 0 ? Math.pow(endNav / startNav, 1 / years) - 1 : null;

  // 最大回撤
  let peak = navs[0];
  let mdd = 0;
  for (const v of navs) {
    if (v == null) continue;
    if (v > peak) peak = v;
    const dd = v / peak - 1;
    if (dd < mdd) mdd = dd;
  }

  // 周期收益率序列 → 年化波动率
  const rets = [];
  for (let i = 1; i < navs.length; i++) {
    const prev = navs[i - 1], cur = navs[i];
    if (prev != null && cur != null && prev > 0) {
      rets.push(cur / prev - 1);
    }
  }
  let volatility = null;
  if (rets.length > 1) {
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
    const periodVol = Math.sqrt(variance);
    volatility = periodVol * Math.sqrt(periodsPerYear(interval));
  }

  // Sharpe = (CAGR - rf) / 年化波动率
  const sharpe = (volatility != null && volatility > 0 && cagr != null)
    ? (cagr - rf) / volatility
    : null;

  return { startNav, endNav, totalReturn, cagr, maxDrawdown: mdd, volatility, sharpe };
}

/**
 * 每年的周期数，用于年化波动率（年化系数 = √periodsPerYear）。
 * @param {string} interval
 * @returns {number}
 */
export function periodsPerYear(interval) {
  switch (interval) {
    case 'weekly': return 52;
    case 'monthly': return 12;
    case 'daily':
    default: return 252; // A 股年交易日约 244-252，沿用通用 252
  }
}

/* ========== 范围工具 ========== */

/**
 * 从多条 series 计算并集时间范围（min start, max end）。
 * @param {Array<{dates: string[]}>} series
 * @returns {{start: string, end: string} | null}
 */
export function computeUnionRange(series) {
  let minStart = null;
  let maxEnd = null;
  for (const s of series || []) {
    if (!s || !s.dates || s.dates.length === 0) continue;
    const start = s.dates[0];
    const end = s.dates[s.dates.length - 1];
    if (minStart === null || start < minStart) minStart = start;
    if (maxEnd === null || end > maxEnd) maxEnd = end;
  }
  return minStart && maxEnd ? { start: minStart, end: maxEnd } : null;
}

/* ========== 内部 ========== */

/**
 * 把 'YYYYMMDD' 字符串转 Date（UTC midnight）。
 * 日期字符串无效时返回 Invalid Date（NaN getTime）。
 * @param {string} s
 * @returns {Date}
 */
export function parseYYYYMMDD(s) {
  if (!s || s.length !== 8) return new Date(NaN);
  const y = parseInt(s.slice(0, 4), 10);
  const m = parseInt(s.slice(4, 6), 10);
  const d = parseInt(s.slice(6, 8), 10);
  return new Date(Date.UTC(y, m - 1, d));
}

/* ========== 指标注册表（P1.D：服务端可选预算） ========== */

/**
 * 受支持的 indicator 名 → 计算函数。
 * 输入是净值序列（一般为 adj_nav，复权净值），输出是同长度的指标数组。
 *
 * 用于 `?indicators=` 协议：服务器把 series 里每条加上同名字段（如 `ma20`、`drawdown`）
 * 一并返回，客户端可直接渲染、跳过本地计算。
 *
 * 注意：缓存场景下，由于客户端只能拿到部分窗口（例如只有最近 30 天），
 * MA20 / drawdown 的"历史峰值 / 滑窗"语义不再正确。所以 `fetchNavCompareCached`
 * 默认不传 `indicators=`；只有当客户端明确知道自己拿到的是"完整窗口"时才用。
 *
 * @type {Readonly<Record<string, (navs: Array<number|null>) => Array<number|null>>>}
 */
export const INDICATORS = Object.freeze({
  ma20:     (navs) => computeMA(navs, 20),
  ma60:     (navs) => computeMA(navs, 60),
  drawdown: (navs) => computeDrawdown(navs),
});

/**
 * 把 `?indicators=ma20,ma60,drawdown` 这样的字符串解析为合法名数组。
 * 未知名静默丢弃；空 / null 返回 []。
 *
 * @param {string|null|undefined} str
 * @returns {string[]}  按出现顺序去重后的合法 indicator 名
 */
export function parseIndicators(str) {
  if (!str) return [];
  const seen = new Set();
  const out = [];
  for (const raw of String(str).split(',')) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    if (!(name in INDICATORS)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * 在 series 上**就地**追加 indicator 字段，并返回同一引用。
 *
 * @param {Array<Object>} series          每条 series 必须有 `sourceField` 字段
 * @param {string[]} indicatorNames       已通过 parseIndicators 校验的合法名
 * @param {string} [sourceField='adjNavs']  以哪一列为输入计算指标
 * @returns {Array<Object>}                 同 series（mutated）
 */
export function enrichSeriesIndicators(series, indicatorNames, sourceField = 'adjNavs') {
  if (!series || !Array.isArray(series) || !indicatorNames || indicatorNames.length === 0) {
    return series;
  }
  for (const s of series) {
    if (!s) continue;
    const navs = s[sourceField];
    if (!Array.isArray(navs)) continue;
    for (const name of indicatorNames) {
      const fn = INDICATORS[name];
      if (fn) s[name] = fn(navs);
    }
  }
  return series;
}
