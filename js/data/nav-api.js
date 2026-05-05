/**
 * NAV 比较 API 客户端（无 DOM 依赖）。
 *
 * 与 `data/fund-api.js` 的区别：
 * - fund-api 的 base 指向 `/api/fund`（费率 / 搜索 / 联接索引等）
 * - nav-api  的 base 指向 `/api`，调用 `/api/nav/...`（净值历史、对比、统计）
 *
 * 设计目标：让 NAV 页（pages/nav）和后续可能的 Worker / 缓存层共用同一组接口，
 * 不再在页面里硬编码 fetch URL。
 */

import {
  getCachedSeries, mergeIntoCache,
  computeMissingRanges, subsetByRange, rangeOfPoints,
} from './nav-cache.js';
import { computeStats, computeUnionRange } from '../domain/nav-stats.js';

/* ========== 基址解析 ========== */

/**
 * 解析 NAV API 基址，返回到 `/api` 这一层；GitHub Pages 等无后端环境返回 null。
 * 优先级：window.FUND_FEE_API_BASE 覆盖 → localhost → 同源 → null。
 * @returns {string|null}
 */
export function getNavApiBase() {
  if (typeof window !== 'undefined' && window.FUND_FEE_API_BASE) {
    return String(window.FUND_FEE_API_BASE).replace(/\/api\/fund\/?$/, '/api');
  }
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3457/api';
    if (h.endsWith('.github.io')) return null;
    return '/api';
  }
  return null;
}

/* ========== 周期 / 区间工具 ========== */

/**
 * 把 Date 转成紧凑日期字符串 YYYYMMDD。
 * @param {Date} d
 * @returns {string}
 */
export function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

/**
 * 周期标记 → 起止日期。MAX 表示从 1998-01-01 起。
 * @param {'1M'|'3M'|'6M'|'1Y'|'3Y'|'5Y'|'MAX'} period
 * @param {Date} [now]  注入便于测试，默认当前时间
 * @returns {{ start: string, end: string }}
 */
export function periodToRange(period, now = new Date()) {
  const end = ymd(now);
  if (period === 'MAX') return { start: '19980101', end };
  const map = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365, '3Y': 365 * 3, '5Y': 365 * 5 };
  const days = map[period] || 365;
  const start = new Date(now.getTime() - days * 86400000);
  return { start: ymd(start), end };
}

/**
 * 根据周期选采样粒度：长周期降为 weekly 减少数据量。
 * @param {string} period
 * @returns {'daily'|'weekly'}
 */
export function pickInterval(period) {
  if (period === '5Y' || period === 'MAX') return 'weekly';
  return 'daily';
}

/* ========== 接口 ========== */

/**
 * @typedef {Object} NavCompareResponse
 * @property {string[]} codes
 * @property {{ start: string, end: string }} range
 * @property {Array<{ code: string, name: string, dates: string[], adjNavs: Array<number|null> }>} series
 * @property {Array<Object>} stats
 */

/**
 * 拉取多只基金的 NAV 比较数据（直连 API，不走缓存）。
 *
 * @param {Object} params
 * @param {string[]|string} params.codes      ['000001','110011'] 或逗号串
 * @param {string} params.start                YYYYMMDD
 * @param {string} params.end                  YYYYMMDD
 * @param {'daily'|'weekly'} [params.interval] 默认由 pickInterval 决定
 * @param {string[]} [params.indicators]       可选预算指标，例如 ['ma20','ma60','drawdown']；
 *                                             服务端会按名添加同名字段到每条 series 上。
 *                                             注意：缓存层 `fetchNavCompareCached` 不传，
 *                                             因为部分窗口下 MA / drawdown 语义不再正确。
 * @returns {Promise<NavCompareResponse|null>}  无后端时返回 null
 */
