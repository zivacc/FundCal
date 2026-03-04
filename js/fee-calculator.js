/**
 * 基金费率计算核心模块
 * 支持分段卖出费率、年化按日收取费用
 * 预留扩展：可接入 API 获取基金费率数据
 */

// 标准分段节点（天）
export const SEGMENT_DAYS = [7, 30, 90, 180, 365, 730];

// 计算器最大持有天数（3 年）
export const MAX_CALC_DAYS = 1095;

/**
 * 根据持有天数获取适用的卖出费率
 * 表格逻辑：持有天数 a-费率 x 表示「上一行天数（无则为 0）到 a」的费率为 x，即区间 (a_prev, a] 适用费率 x；
 * 若最后一段带 unbounded: true，则 days 为区间起始，该段为 [days, +∞)，费率为 rate；否则最后一段之后费率为 0。
 * @param {number} holdDays - 持有天数
 * @param {Array<{days: number, rate: number, unbounded?: boolean}>} segments - 分段费率
 * @returns {number} 费率（0-1）
 */
export function getSellFeeRate(holdDays, segments) {
  if (!segments?.length || holdDays <= 0) return 0;
  // 无上限段优先：若存在 unbounded 且持有天数 > 其起始天数，直接返回该段费率
  const unboundedSeg = segments.find(s => s.unbounded);
  if (unboundedSeg != null && holdDays > unboundedSeg.days) return unboundedSeg.rate;
  const sorted = [...segments].sort((a, b) => a.days - b.days || (a.unbounded ? 1 : 0) - (b.unbounded ? 1 : 0));
  const last = sorted[sorted.length - 1];
  const lastDays = last.unbounded ? (sorted.length > 1 ? sorted[sorted.length - 2].days : 0) : last.days;
  if (holdDays > lastDays && !last.unbounded) return 0;
  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    if (seg.unbounded) continue;
    const prevDays = i === 0 ? 0 : sorted[i - 1].days;
    if (holdDays > prevDays && holdDays <= seg.days) return seg.rate;
  }
  return 0;
}

/**
 * 计算单日持有总费用（按本金1计算，结果为费率百分比）
 * @param {Object} fund - 基金配置
 * @param {number} holdDays - 持有天数
 * @returns {number} 总费用率（如 0.025 表示 2.5%）
 */
export function calcTotalFeeRate(fund, holdDays) {
  const buyFee = fund.buyFee ?? 0;
  const sellFee = getSellFeeRate(holdDays, fund.sellFeeSegments ?? []);
  const annualFee = fund.annualFee ?? 0; // 年化管理+托管+销售费
  const dailyFee = (annualFee / 365) * holdDays;
  return buyFee + sellFee + dailyFee;
}

/**
 * 计算费用曲线数据点
 * @param {Object} fund - 基金配置
 * @param {number} maxDays - 最大计算天数
 * @param {number} step - 步长（天）
 * @returns {Array<{days: number, feeRate: number}>}
 */
export function calcFeeCurve(fund, maxDays = MAX_CALC_DAYS, step = 1) {
  const points = [];
  for (let d = 1; d <= maxDays; d += step) {
    points.push({ days: d, feeRate: calcTotalFeeRate(fund, d) });
  }
  return points;
}

/**
 * 计算两条费用曲线的交叉点（二分法近似）
 * @param {Object} fundA
 * @param {Object} fundB
 * @param {number} maxDays
 * @returns {Array<{days: number, feeRate: number, fundA: string, fundB: string}>}
 */
/**
 * 将持有期总费率折算为年化费率：总费率 * (365 / 持有天数)
 */
export function toAnnualizedFeeRate(totalFeeRate, holdDays) {
  if (holdDays <= 0) return 0;
  return totalFeeRate * (365 / holdDays);
}

export function findCrossoverPoints(fundA, fundB, maxDays = MAX_CALC_DAYS) {
  const crossovers = [];
  const step = 1;
  let prevDiff = null;

  for (let d = 1; d <= maxDays; d += step) {
    const feeA = calcTotalFeeRate(fundA, d);
    const feeB = calcTotalFeeRate(fundB, d);
    const diff = feeA - feeB;

    if (prevDiff !== null && (prevDiff > 0 && diff <= 0 || prevDiff < 0 && diff >= 0)) {
      const d0 = d - step;
      const feeA0 = calcTotalFeeRate(fundA, d0);
      const feeB0 = calcTotalFeeRate(fundB, d0);
      const denom = (feeA - feeA0) - (feeB - feeB0);
      const t = Math.abs(denom) < 1e-10 ? 0.5 : (feeB0 - feeA0) / denom;
      const tClamped = Math.max(0, Math.min(1, t));
      const crossDay = Math.round(d0 + tClamped * step);
      const crossFee = calcTotalFeeRate(fundA, crossDay);
      crossovers.push({
        days: crossDay,
        feeRate: crossFee,
        annualizedFeeRate: toAnnualizedFeeRate(crossFee, crossDay),
        fundA: fundA.name,
        fundB: fundB.name,
        beforeCross: prevDiff > 0 ? fundB.name : fundA.name,
        afterCross: prevDiff > 0 ? fundA.name : fundB.name
      });
    }
    prevDiff = diff;
  }
  return crossovers;
}

/**
 * 多基金两两交叉点
 */
export function findAllCrossovers(funds, maxDays = MAX_CALC_DAYS) {
  const all = [];
  for (let i = 0; i < funds.length; i++) {
    for (let j = i + 1; j < funds.length; j++) {
      const pts = findCrossoverPoints(funds[i], funds[j], maxDays);
      all.push(...pts);
    }
  }
  return all.sort((a, b) => a.days - b.days);
}
