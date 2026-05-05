/**
 * 计算器页 - 基金辅助工具
 *
 * 职责：
 *   - 显示名格式化（穿透标注）
 *   - 卡片颜色同步（DOM 反向写入）
 *   - 联接基金穿透：年化费率 = 联接 + 母基金，附加 __penetrationInfo
 *   - 动态有效持有天数：根据卖出分段 + 交叉点决定 X 轴显示终点
 *
 * 此模块自带 feederIndexCache（懒加载），调用方只需 await 暴露的函数。
 */

import { fetchFundFeeFromAPI, fetchFeederIndexFromAPI } from '../../data/fund-api.js';
import { findAllCrossovers } from '../../domain/fee-calculator.js';

/** 计算器内部的 X 轴搜索上限（用于交叉点扫描与「最长」按钮） */
export const CALC_EXTENDED_DAYS = 7300;

/** 将卡片上的颜色点与当前 fund.color 同步，保证卡片与图表颜色一致 */
export function syncCardColors(funds) {
  const cards = document.querySelectorAll('.fund-card');
  cards.forEach((card, i) => {
    const dot = card.querySelector('.color-dot');
    if (dot && funds[i]) dot.style.background = funds[i].color;
  });
}

/** 图表与悬浮窗中显示的基金名：已穿透的联接基金后加「(穿透)」标注 */
export function getFundDisplayName(fund) {
  const name = fund && fund.name ? String(fund.name).trim() : '';
  if (fund && fund.__penetrationInfo) return name ? name + ' (穿透)' : '(穿透)';
  return name || '基金';
}

/** 联接/母基金索引缓存 */
let feederIndexCache = null;

export async function ensureFeederIndex() {
  if (feederIndexCache) return feederIndexCache;
  feederIndexCache = await fetchFeederIndexFromAPI();
  return feederIndexCache;
}

/**
 * 对联接基金做年化费率穿透：年化 = 联接年化 + 母基金年化，买入/卖出费率不变。
 * 为被穿透的基金附加 __penetrationInfo 供图例展示。
 * @param {Array<{code?:string, annualFee?:number, [k:string]:any}>} funds
 * @returns {Promise<typeof funds>} 同一数组（已就地修改）
 */
export async function applyFeederPenetration(funds) {
  const { codeToFeeder } = await ensureFeederIndex();
  if (!codeToFeeder || Object.keys(codeToFeeder).length === 0) return funds;
  for (const fund of funds) {
    const code = fund.code && String(fund.code).trim();
    if (!code || code.length !== 6) continue;
    const info = codeToFeeder[code];
    if (!info || !info.isFeeder || !info.masterCode) continue;
    const master = await fetchFundFeeFromAPI(info.masterCode);
    const originalAnnual = fund.annualFee ?? 0;
    const masterAnnual = (master && typeof master.annualFee === 'number') ? master.annualFee : 0;
    const penetratedAnnual = originalAnnual + masterAnnual;
    fund.annualFee = penetratedAnnual;
    fund.__penetrationInfo = {
      masterName: info.masterName || `母基金${info.masterCode}`,
      masterCode: info.masterCode,
      originalAnnual,
      masterAnnual,
      penetratedAnnual
    };
  }
  return funds;
}

/**
 * 未指定显示区间时，在 [1, CALC_EXTENDED_DAYS] 内算交叉点，
 * 显示结束 = max(365, dynamic)，
 * dynamic = max(表格最大天数+100, 最后交叉点+50)；
 * 永久段不影响最大天数
 */
export function getEffectiveMaxDays(funds) {
  const maxSegmentDays = funds.reduce((acc, f) => {
    const segs = f.sellFeeSegments ?? [];
    const finite = segs.filter(s => s.to != null).map(s => s.to);
    const m = finite.length ? Math.max(...finite) : 0;
    return Math.max(acc, m);
  }, 0);
  const crossovers = findAllCrossovers(funds, CALC_EXTENDED_DAYS);
  const lastCrossover = crossovers.length ? Math.max(...crossovers.map(c => c.days)) : 0;
  const dynamic = Math.max(maxSegmentDays + 100, lastCrossover + 50);
  return Math.max(365, Math.min(dynamic, CALC_EXTENDED_DAYS));
}
