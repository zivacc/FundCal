/**
 * 基金费率 API 适配器
 * 优先读取本地缓存：需先运行 scripts/crawl-fund-fee.js 拉取数据，
 * 并运行 scripts/serve-fund-api.js 提供 /api/fund/:code/fee
 */

/**
 * 自动判断 API 基地址：
 * - 手动覆盖：设置 window.FUND_FEE_API_BASE 即可指定
 * - 本地开发：hostname 为 localhost/127.0.0.1 → http://localhost:3457/api/fund
 * - 服务器部署：其他情况 → /api/fund（走 Nginx 反向代理）
 */
export function getFeeApiBase() {
  if (typeof window !== 'undefined' && window.FUND_FEE_API_BASE) return window.FUND_FEE_API_BASE;
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') {
      return 'http://localhost:3457/api/fund';
    }
    return '/api/fund';
  }
  return 'http://localhost:3457/api/fund';
}

/**
 * 从 API 获取搜索索引（code、name、initials），供联想补全
 * @returns {Promise<Array<{code:string,name:string,initials:string}>>} 失败或空返回 []
 */
export async function fetchSearchIndexFromAPI() {
  try {
    const base = getFeeApiBase();
    const url = base.endsWith('/') ? `${base}search-index` : `${base}/search-index`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

/**
 * 从 API 获取已缓存的基金代码列表
 * @returns {Promise<string[]>} 6 位代码数组，失败或空返回 []
 */
export async function fetchFundCodesFromAPI() {
  try {
    const res = await fetch(`${getFeeApiBase()}/codes`);
    if (!res.ok) return [];
    const data = await res.json();
    const codes = data.codes;
    return Array.isArray(codes) ? codes.filter(c => String(c).trim().length === 6) : [];
  } catch (e) {
    return [];
  }
}

/**
 * 从 API 获取联接/母基金索引（feeder-index），供联接基金穿透使用
 * @returns {Promise<{feederByMasterKey:Object, codeToFeeder:Object}>} 失败返回 { feederByMasterKey: {}, codeToFeeder: {} }
 */
export async function fetchFeederIndexFromAPI() {
  try {
    const base = getFeeApiBase();
    const url = base.endsWith('/') ? `${base}feeder-index` : `${base}/feeder-index`;
    const res = await fetch(url);
    if (!res.ok) return { feederByMasterKey: {}, codeToFeeder: {} };
    const data = await res.json();
    return {
      feederByMasterKey: data.feederByMasterKey || {},
      codeToFeeder: data.codeToFeeder || {}
    };
  } catch (e) {
    return { feederByMasterKey: {}, codeToFeeder: {} };
  }
}

/**
 * 从 API 获取全部基金代码（天天基金全市场列表，供随机抽取）
 * @returns {Promise<string[]>} 6 位代码数组，失败或空返回 []
 */
export async function fetchAllFundCodesFromAPI() {
  try {
    const res = await fetch(`${getFeeApiBase()}/all-codes`);
    if (!res.ok) return [];
    const data = await res.json();
    const codes = data.codes;
    return Array.isArray(codes) ? codes.filter(c => String(c).trim().length === 6) : [];
  } catch (e) {
    return [];
  }
}

/**
 * 从本地缓存或 API 获取基金费率并转换为计算器所需格式
 * @param {string} fundCode - 6 位基金代码
 * @returns {Promise<Object|null>} 基金费率配置，失败返回 null
 */
export async function fetchFundFeeFromAPI(fundCode) {
  const code = String(fundCode).trim().replace(/\D/g, '');
  if (code.length !== 6) return null;
  try {
    const res = await fetch(`${getFeeApiBase()}/${code}/fee`);
    if (!res.ok) return null;
    const data = await res.json();
    return transformApiDataToFundConfig(data);
  } catch (e) {
    return null;
  }
}

/**
 * 将 API 返回的数据转换为计算器标准格式
 * @param {Object} apiData - API 原始数据
 * @returns {Object} { name, buyFee, sellFeeSegments, annualFee }
 */
/**
 * 将 API/本地缓存返回的数据转换为计算器标准格式
 * @param {Object} apiData - 含 name, buyFee, sellFeeSegments, annualFee（或等价字段）
 * @returns {Object} { name, buyFee, sellFeeSegments, annualFee }
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
      days: s.days ?? s.holdDays,
      rate: typeof s.rate === 'number' ? s.rate : parseFloat(s.rate ?? 0) / 100,
      ...(s.unbounded && { unbounded: true })
    })),
    annualFee,
    trackingTarget: apiData.trackingTarget ?? apiData.trackingIndex,
    fundManager: apiData.fundManager,
    performanceBenchmark: apiData.performanceBenchmark,
    tradingStatus: apiData.tradingStatus,
    ...(code && code.length >= 6 ? { code } : {})
  };
}
