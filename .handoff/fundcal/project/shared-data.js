// Shared mock data for FundCal redesign — real fund codes/names from the repo context.
// All rates are in percent (%).
window.FUND_DATA = [
  {
    code: '004400', name: '中欧时代先锋股票A',
    company: '中欧基金', track: '主动权益',
    buyFee: 1.50, buyDiscount: 0.10,
    sellTiers: [
      { days: 7,   rate: 1.50 },
      { days: 30,  rate: 0.75 },
      { days: 90,  rate: 0.50 },
      { days: 180, rate: 0.25 },
      { days: 365, rate: 0.10 },
      { days: 730, rate: 0.05 },
      { days: Infinity, rate: 0 },
    ],
    mgmtFee: 1.20, custodyFee: 0.20, serviceFee: 0.00,
    color: '#d04a3a',
  },
  {
    code: '004401', name: '中欧时代先锋股票C',
    company: '中欧基金', track: '主动权益',
    buyFee: 0, buyDiscount: 1,
    sellTiers: [
      { days: 7,   rate: 1.50 },
      { days: 30,  rate: 0.50 },
      { days: 90,  rate: 0.25 },
      { days: Infinity, rate: 0 },
    ],
    mgmtFee: 1.20, custodyFee: 0.20, serviceFee: 0.40,
    color: '#2c6fd1',
  },
  {
    code: '110011', name: '易方达优质精选混合',
    company: '易方达基金', track: '主动权益',
    buyFee: 1.50, buyDiscount: 0.10,
    sellTiers: [
      { days: 7,   rate: 1.50 },
      { days: 365, rate: 0.50 },
      { days: 730, rate: 0.25 },
      { days: Infinity, rate: 0 },
    ],
    mgmtFee: 1.50, custodyFee: 0.25, serviceFee: 0.00,
    color: '#8d4fbf',
  },
  {
    code: '023910', name: '华夏沪深300ETF联接A',
    company: '华夏基金', track: '沪深300',
    buyFee: 1.20, buyDiscount: 0.10,
    sellTiers: [
      { days: 7,   rate: 1.50 },
      { days: 365, rate: 0.50 },
      { days: Infinity, rate: 0 },
    ],
    mgmtFee: 0.15, custodyFee: 0.05, serviceFee: 0.00,
    color: '#2a8e6c',
  },
  {
    code: '000961', name: '天弘沪深300ETF联接C',
    company: '天弘基金', track: '沪深300',
    buyFee: 0, buyDiscount: 1,
    sellTiers: [
      { days: 7, rate: 1.50 },
      { days: 30, rate: 0.10 },
      { days: Infinity, rate: 0 },
    ],
    mgmtFee: 0.50, custodyFee: 0.10, serviceFee: 0.20,
    color: '#c77b2e',
  },
];

// Compute cumulative cost (%) for a fund at a given holding day.
// buy fee (discounted) + (annual mgmt+custody+service × days/365) + sell fee tier.
window.computeCumCost = function(fund, days, buyDiscountOverride) {
  const bd = buyDiscountOverride != null ? buyDiscountOverride : fund.buyDiscount;
  const buy = fund.buyFee * bd;
  const annual = (fund.mgmtFee + fund.custodyFee + fund.serviceFee) * (days / 365);
  let sell = 0;
  for (const t of fund.sellTiers) {
    if (days < t.days) { sell = t.rate; break; }
    sell = t.rate;
  }
  return buy + annual + sell;
};

// Format a percent value like 1.23%
window.fmtPct = function(v, dp = 2) {
  if (!isFinite(v)) return '—';
  return (v >= 0 ? '' : '') + v.toFixed(dp) + '%';
};

// Generate a curve series [{x,y}] for a fund across a day range.
window.curve = function(fund, minDay, maxDay, step, buyDiscount) {
  const pts = [];
  for (let d = minDay; d <= maxDay; d += step) {
    pts.push({ x: d, y: window.computeCumCost(fund, d, buyDiscount) });
  }
  return pts;
};

// Find crossover points between two curves (simple linear check on sampled series).
window.findCrossovers = function(s1, s2) {
  const out = [];
  for (let i = 1; i < Math.min(s1.length, s2.length); i++) {
    const a1 = s1[i-1].y - s2[i-1].y;
    const a2 = s1[i].y - s2[i].y;
    if (a1 === 0 || a2 === 0) continue;
    if ((a1 < 0) !== (a2 < 0)) {
      // linear interp
      const t = a1 / (a1 - a2);
      const x = s1[i-1].x + (s1[i].x - s1[i-1].x) * t;
      const y = s1[i-1].y + (s1[i].y - s1[i-1].y) * t;
      out.push({ x, y });
    }
  }
  return out;
};

// Index page mock data
window.INDEX_DATA = [
  { code: '000300', name: '沪深300', count: 312, pinyin: 'hs300', category: '宽基' },
  { code: '000905', name: '中证500', count: 187, pinyin: 'zz500', category: '宽基' },
  { code: '000852', name: '中证1000', count: 96, pinyin: 'zz1000', category: '宽基' },
  { code: '399006', name: '创业板指', count: 73, pinyin: 'cyb', category: '宽基' },
  { code: '000688', name: '科创50', count: 42, pinyin: 'kc50', category: '宽基' },
  { code: '399673', name: '创业板50', count: 28, pinyin: 'cyb50', category: '宽基' },
  { code: 'HJ9999', name: '黄金9999', count: 19, pinyin: 'hj9999', category: '商品' },
  { code: '931079', name: '消费龙头', count: 14, pinyin: 'xfld', category: '行业' },
  { code: '931865', name: '新能源车', count: 31, pinyin: 'xnyc', category: '行业' },
  { code: '931008', name: '科技100', count: 22, pinyin: 'kj100', category: '行业' },
  { code: '399997', name: '中证白酒', count: 17, pinyin: 'zzbj', category: '行业' },
  { code: 'HSTEC',  name: '恒生科技', count: 26, pinyin: 'hstec', category: '海外' },
];
