/**
 * 缓存基金列表页 —— 数据加载层 (2026 服务端分页重构)。
 *
 * 在线模式 (Oracle 部署 + nginx 反代):
 *   /api/fund/list?page=&size=&q=&sort=&fundType=&...   → 一页一拉, 服务端筛选/排序/分页
 *   /api/fund/filter-options                            → 筛选 tag + 频次, IDB SWR
 *
 * 灾备模式 (GitHub Pages 纯静态):
 *   data/allfund/search-index.json                      → 仅 code/name 极简列表,
 *                                                         前端本地分页 + 不支持筛选
 *
 * 调用方需自己处理 AbortController (用 params.signal) 防止竞态。
 */

import {
  fetchFundListPageFromAPI,
  fetchFilterOptionsFromAPI,
  fetchSearchIndexFromAPI,
  getFeeApiBase,
} from '../../data/fund-api.js';

/**
 * 拉一页基金。
 *
 * @param {Object} p
 * @param {number} p.page
 * @param {number} p.size
 * @param {string} [p.q]
 * @param {string} [p.sort]
 * @param {Object} [p.filters]
 * @param {AbortSignal} [p.signal]
 * @returns {Promise<{total:number, page:number, size:number, rows:Array<any>, fallback?:boolean}>}
 */
export async function loadFundsPage(p) {
  if (getFeeApiBase()) {
    const data = await fetchFundListPageFromAPI(p);
    if (data) return data;
  }
  // 灾备: 纯静态部署用 search-index 拼极简行, 本地分页
  const idx = await fetchSearchIndexFromAPI();
  const rows = Array.isArray(idx) ? idx : [];
  const q = (p.q || '').trim().toLowerCase();
  const filtered = q
    ? rows.filter(r => (r.code || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q) || (r.initials || '').toLowerCase().includes(q))
    : rows;
  const start = (p.page - 1) * p.size;
  const pageRows = filtered.slice(start, start + p.size).map(it => ({
    code: it.code,
    name: it.name || it.code,
    initials: it.initials || '',
    buyFee: 0, annualFee: 0,
    sellFeeSegments: [], redeemSegments: [],
    fundType: '', trackingTarget: '', performanceBenchmark: '', fundManager: '',
    establishmentDate: '', tradingStatus: null, updatedAt: '',
    source: '', status: null, lifecycle: 'normal',
    needsCrawl: !!it.needsCrawl,
  }));
  return { total: filtered.length, page: p.page, size: p.size, rows: pageRows, fallback: true };
}

/** 拉 filter-options (API 可用时), 失败/无 API 返回 null。 */
export async function loadFilterOptions() {
  return await fetchFilterOptionsFromAPI();
}
