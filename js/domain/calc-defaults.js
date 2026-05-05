/**
 * 计算器（#/calc）业务默认值与示例数据
 */

/** 示例数据使用的基金代码（004400, 004401, 023910） */
export const DEMO_FUND_CODES = ['004400', '004401', '023910'];

/** 默认分段：7/30/365 + 永久（含义：(prev.to, to]，to=null 表 (prev.to,+∞)） */
export const DEFAULT_SEGMENTS = [
  { to: 7, rate: 0.015 },
  { to: 30, rate: 0 },
  { to: 365, rate: 0 },
  { to: null, rate: 0 }
];

/** 可选快捷分段天数：表格中不存在该天数时显示对应按钮 */
export const QUICK_SEGMENT_DAYS = [7, 30, 90, 180, 365, 730];

export function defaultSegments() {
  return DEFAULT_SEGMENTS.map(s => ({ ...s }));
}
