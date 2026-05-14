/**
 * 基金费率 API 适配器
 *
 * 数据流优先级 (生产部署: Oracle Cloud + nginx 微缓存 + Cloudflare 边缘缓存):
 *   1. /api/fund/* (走后端 SQLite, 命中边缘则零回源)
 *   2. data/allfund/funds/<code>.json 单基金分片 (灾备/纯静态站点)
 *   3. data/allfund/search-index.json 等小静态索引 (兜底)
 *
 * 不再加载 75MB 的 allfund.json - 历史包袱已搬到 archive/。
 *
 * 大型静态索引 (search-index / fund-stats / feeder-index) 走 IndexedDB SWR：
 *   首次访问后写入 IDB，重访 5min 内零网络；超过 5min 用 If-None-Match → 304 短路。
 */

import { cachedJsonFetch } from './idb-cache.js';

/* ========== 环境检测 ========== */

/**
 * 自动判断 API 基地址：
 * - 手动覆盖：在 config.js 中设置 window.FUND_FEE_API_BASE
 * - 本地开发：localhost/127.0.0.1 → http://localhost:3457/api/fund
 * - GitHub Pages：→ null（使用纯静态分片模式）
 * - 自建服务器：→ /api/fund（Nginx 反向代理）
 */
export function getFeeApiBase() {
  if (typeof window !== 'undefined' && window.FUND_FEE_API_BASE) return window.FUND_FEE_API_BASE;
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') {
      return 'http://localhost:3457/api/fund';
    }
    if (h.endsWith('.github.io')) return null;
    if (h.endsWith('.workers.dev')) return '/api/fund';
    return '/api/fund';
  }
  return 'http://localhost:3457/api/fund';
}

/* ========== 通用：先试 API，失败回退静态文件 ========== */

async function tryApiFetch(urlPath, fallback) {
  const base = getFeeApiBase();
  if (base) {
    try {
      const sep = base.endsWith('/') ? '' : '/';
      const res = await fetch(`${base}${sep}${urlPath}`);
      if (res.ok) return await res.json();
    } catch { /* API 不可用，走 fallback */ }
  }
  return fallback();
}

