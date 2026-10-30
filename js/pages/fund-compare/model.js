export const MAX_COMPARE_FUNDS = 8;

export function comparisonCodes(values) {
  const codes = [...new Set(values.map(value => String(value).trim()))];
  if (codes.some(code => !/^\d{6}$/.test(code))) throw new Error('请输入六位基金代码');
  if (codes.length > MAX_COMPARE_FUNDS) throw new Error(`一次最多比较 ${MAX_COMPARE_FUNDS} 只基金，请减少选择`);
  return codes;
}

export function comparisonHref(values) {
  const codes = comparisonCodes(values);
  return '#/compare' + (codes.length ? '/' + codes.join(',') : '');
}

const text = value => value == null || value === '' ? '—' : String(value);
export function percent(value, fractional = false) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${(value * (fractional ? 100 : 1)).toFixed(2)}%` : '—';
}

// Select one whole report. Never fill a missing field from a different period.
export function reportFor(history, date = 'latest') {
  const available = (history?.periods || []).filter(row => row.available === true);
  if (date !== 'latest') return available.find(row => row.as_of_date === date) || null;
  return available.toSorted((a, b) => b.as_of_date.localeCompare(a.as_of_date))[0] || null;
}

export function reportDates(entries) {
  return [...new Set(entries.flatMap(entry => (entry.history?.periods || [])
    .filter(row => row.available).map(row => row.as_of_date)))].sort().reverse();
}

export function redemptionText(segments) {
  if (!Array.isArray(segments) || !segments.length) return '—';
  return segments.map((segment, index) => {
    const previous = index ? segments[index - 1].to : 0;
    const range = segment.to == null ? (index ? `≥ ${previous} 天` : '全部持有期')
      : index ? `${previous} ≤ 天数 < ${segment.to}` : `< ${segment.to} 天`;
    return `${range}：${percent(segment.rate, true)}`;
  }).join('\n');
}

const basic = (label, get) => ({ label, value: entry => text(get(entry.raw || {})) });
// Legacy static shards default unknown fees to zero; do not present those as contractual rates.
const fee = (label, get) => ({ label, value: entry => entry.source === 'static' ? '—' : percent(get(entry.raw || {}), true) });
const report = (label, get) => ({ label, value: (entry, date) => get(reportFor(entry.history, date)) });

export function comparisonSections(entries) {
  const stageOrder = ['近1周', '近1月', '近3月', '近6月', '今年来', '近1年', '近2年', '近3年', '近5年', '成立来'];
  const stages = [...new Set(entries.flatMap(entry => (entry.raw?.stageReturns || []).map(row => row.period)))]
    .sort((a, b) => (stageOrder.indexOf(a) < 0 ? 99 : stageOrder.indexOf(a)) - (stageOrder.indexOf(b) < 0 ? 99 : stageOrder.indexOf(b)));
  return [
    { title: '基本资料', rows: [
      basic('基金类型', d => d.fundType), basic('基金公司', d => d.fundManager),
      basic('成立日期', d => d.establishmentDate),
      basic('资产规模', d => d.netAssetScale?.text || d.netAssetScale?.amountText),
      basic('规模截至日期', d => d.netAssetScale?.asOfDate),
      basic('跟踪标的', d => d.trackingTarget), basic('业绩比较基准', d => d.performanceBenchmark),
      basic('申购状态', d => d.tradingStatus?.subscribe), basic('赎回状态', d => d.tradingStatus?.redeem),
      basic('资料更新时间', d => d.updatedAt),
    ] },
    { title: '现行费用', rows: [
      fee('申购费率', d => d.buyFee), fee('显性年化费率', d => d.annualFee),
      fee('管理费', d => d.operationFees?.managementFee), fee('托管费', d => d.operationFees?.custodyFee),
      fee('销售服务费', d => d.operationFees?.salesServiceFee),
      { label: '浮动年化费率', value: entry => entry.source === 'static' || entry.raw?.annualFee == null ? '—' : entry.raw.isFloatingAnnualFee ? '是 · 详见基金文件' : '否' },
      { label: '赎回费分段', value: entry => entry.source === 'static' ? '—' : redemptionText(entry.raw?.redeemSegments?.length ? entry.raw.redeemSegments : entry.raw?.sellFeeSegments) },
    ] },
    { title: '晨星历史参考 · 费用与换手', rows: [
      report('参考报告期', row => text(row?.as_of_date)),
      report('晨星分类', row => text(row?.morningstar_category)),
      report('换手率', row => percent(row?.turnover_pct)),
      report('同类换手率中值', row => percent(row?.category_median_turnover_pct)),
      report('换手率同类百分位', row => percent(row?.turnover?.percentile)),
      report('同类有效份额样本数', row => text(row?.turnover?.sampleSize)),
      report('历史显性费率', row => percent(row?.explicit_fee_pct)),
      report('隐性费率（估）', row => percent(row?.implicit_fee_pct)),
      report('综合费率（估）', row => percent(row?.total_fee_pct)),
      report('综合费率排名', row => percent(row?.total_fee_rank_pct)),
      report('来源文件', row => text(row?.source_file)),
    ] },
    { title: '阶段业绩', rows: [basic('业绩截至日期', d => d.stageReturnsAsOf),
      ...stages.map(period => ({ label: period, value: entry => {
        const row = entry.raw?.stageReturns?.find(value => value.period === period);
        return row?.returnText || percent(row?.returnPct);
      } })),
    ] },
  ];
}
