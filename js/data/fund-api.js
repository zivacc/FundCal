/**
 * 基金费率 API 适配器
 * 优先使用 API 服务；API 不可用时自动回退到静态 JSON 文件（GitHub Pages 纯静态模式）
 */

/* ========== 静态数据缓存（allfund.json 按需加载，全局只加载一次） ========== */

let _allfundCache = null;
let _allfundLoading = null;

async function loadAllfundStatic() {
  if (_allfundCache) return _allfundCache;
  if (_allfundLoading) return _allfundLoading;
  _allfundLoading = (async () => {
    try {
      const res = await fetch('data/allfund/allfund.json');
      if (!res.ok) return null;
      _allfundCache = await res.json();
      return _allfundCache;
    } catch { return null; }
  })();
  const result = await _allfundLoading;
  _allfundLoading = null;
  return result;
}

/* ========== 环境检测 ========== */

/**
 * 自动判断 API 基地址：
 * - 手动覆盖：在 config.js 中设置 window.FUND_FEE_API_BASE
 * - 本地开发：localhost/127.0.0.1 → http://localhost:3457/api/fund
 * - GitHub Pages：→ null（使用纯静态模式）
 * - Cloudflare Workers：→ /api/fund（同源 Worker 处理）
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
 * 搜索索引（code、name、initials）
 * API: /search-index | 静态: data/allfund/search-index.json
 */
export async function fetchSearchIndexFromAPI() {
  const data = await tryApiFetch('search-index', () => tryStaticFetch('data/allfund/search-index.json'));
  return Array.isArray(data) ? data : [];
}

/**
 * 已缓存基金代码列表
 * API: /codes | 静态: 从 allfund.json 提取
 */
export async function fetchFundCodesFromAPI() {
  const data = await tryApiFetch('codes', async () => {
    const all = await loadAllfundStatic();
    if (!all) return null;
    return { codes: all.codes || Object.keys(all.funds || all) };
  });
  if (!data) return [];
  const codes = data.codes ?? data;
  return Array.isArray(codes) ? codes.filter(c => String(c).trim().length === 6) : [];
}

/**
 * 联接/母基金索引
 * API: /feeder-index | 静态: data/allfund/feeder-index.json
 */
export async function fetchFeederIndexFromAPI() {
  const empty = { feederByMasterKey: {}, codeToFeeder: {} };
  const data = await tryApiFetch('feeder-index', () => tryStaticFetch('data/allfund/feeder-index.json'));
  if (!data) return empty;
  return {
    feederByMasterKey: data.feederByMasterKey || {},
    codeToFeeder: data.codeToFeeder || {}
  };
}

/**
 * 基金统计（跟踪标的 / 基金公司 / 业绩基准）
 * API: /stats | 静态: data/allfund/fund-stats.json
 */
export async function fetchFundStatsFromAPI() {
  const empty = {
    total: 0,
    trackingFundCount: 0,
    tracking: [],
    manager: [],
    benchmark: [],
  };
  const data = await tryApiFetch('stats', () => tryStaticFetch('data/allfund/fund-stats.json'));
  if (!data) return empty;
  return {
    total: data.total ?? 0,
    trackingFundCount: data.trackingFundCount ?? 0,
    tracking: Array.isArray(data.tracking) ? data.tracking : [],
    manager: Array.isArray(data.manager) ? data.manager : [],
    benchmark: Array.isArray(data.benchmark) ? data.benchmark : [],
  };
}

/**
 * 单只基金费率
 * API: /:code/fee | 静态: 优先尝试 data/allfund/funds/:code.json，最后才回退 allfund.json
 */
export async function fetchFundFeeFromAPI(fundCode) {
  const code = String(fundCode).trim().replace(/\D/g, '');
  if (code.length !== 6) return null;

  const data = await tryApiFetch(`${code}/fee`, async () => {
    // 1. 尝试从分片文件加载 (GitHub Pages 模式下显著减少流量)
    const shardData = await tryStaticFetch(`data/allfund/funds/${code}.json`);
    if (shardData) return shardData;

    // 2. 最后才回退到加载整个 allfund.json (向前兼容)
    const all = await loadAllfundStatic();
    if (!all) return null;
    const funds = all.funds || all;
    return funds[code] || null;
  });
  if (!data) return null;
  return transformApiDataToFundConfig(data);
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