async function tryStaticFetch(staticPath) {
  try {
    const res = await fetch(staticPath);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/* ========== 公开 API 函数 ========== */

/**
 * 构造资源 URL：有 API 基址走 API，否则走静态分片路径
 * @param {string} apiPath        如 'search-index'
 * @param {string} staticPath     如 'data/allfund/search-index.json'
 */
function resolveUrl(apiPath, staticPath) {
  const base = getFeeApiBase();
  if (!base) return staticPath;
  const sep = base.endsWith('/') ? '' : '/';
  return `${base}${sep}${apiPath}`;
}

/**
 * 搜索索引（code、name、initials）
 * 走 IndexedDB SWR：首次完整下载并缓存，重访零网络/304 短路
 */
export async function fetchSearchIndexFromAPI() {
  const url = resolveUrl('search-index', 'data/allfund/search-index.json');
  const { data } = await cachedJsonFetch(url, {
    key: 'search-index',
    fallback: () => tryStaticFetch('data/allfund/search-index.json'),
  });
  return Array.isArray(data) ? data : [];
}

/**
 * 已缓存基金代码列表
 * 直接复用 search-index 的 IDB 缓存（5min 内零额外请求）
 */
export async function fetchFundCodesFromAPI() {
  const base = getFeeApiBase();
  // 在线模式下若想用专用 /codes 端点，可改回 tryApiFetch；但实际从 search-index 复用更省
  if (base) {
    const data = await tryApiFetch('codes', () => null);
    if (data) {
      const codes = data.codes ?? data;
      if (Array.isArray(codes)) return codes.filter(c => String(c).trim().length === 6);
    }
  }
  const idx = await fetchSearchIndexFromAPI();
  return idx.map(it => it && it.code).filter(c => String(c || '').trim().length === 6);
}

/**
 * 联接/母基金索引（624 KB）— IDB SWR
 */
export async function fetchFeederIndexFromAPI() {
  const empty = { feederByMasterKey: {}, codeToFeeder: {} };
  const url = resolveUrl('feeder-index', 'data/allfund/feeder-index.json');
  const { data } = await cachedJsonFetch(url, {
    key: 'feeder-index',
    fallback: () => tryStaticFetch('data/allfund/feeder-index.json'),
  });
  if (!data) return empty;
  return {
    feederByMasterKey: data.feederByMasterKey || {},
    codeToFeeder: data.codeToFeeder || {}
  };
}

/**
 * 基金统计 1.6 MB — IDB SWR
 */
export async function fetchFundStatsFromAPI() {
  const empty = {
    total: 0,
    trackingFundCount: 0,
    tracking: [],
    manager: [],
    benchmark: [],
    fundType: [],
  };
  const url = resolveUrl('stats', 'data/allfund/fund-stats.json');
  const { data } = await cachedJsonFetch(url, {
    key: 'fund-stats',
    fallback: () => tryStaticFetch('data/allfund/fund-stats.json'),
  });
  if (!data) return empty;
  return {
    total: data.total ?? 0,
    trackingFundCount: data.trackingFundCount ?? 0,
    tracking: Array.isArray(data.tracking) ? data.tracking : [],
    manager: Array.isArray(data.manager) ? data.manager : [],
    benchmark: Array.isArray(data.benchmark) ? data.benchmark : [],
    fundType: Array.isArray(data.fundType) ? data.fundType : [],
  };
}

/**
 * 基金统计某分组的明细列表
 * API: /stats/detail?dim=tracking|manager|benchmark|fundType&label=...
 * 无静态兜底（分组明细只在线提供，纯静态部署走逐只 fee 拉取）
 *
 * @param {'tracking'|'manager'|'benchmark'|'fundType'} dim
 * @param {string} label
 * @returns {Promise<Array<{code,name,trackingTarget,fundManager,performanceBenchmark}>|null>}
 */
export async function fetchStatsDetailFromAPI(dim, label) {
  const base = getFeeApiBase();
  if (!base) return null;
  try {
    const sep = base.endsWith('/') ? '' : '/';
    const url = `${base}${sep}stats/detail?dim=${encodeURIComponent(dim)}&label=${encodeURIComponent(label)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * 列表页主数据：所有基金的 summary（含 sellFeeSegments / redeemSegments）
 * API: /list?fields=summary | 无静态兜底
 *
 * @returns {Promise<Array<Record<string, any>>|null>}
 */
export async function fetchFundListFromAPI() {
  const base = getFeeApiBase();
  if (!base) return null;
  try {
    const sep = base.endsWith('/') ? '' : '/';
    const res = await fetch(`${base}${sep}list?fields=summary`);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * 单只基金费率
 * API: /:code/fee | 静态分片: data/allfund/funds/:code.json
 */
export async function fetchFundFeeFromAPI(fundCode) {
  const code = String(fundCode).trim().replace(/\D/g, '');
  if (code.length !== 6) return null;

  const data = await tryApiFetch(`${code}/fee`, async () => {
    // 灾备路径：从分片文件加载
    return await tryStaticFetch(`data/allfund/funds/${code}.json`);
  });
  if (!data) return null;
  return transformApiDataToFundConfig(data);
}

/**
 * 单只基金原始详情（不做格式转换，给 JSON 弹窗等场景用）
 * API: /:code/fee | 静态分片: data/allfund/funds/:code.json
 */
export async function fetchFundRawFromAPI(fundCode) {
  const code = String(fundCode).trim().replace(/\D/g, '');
  if (code.length !== 6) return null;
  const data = await tryApiFetch(`${code}/fee`, async () => {
    return await tryStaticFetch(`data/allfund/funds/${code}.json`);
  });
  return data || null;
}

/* ========== 数据格式转换 ========== */

/**
 * 将 API/静态缓存返回的数据转换为计算器标准格式
 */
export function transformApiDataToFundConfig(apiData) {
  const buy = apiData.buyFee ?? apiData.purchaseFee ?? 0;
  const rawAnnual = apiData.annualFee ?? apiData.operationFees?.total;
  let annualFee = rawAnnual != null
    ? (typeof rawAnnual === 'number' ? rawAnnual : parseFloat(rawAnnual) / 100)
    : null;
  if (annualFee == null && apiData.operationFees) {
    annualFee = (parseFloat(apiData.operationFees.managementFee ?? 0) + parseFloat(apiData.operationFees.custodyFee ?? 0) + parseFloat(apiData.operationFees.salesServiceFee ?? 0));
  }
  if (annualFee == null) {
    const sum = (parseFloat(apiData.managementFee ?? 0) + parseFloat(apiData.custodyFee ?? 0) + parseFloat(apiData.salesFee ?? 0)) / 100;
    annualFee = Number.isNaN(sum) ? 0 : sum;
  }
  if (typeof annualFee !== 'number' || Number.isNaN(annualFee)) annualFee = 0;
  const segsSource = apiData.sellFeeSegments ?? apiData.redeemSegments ?? apiData.redeemFee ?? [];
  const code = apiData.code != null ? String(apiData.code).trim() : undefined;
  return {
    name: apiData.name ?? apiData.fundName ?? '未知基金',
    buyFee: typeof buy === 'number' ? buy : parseFloat(buy) / 100,
    sellFeeSegments: segsSource.map(s => ({
      to: s.to !== undefined ? s.to : (s.unbounded ? null : (s.days ?? s.holdDays ?? null)),
      rate: typeof s.rate === 'number' ? s.rate : parseFloat(s.rate ?? 0) / 100,
    })),
    annualFee,
    trackingTarget: apiData.trackingTarget ?? apiData.trackingIndex,
    fundManager: apiData.fundManager,
    performanceBenchmark: apiData.performanceBenchmark,
    fundType: apiData.fundType,
    netAssetScale: apiData.netAssetScale || null,
    stageReturns: Array.isArray(apiData.stageReturns) ? apiData.stageReturns : [],
    stageReturnsAsOf: apiData.stageReturnsAsOf || null,
    tradingStatus: apiData.tradingStatus,
    updatedAt: apiData.updatedAt,
    ...(code && code.length >= 6 ? { code } : {})
  };
}
