/**
 * 缓存基金列表页 —— 数据加载层。
 *
 * 两条加载路径：
 * 1. 优先：`data/allfund/list-index.json`
 *    一份"瘦身版"索引，仅含表格列要用的字段；不存在时回退路径 2。
 *    若 list-index 命中，再按需从 `allfund.json` 补全 `raw` 字段，让"查看 JSON"弹窗能拿到完整数据。
 * 2. 兜底：`data/allfund/allfund.json`
 *    旧部署 / 静态站点的兼容路径，原样使用全量数据。
 *
 * 副作用：把所有命中的原始详情写入调用方传入的 `fundDetailMap`，供 JSON 弹窗复用。
 *
 * 错误：所有异常被吞并通过 `setStatus(msg, isError=true)` 报告，函数返回 null。
 */

/** @typedef {Record<string, any>} FundRaw */

/** allfund.json 的全量缓存，模块级单例避免重复 fetch（数据可达数兆）。 */
let allfundStoreCache = null;
let allfundStoreLoading = null;

/**
 * 懒加载 allfund.json，并按代码索引；幂等。
 * @param {Record<string, FundRaw>} fundDetailMap   会被同步填充
 * @returns {Promise<Record<string, FundRaw>>}
 */
async function ensureAllfundStore(fundDetailMap) {
  if (allfundStoreCache) return allfundStoreCache;
  if (allfundStoreLoading) return allfundStoreLoading;
  allfundStoreLoading = (async () => {
    try {
      const res = await fetch('data/allfund/allfund.json').catch(() => null);
      if (!res || !res.ok) return {};
      const data = await res.json();
      const store = data.funds || data || {};
      /** @type {Record<string, FundRaw>} */
      const byCode = {};
      for (const code of Object.keys(store)) {
        byCode[code] = store[code];
        fundDetailMap[code] = store[code];
      }
      allfundStoreCache = byCode;
      return byCode;
    } catch {
      allfundStoreCache = {};
      return {};
    } finally {
      allfundStoreLoading = null;
    }
  })();
  return allfundStoreLoading;
}

/**
 * 加载基金列表。
 *
 * @param {Object} opts
 * @param {(msg: string, isError?: boolean) => void} opts.setStatus      状态文案更新
 * @param {(done: number, total: number) => void}   opts.setProgress    进度条更新
 * @param {Record<string, FundRaw>}                 opts.fundDetailMap   按代码存原始详情（会被本函数填充）
 * @returns {Promise<Array<Record<string, any>>|null>}                  失败返回 null（已通过 setStatus 报告）
 */
export async function loadCachedFunds({ setStatus, setProgress, fundDetailMap }) {
  try {
    setStatus('正在读取缓存基金列表...');
    setProgress(0, 1);

    // 优先：轻量级分片索引
    const indexRes = await fetch('data/allfund/list-index.json').catch(() => null);

    let funds;

    if (!indexRes || !indexRes.ok) {
      // 回退：旧部署兼容
      const store = await ensureAllfundStore(fundDetailMap);
      funds = Object.keys(store).map(code => {
        const f = store[code];
        return {
          code: f.code || code,
          name: f.name || code,
          buyFee: f.buyFee ?? 0,
          annualFee: f.annualFee ?? (f.operationFees?.total ?? 0),
          sellFeeSegments: f.sellFeeSegments ?? f.redeemSegments ?? [],
          fundType: f.fundType || '',
          establishmentDate: f.establishmentDate || '',
          trackingTarget: f.trackingTarget || '',
          performanceBenchmark: f.performanceBenchmark || '',
          fundManager: f.fundManager || '',
          tradingStatus: f.tradingStatus || null,
          updatedAt: f.updatedAt || '',
          raw: f,
        };
      }).filter(r => r.code); // 防御：跳过空 code
    } else {
      // 主路径：分片索引 + 按需补全 raw
      const list = await indexRes.json();
      const store = await ensureAllfundStore(fundDetailMap);
      funds = list.map(row => {
        const code = row.code || row.fundCode || '';
        const origin = code && store[code] ? store[code] : null;
        if (origin) fundDetailMap[code] = origin;
        return {
          code,
          name: row.name || code,
          buyFee: row.buyFee ?? origin?.buyFee ?? 0,
          annualFee: row.annualFee ?? origin?.annualFee ?? (origin?.operationFees?.total ?? 0),
          sellFeeSegments: row.sellFeeSegments ?? origin?.sellFeeSegments ?? origin?.redeemSegments ?? [],
          fundType: row.fundType || origin?.fundType || '',
          establishmentDate: row.establishmentDate || origin?.establishmentDate || '',
          trackingTarget: row.trackingTarget || origin?.trackingTarget || '',
          performanceBenchmark: row.performanceBenchmark || origin?.performanceBenchmark || '',
          fundManager: row.fundManager || origin?.fundManager || '',
          tradingStatus: row.tradingStatus || origin?.tradingStatus || null,
          updatedAt: row.updatedAt || origin?.updatedAt || '',
          initials: row.initials || '',
          source: row.source || (origin ? 'crawler' : 'tushare'),
          status: row.status || null,
          lifecycle: row.lifecycle || 'normal',
          needsCrawl: !!row.needsCrawl,
          raw: origin || row,
        };
      });
    }

    setProgress(1, 1);
    return funds;
  } catch {
    setStatus('从本地汇总文件加载缓存基金失败。', true);
    return null;
  }
}