export async function fetchNavCompare({ codes, start, end, interval = 'daily', indicators }) {
  const base = getNavApiBase();
  if (!base) return null;
  const codesStr = Array.isArray(codes) ? codes.join(',') : String(codes || '');
  if (!codesStr) return null;
  let url = `${base}/nav/compare?codes=${encodeURIComponent(codesStr)}&start=${start}&end=${end}&interval=${interval}`;
  if (Array.isArray(indicators) && indicators.length) {
    url += `&indicators=${encodeURIComponent(indicators.join(','))}`;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

/* ========== 带缓存 / 增量拉取的 compare ========== */

/**
 * 同 `fetchNavCompare`，但走 IndexedDB 缓存：
 *
 * 1. 对每只基金读 (code, interval) 缓存
 * 2. 算出请求范围与缓存覆盖的差集（缺口），只 fetch 缺口
 * 3. 合并到缓存
 * 4. 切片到请求范围
 * 5. 客户端调 `computeStats` 重算 stats（与服务器口径一致）
 *
 * 行为与 fetchNavCompare 等价（同样的输入参数、同样的返回 schema），用户感知是「重复缩放
 * 0 RTT」。
 *
 * 失败回退：IndexedDB 不可用时退化为直接调 fetchNavCompare。
 *
 * @param {Object} params
 * @param {string[]|string} params.codes
 * @param {string} params.start
 * @param {string} params.end
 * @param {'daily'|'weekly'} [params.interval]
 * @returns {Promise<NavCompareResponse|null>}
 */
export async function fetchNavCompareCached({ codes, start, end, interval = 'daily' }) {
  const codesArr = (Array.isArray(codes) ? codes : String(codes || '').split(','))
    .map(s => String(s).trim()).filter(Boolean);
  if (!codesArr.length) return null;

  const base = getNavApiBase();
  /** @type {Array<{code:string, name:string, dates:string[], navs:Array<number|null>, adjNavs:Array<number|null>}>} */
  const series = [];

  for (const code of codesArr) {
    // 1. 读缓存
    const cached = await getCachedSeries(code, interval);
    const existingPoints = cached?.points || [];
    let mergedPoints = existingPoints;
    let name = cached?.name || code;

    // 2. 算缺口
    const cachedRange = rangeOfPoints(existingPoints);
    const gaps = computeMissingRanges(cachedRange, { start, end });

    // 3. 逐个缺口 fetch + merge（无 backend 时跳过，仅依赖现有缓存）
    if (gaps.length > 0 && base) {
      for (const gap of gaps) {
        let data;
        try {
          data = await fetchNavCompare({ codes: [code], start: gap.start, end: gap.end, interval });
        } catch {
          // 单只基金失败不应让整批失败；记入控制台后跳过该缺口
          if (typeof console !== 'undefined') console.warn(`[nav-cache] fetch gap failed: ${code} ${gap.start}-${gap.end}`);
          continue;
        }
        const s = data && data.series && data.series[0];
        if (!s) continue;
        name = s.name || name;
        const newPoints = (s.dates || []).map((date, i) => ({
          date,
          unit: s.navs?.[i] ?? null,
          adj:  s.adjNavs?.[i] ?? s.navs?.[i] ?? null,
        }));
        mergedPoints = await mergeIntoCache(code, interval, name, newPoints);
      }
    } else if (gaps.length > 0 && !base) {
      // 无后端 + 有缺口：仅靠现有缓存（可能是空）
    }

    // 4. 切片到请求范围
    const selected = subsetByRange(mergedPoints, start, end);
    series.push({
      code,
      name,
      dates:   selected.map(p => p.date),
      navs:    selected.map(p => p.unit ?? null),
      adjNavs: selected.map(p => p.adj ?? p.unit ?? null),
    });
  }

  // 全部 series 都为空且没 base 也没缓存：与 fetchNavCompare 的 null 语义对齐
  const allEmpty = series.every(s => s.dates.length === 0);
  if (allEmpty && !base) return null;

  // 5. 客户端重算 stats（口径与服务器 nav-stats.js 完全一致）
  const stats = series.map(s => ({
    code: s.code,
    name: s.name,
    ...computeStats(s.dates, s.adjNavs, { interval }),
  }));

  // 6. 并集 range
  const range = computeUnionRange(series) || { start, end };

  return { codes: codesArr, range, series, stats };
}
