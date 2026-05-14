/**
 * 缓存基金列表页 —— 数据加载层。
 *
 * API 优先 (Oracle 部署):
 *   GET /api/fund/list?fields=summary  → 一次拉所有基金的 summary (含 sellFeeSegments)
 *
 * 灾备 (纯静态站点 / API 不可用):
 *   data/allfund/search-index.json + 按需 data/allfund/funds/<code>.json
 *   仅给到 code/name 等极简字段, 列表按钮"查看 JSON"会按需补全详情。
 *
 * 旧路径 (allfund.json / list-index.json) 已搬到 archive/, 不再读取。
 */

import { fetchFundListFromAPI, fetchSearchIndexFromAPI, getFeeApiBase } from '../../data/fund-api.js';

/** @typedef {Record<string, any>} FundRaw */

/**
 * 加载基金列表。
 *
 * @param {Object} opts
 * @param {(msg: string, isError?: boolean) => void} opts.setStatus
 * @param {(done: number, total: number) => void}   opts.setProgress
 * @param {Record<string, FundRaw>}                 opts.fundDetailMap   `查看 JSON` 弹窗按需写入
 * @returns {Promise<Array<Record<string, any>>|null>}
 */
export async function loadCachedFunds({ setStatus, setProgress, fundDetailMap }) {
  try {
    setStatus('正在读取基金列表...');
    setProgress(0, 1);

    // 优先：API
    const apiList = await fetchFundListFromAPI();
    if (Array.isArray(apiList) && apiList.length) {
      setProgress(1, 1);
      // fundDetailMap 由 json-modal 按需 fetch /api/fund/:code/fee 写入, 这里不预填
      return apiList.map(row => ({
        code: row.code,
        name: row.name || row.code,
        buyFee: row.buyFee ?? 0,
        annualFee: row.annualFee ?? 0,
        sellFeeSegments: row.sellFeeSegments ?? row.redeemSegments ?? [],
        fundType: row.fundType || '',
        establishmentDate: row.establishmentDate || '',
        trackingTarget: row.trackingTarget || '',
        performanceBenchmark: row.performanceBenchmark || '',
        fundManager: row.fundManager || '',
        tradingStatus: row.tradingStatus || null,
        updatedAt: row.updatedAt || '',
        initials: row.initials || '',
        source: row.source || '',
        status: row.status || null,
        lifecycle: row.lifecycle || 'normal',
        needsCrawl: !!row.needsCrawl,
        raw: null, // 弹窗打开时按需 fetch
      }));
    }

    // 灾备：纯静态部署 / API 不通时, 用 search-index 凑出仅 code/name 的列表
    if (!getFeeApiBase()) {
      const idx = await fetchSearchIndexFromAPI();
      if (Array.isArray(idx) && idx.length) {
        setProgress(1, 1);
        return idx.map(it => ({
          code: it.code,
          name: it.name || it.code,
          buyFee: 0,
          annualFee: 0,
          sellFeeSegments: [],
          fundType: '',
          establishmentDate: '',
          trackingTarget: '',
          performanceBenchmark: '',
          fundManager: '',
          tradingStatus: null,
          updatedAt: '',
          initials: it.initials || '',
          source: '',
          status: null,
          lifecycle: 'normal',
          needsCrawl: !!it.needsCrawl,
          raw: null,
        }));
      }
    }

    setStatus('未能加载基金列表 (API 不可达且无静态兜底)。', true);
    return null;
  } catch (err) {
    console.error('loadCachedFunds 失败:', err);
    setStatus('从 API 加载基金列表失败。', true);
    return null;
  }
}
