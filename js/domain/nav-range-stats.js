/**
 * 区间统计：给定区间 [s..e] 内的对齐净值序列，输出多种汇总指标。
 *
 * 与 nav-stats.js / nav-statistics.js 的区别：
 *   - 本模块面向"鼠标右键框选区间"这种交互，输入是已经对齐到全局日期轴的 navs，
 *     允许两端含 null（基金成立日前）。统计仅基于区间内非空段。
 *   - 输出字段更贴近用户在框选 panel 上要看到的"短句指标"：涨跌、振幅、最大上涨等。
 */

/**
 * @typedef {Object} RangeStats
 * @property {number} firstIdx        区间内首个非空索引（相对原数组）
 * @property {number} lastIdx         区间内末个非空索引
 * @property {string} firstDate       YYYYMMDD（紧凑），firstIdx 对应日期
 * @property {string} lastDate        YYYYMMDD（紧凑），lastIdx 对应日期
 * @property {number} days            firstDate 与 lastDate 的自然日跨度
 * @property {number} startNav        firstIdx 对应净值
 * @property {number} endNav          lastIdx 对应净值
 * @property {number} change          endNav - startNav
 * @property {number} changePct       (endNav/startNav - 1) * 100
 * @property {number} cagr            年化复合收益率（百分比）
 * @property {number} maxNav          区间内最高净值
 * @property {number} minNav          区间内最低净值
 * @property {number} meanNav         区间内非空均值
 * @property {number} maxDrawdown     从区间首个 peak 起的最大回撤（≤0，百分比）
 * @property {number} maxRise         从区间首个 trough 起的最大上涨（≥0，百分比）
 * @property {number} swing           (max-min)/min * 100，区间振幅
 */

/**
 * 计算 [s..e] 区间内的统计。
 *
 * 区间内若没有 ≥ 2 个非空数据点（基金成立前 / 数据缺）则返回 null。
 *
 * @param {string[]} dates  YYYYMMDD（紧凑），与 navs 同长
 * @param {Array<number|null>} navs  对齐后的净值
 * @param {number} s  起始索引（含）
 * @param {number} e  结束索引（含）
 * @returns {RangeStats|null}
 */
export function computeRangeStats(dates, navs, s, e) {
  if (!Array.isArray(dates) || !Array.isArray(navs)) return null;
  if (dates.length !== navs.length) return null;
  if (s < 0 || e >= navs.length || s > e) return null;

  // 区间内首末非空索引
  let firstIdx = -1, lastIdx = -1;
  for (let k = s; k <= e; k++) {
    if (navs[k] != null) { firstIdx = k; break; }
  }
  if (firstIdx === -1) return null;
  for (let k = e; k >= firstIdx; k--) {
    if (navs[k] != null) { lastIdx = k; break; }
  }
  if (lastIdx <= firstIdx) return null;

  const startNav = navs[firstIdx];
  const endNav = navs[lastIdx];
  const change = endNav - startNav;
  const changePct = startNav > 0 ? (endNav / startNav - 1) * 100 : 0;

  // 单遍：max/min/mean/maxDD/maxRise/swing
  let maxNav = -Infinity, minNav = Infinity;
  let sum = 0, count = 0;
  let peak = -Infinity;
  let trough = Infinity;
  let maxDD = 0;   // 起始 peak 还没建立时回撤为 0
  let maxRise = 0; // 起始 trough 还没建立时上涨为 0
  for (let k = firstIdx; k <= lastIdx; k++) {
    const v = navs[k];
    if (v == null) continue;
    if (v > maxNav) maxNav = v;
    if (v < minNav) minNav = v;
    sum += v; count++;

    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (v / peak - 1) * 100;
      if (dd < maxDD) maxDD = dd;
    }
    if (v < trough) trough = v;
    if (trough > 0) {
      const up = (v / trough - 1) * 100;
      if (up > maxRise) maxRise = up;
    }
  }
  const meanNav = count > 0 ? sum / count : 0;
  const swing = minNav > 0 ? (maxNav / minNav - 1) * 100 : 0;

  const firstDate = dates[firstIdx];
  const lastDate = dates[lastIdx];
  const days = ymdDiffDays(firstDate, lastDate);

  let cagr = 0;
  if (startNav > 0 && days > 0) {
    cagr = (Math.pow(endNav / startNav, 365 / days) - 1) * 100;
  }

  return {
    firstIdx, lastIdx, firstDate, lastDate, days,
    startNav, endNav, change, changePct, cagr,
    maxNav, minNav, meanNav,
    maxDrawdown: maxDD, maxRise, swing,
  };
}

function ymdDiffDays(a, b) {
  if (!a || !b || a.length < 8 || b.length < 8) return 0;
  const pa = Date.UTC(+a.slice(0, 4), +a.slice(4, 6) - 1, +a.slice(6, 8));
  const pb = Date.UTC(+b.slice(0, 4), +b.slice(4, 6) - 1, +b.slice(6, 8));
  return Math.round((pb - pa) / 86400000);
}
