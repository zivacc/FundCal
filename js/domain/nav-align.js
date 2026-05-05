/**
 * 多基金净值序列日期对齐（纯函数，无 DOM 依赖）。
 *
 * 多只基金各自的交易日并不完全一致（停牌、合并购日历等会造成空缺）。
 * 为绘图与统计方便，先取所有日期的并集排序作为公共 X 轴；
 * 再把每只基金的净值映射到这条公共轴上，缺失点用"上一可用点"前向填充，
 * 避免 ECharts line series 出现锯齿状断线。
 */

/**
 * @typedef {{ code: string, dates: string[], adjNavs: Array<number|null> }} NavSeries
 */

/**
 * 取多条 NAV 序列日期的并集并排序（升序）。
 * @param {NavSeries[]} series
 * @returns {string[]}  YYYYMMDD 升序
 */
export function unionDates(series) {
  const set = new Set();
  for (const s of series) {
    if (!s || !Array.isArray(s.dates)) continue;
    for (const d of s.dates) set.add(d);
  }
  return [...set].sort();
}

/**
 * 把单条 NAV 序列重排到指定的公共日期轴上。
 * 缺失点用上一可用点前向填充；序列开头若仍缺失则保持 null。
 *
 * @param {string[]} allDates   公共 X 轴（升序）
 * @param {NavSeries} s
 * @returns {Array<number|null>}  与 allDates 等长
 */
export function alignSeriesToDates(allDates, s) {
  const aligned = new Array(allDates.length).fill(null);
  if (!s || !Array.isArray(s.dates) || !Array.isArray(s.adjNavs)) return aligned;

  // 用 Map 而非线性查找；输入未必有序，使用 Map 保证 O(n+m)
  const byDate = new Map();
  for (let i = 0; i < s.dates.length; i++) byDate.set(s.dates[i], s.adjNavs[i]);

  let last = null;
  for (let i = 0; i < allDates.length; i++) {
    const v = byDate.get(allDates[i]);
    if (v != null) {
      last = v;
      aligned[i] = v;
    } else if (last != null) {
      aligned[i] = last;
    } else {
      aligned[i] = null; // 序列开头尚无任何可用点
    }
  }
  return aligned;
}

/**
 * 一次性对齐所有序列：返回公共日期轴 + 每只基金对齐后的净值数组。
 *
 * @param {NavSeries[]} series
 * @returns {{ allDates: string[], alignedByCode: Map<string, Array<number|null>> }}
 */
export function alignAllSeries(series) {
  const allDates = unionDates(series);
  const alignedByCode = new Map();
  for (const s of series) {
    if (!s || !s.code) continue;
    alignedByCode.set(s.code, alignSeriesToDates(allDates, s));
  }
  return { allDates, alignedByCode };
}
