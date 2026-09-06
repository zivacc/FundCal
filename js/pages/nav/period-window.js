/** 周期统一以最后一个数据日为终点；YTD 从该年度首个数据日开始。 */
export function periodStartIndex(period, dates) {
  if (!dates?.length) return -1;
  const last = dates.at(-1);
  let target;
  if (period === 'YTD') target = `${last.slice(0, 4)}0101`;
  else {
    const days = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365, '3Y': 1095, '5Y': 1825, '10Y': 3650 }[period] || 365;
    const date = new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(4, 6)) - 1, Number(last.slice(6, 8))));
    date.setUTCDate(date.getUTCDate() - days);
    target = date.toISOString().slice(0, 10).replaceAll('-', '');
  }
  const found = dates.findIndex(date => date >= target);
  return found < 0 ? 0 : found;
}
