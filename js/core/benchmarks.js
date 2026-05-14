/**
 * 默认基准映射 + 基准切换器候选清单。
 *
 * 命名空间约定见 ./code-kind.js (基金 6 位数字 / 指数 ts_code).
 *
 * 数据缺口：标 available=false 的指数我们尚未接入数据源；UI 在切换器里 disabled 即可，
 * 后续接源 (csindex / 自建 / 黄金交易所等) 后改 available=true 即生效。
 */
export { isIndexKey, isFundCode, KIND, detectKind } from './code-kind.js';

/**
 * fund_type → 默认基准 ts_code。
 *
 * ORDER MATTERS — 顺序自上而下短路, 第一条 match 命中即返回:
 *   1. 债/货币  → 国债 (要先于 QDII, 否则 "QDII债券" 会被 QDII 抢去)
 *   2. 港股      → 恒生 (要先于 QDII, 抢"QDII港股")
 *   3. 海外/美股 → 纳指
 *   4. 黄金/商品 → 上海金/AU9999
 *
 * 注: 若 tracking_target 已指向具体指数 (index_fund_tracker 命中)，应优先用之；
 * 本表是兜底.
 */
export const FALLBACK_BENCHMARK_BY_FUND_TYPE = [
  { match: (t) => /债|货币/.test(t || ''), tsCode: 'CBA00301.CSI' },
  { match: (t) => /港股|QDII.*港|香港/.test(t || ''), tsCode: 'HSI.HI' },
  { match: (t) => /QDII|海外|美股|纳斯达克|标普/.test(t || ''), tsCode: 'NDX.GI' },
  { match: (t) => /黄金|商品/.test(t || ''), tsCode: 'AU9999.SGE' },
];

export const DEFAULT_BENCHMARK = '000300.SH'; // 沪深300 (全收益版接入后改为 H00300.CSI 之类)

/**
 * 快速切换器候选指数。available=false 表示数据未接入 — UI 应 disabled。
 * 排序大致按用户截图顺序。
 *
 * isPrice=true 表示这是"价格指数"而非"全收益"，UI 加角标提示。
 */
export const BENCHMARK_CANDIDATES = [
  { tsCode: '000300.SH',    label: '沪深300',          available: true,  isPrice: true },
  { tsCode: 'HSI.HI',       label: '恒生指数',          available: true,  isPrice: true },
  { tsCode: '000905.SH',    label: '中证500',          available: true,  isPrice: true },
  { tsCode: '000852.SH',    label: '中证1000',         available: true,  isPrice: true },
  { tsCode: '932000.CSI',   label: '中证2000',         available: true,  isPrice: true },
  { tsCode: '932050.CSI',   label: '中证全指',          available: true,  isPrice: true },
  { tsCode: '000510.CSI',   label: '中证A500',         available: true,  isPrice: true },
  { tsCode: 'H30269.CSI',   label: '红利低波',          available: true,  isPrice: true },
  { tsCode: '000016.SH',    label: '上证50',           available: true,  isPrice: true },
  { tsCode: '399303.SZ',    label: '国证2000',          available: true,  isPrice: true },
  { tsCode: 'SPX.GI',       label: '标普500',           available: true,  isPrice: true },
  { tsCode: '000688.SH',    label: '科创50',           available: true,  isPrice: true },
  { tsCode: '899050.BJ',    label: '北证50',           available: true,  isPrice: true },
  { tsCode: 'NDX.GI',       label: '纳斯达克100',       available: true,  isPrice: true },
  { tsCode: '399006.SZ',    label: '创业板指',          available: true,  isPrice: true },
  // ─── 待接入数据源 ───
  { tsCode: 'IXIC.GI',      label: '纳斯达克综合',      available: false, isPrice: true },
  { tsCode: 'DJI.GI',       label: '道琼斯工业',        available: false, isPrice: true },
  { tsCode: 'CBA00301.CSI', label: '中债国债总指数',    available: false, isPrice: false },
  { tsCode: 'WIND_WMICRO',  label: '微盘股指数',        available: false, isPrice: true },
];

/**
 * 给定一只基金的 fundType / trackingTarget，决定默认基准 ts_code。
 *
 * @param {Object} fund   { fundType, trackingIndexTsCode? }
 * @returns {string}      ts_code (e.g. 'HSI.HI'); 总返回某个 candidate
 */
export function resolveDefaultBenchmark(fund) {
  if (fund?.trackingIndexTsCode) return fund.trackingIndexTsCode;
  const ft = fund?.fundType || '';
  for (const rule of FALLBACK_BENCHMARK_BY_FUND_TYPE) {
    if (rule.match(ft)) return rule.tsCode;
  }
  return DEFAULT_BENCHMARK;
}

