/**
 * 基金详情表格 - 共享模块
 * 供主页 (app.js) 和指数选基页 (index-picker-page.js) 共用
 */
import { escapeHtml } from '../utils/format.js';
import { getColorForIndex } from '../utils/color.js';

/* ========== 排排网映射 ========== */

export const smppSelectedCodes = new Set();
let _smppMappingCache = null;
let _smppMappingLoading = null;
const SMPP_MAX_COMPARE = 10;
const FUND_DETAIL_FLOATING_ID = 'fund-detail-floating-actions';

export async function loadSmppMapping() {
  if (_smppMappingCache) return _smppMappingCache;
  if (_smppMappingLoading) return _smppMappingLoading;
  _smppMappingLoading = (async () => {
    try {
      const res = await fetch('data/smpp/simuwang-code-mapping.json');
      if (res.ok) { _smppMappingCache = await res.json(); return _smppMappingCache; }
    } catch { /* ignore */ }
    return {};
  })();
  const result = await _smppMappingLoading;
  _smppMappingLoading = null;
  return result;
}

/* ========== 格式化工具 ========== */

export function formatSellSegments(segs) {
  if (!Array.isArray(segs) || !segs.length) return '-';
  const sorted = segs.slice().sort((a, b) => (a.to ?? Infinity) - (b.to ?? Infinity));
  let prev = 0;
  return sorted.map(s => {
    const label = s.to == null ? `>${prev}天` : `${prev < s.to ? `${prev < 1 ? '' : `${prev}~`}${s.to}` : s.to}天`;
    if (s.to != null) prev = s.to;
    const pct = s.rate != null ? (s.rate * 100).toFixed(2) + '%' : '-';
    return `<div>${escapeHtml(label)}: ${pct}</div>`;
  }).join('');
}

export function formatTradingStatus(status) {
  if (!status || (!status.subscribe && !status.redeem)) return '-';
  const parts = [];
  if (status.subscribe) parts.push(`申购：${status.subscribe}`);
  if (status.redeem) parts.push(`赎回：${status.redeem}`);
  return parts.join('，');
}

export function formatNetAssetScale(netAssetScale) {
  const formatTwoLine = (fullText) => {
    const t = String(fullText || '').trim();
    if (!t) return '-';
    const m = t.match(/^(.*?)(（\s*截止至[：:].*）)$/);
    if (m) {
      return `<div>${escapeHtml(m[1].trim())}</div><div style="opacity:.75">${escapeHtml(m[2].trim())}</div>`;
    }
    return escapeHtml(t);
  };
  if (!netAssetScale) return '-';
  if (typeof netAssetScale === 'string') return formatTwoLine(netAssetScale);
  if (typeof netAssetScale === 'object') {
    const text = String(netAssetScale.text || '').trim();
    if (text) return formatTwoLine(text);
    const amountText = String(netAssetScale.amountText || '').trim();
    const asOfDate = String(netAssetScale.asOfDate || '').trim();
    if (amountText && asOfDate) {
      return `<div>${escapeHtml(amountText)}</div><div style="opacity:.75">${escapeHtml(`（截止至：${asOfDate}）`)}</div>`;
    }
    return amountText ? escapeHtml(amountText) : '-';
  }
  return '-';
}

function getStageReturnNumber(item) {
  if (!item) return null;
  if (typeof item.returnPct === 'number' && Number.isFinite(item.returnPct)) return item.returnPct;
  const txt = String(item.returnText || '').trim();
  const m = txt.match(/(-?[\d.]+)\s*%/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

function normalizeStageReturnPeriod(rawPeriod) {
  const text = String(rawPeriod || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const known = text.match(/(今年来|近1周|近1月|近3月|近6月|近1年|近2年|近3年|近5年|成立来)/);
  if (known) return known[1];
  return text;
}

function buildStageReturnCompareMeta(metas) {
  const preferredOrder = ['今年来', '近1周', '近1月', '近3月', '近6月', '近1年', '近2年', '近3年', '近5年', '成立来'];
  const periodSet = new Set();
  const maxByPeriod = {};

  for (const m of metas || []) {
    const arr = Array.isArray(m?.stageReturns) ? m.stageReturns : [];
    for (const item of arr) {
      const p = normalizeStageReturnPeriod(item?.period);
      if (!p) continue;
      periodSet.add(p);
      const n = getStageReturnNumber(item);
      if (n == null) continue;
      if (maxByPeriod[p] == null || n > maxByPeriod[p]) {
        maxByPeriod[p] = n;
      }
    }
  }

  const periods = [];
  preferredOrder.forEach(p => { if (periodSet.has(p)) periods.push(p); });
  Array.from(periodSet).forEach(p => { if (!periods.includes(p)) periods.push(p); });
  return { periods, maxByPeriod };
}

function formatStageReturns(stageReturns, periods, maxByPeriod) {
  const byPeriod = new Map();
  if (Array.isArray(stageReturns)) {
    stageReturns.forEach(item => {
      const p = normalizeStageReturnPeriod(item?.period);
      if (p) byPeriod.set(p, item);
    });
  }
  const periodList = Array.isArray(periods) && periods.length
    ? periods
    : (Array.isArray(stageReturns) ? stageReturns.map(i => normalizeStageReturnPeriod(i?.period)).filter(Boolean) : []);
  if (!periodList.length) return '-';

  return periodList.map(period => {
    const item = byPeriod.get(period);
    const val = item ? String(item.returnText || '').trim() : '';
    const num = getStageReturnNumber(item);
    const display = val || (num != null ? `${num.toFixed(2)}%` : '-');
    const maxVal = maxByPeriod && Object.prototype.hasOwnProperty.call(maxByPeriod, period) ? maxByPeriod[period] : null;
    const isBest = num != null && maxVal != null && Math.abs(num - maxVal) < 1e-9;
    return `
      <div class="fund-detail-return-line${isBest ? ' fund-detail-return-best' : ''}">
        <span class="fund-detail-return-period">${escapeHtml(period)}</span>
        <span class="fund-detail-return-value">${escapeHtml(display)}</span>
      </div>
    `;
  }).join('');
}

function formatPctValue(v) {
  if (v == null || (typeof v !== 'number') || !Number.isFinite(v)) return '-';
  return (v * 100).toFixed(2) + '%';
}

/* ========== 韭圈儿跳转工具 ========== */

const JIUQUAN_WARN_THRESHOLD = 6;

function openJiuquanCompare(codes) {
  if (!codes || !codes.length) return;
  const url = 'https://app.jiucaishuo.com/pagesA/manager/fund_pk?code=' + codes.join(',');
  window.open(url, '_blank');
}

function jiuquanBtnText(count) {
  if (count <= 0) return '去韭圈儿';
  if (count > JIUQUAN_WARN_THRESHOLD) return `去韭圈儿 (${count}) ⚠超${JIUQUAN_WARN_THRESHOLD}只`;
  return `去韭圈儿 (${count})`;
}

let _floatingToastTimer = null;
function showFloatingToast(msg) {
  let el = document.getElementById('fund-floating-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fund-floating-toast';
    el.className = 'fund-floating-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(_floatingToastTimer);
  _floatingToastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
}

/* ========== 排排网列选中 + 悬浮按钮 ========== */

function getOrCreateFloatingActions() {
  let root = document.getElementById(FUND_DETAIL_FLOATING_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = FUND_DETAIL_FLOATING_ID;
    root.className = 'fund-detail-floating-actions';
    root.hidden = true;
    root.innerHTML = `
      <button type="button" class="fund-detail-floating-btn fund-detail-floating-compare">去排排网比较</button>
      <button type="button" class="fund-detail-floating-btn fund-detail-floating-jiuquan">去韭圈儿</button>
      <button type="button" class="fund-detail-floating-btn fund-detail-floating-delete">删除选中</button>
    `;
    document.body.appendChild(root);
  }
  const compareBtn = root.querySelector('.fund-detail-floating-compare');
  const jiuquanBtn = root.querySelector('.fund-detail-floating-jiuquan');
  const deleteBtn = root.querySelector('.fund-detail-floating-delete');
  return { root, compareBtn, jiuquanBtn, deleteBtn };
}

function hideFloatingActions() {
  const root = document.getElementById(FUND_DETAIL_FLOATING_ID);
  if (root) root.hidden = true;
}

function openSmppCompare(mapping) {
  const selected = Array.from(smppSelectedCodes).slice(0, SMPP_MAX_COMPARE);
  const internalCodes = selected.map(c => mapping[c]).filter(Boolean);
  if (internalCodes.length === 0) {
    alert(selected.length === 0
      ? '请先选中至少一只基金'
      : '选中的基金在排排网映射表中未找到对应代码');
    return;
  }
  const url = 'https://dc.simuwang.com/comparison/index.html?id=' + internalCodes.join('%7C');
  window.open(url, '_blank');
}

function bindSmppColumnSelection(tbody, funds, smppMapping, { onDelete } = {}) {
  const mapping = smppMapping || {};
  const currentCodes = new Set(funds.map(f => (f.code || '').trim()).filter(Boolean));
  smppSelectedCodes.forEach(c => { if (!currentCodes.has(c)) smppSelectedCodes.delete(c); });
  const codeToFund = new Map();
  funds.forEach(f => {
    const code = String(f?.code || '').trim();
    if (code) codeToFund.set(code, f);
  });

  const { root, compareBtn, jiuquanBtn, deleteBtn } = getOrCreateFloatingActions();
  if (!compareBtn || !deleteBtn) return;

  const updateSelectedCells = () => {
    tbody.querySelectorAll('td.fund-detail-fund-cell').forEach((td) => {
      const code = String(td.getAttribute('data-fund-code') || '').trim();
      const selected = code && smppSelectedCodes.has(code);
      td.classList.toggle('fund-detail-fund-cell-selected', !!selected);
      td.setAttribute('aria-selected', selected ? 'true' : 'false');
      if (selected) td.title = '已选中，点击取消';
      else td.title = '点击选中此基金列';
    });
  };

  const updateFloatingActions = () => {
    const n = smppSelectedCodes.size;
    root.hidden = n === 0;
    compareBtn.textContent = n > 0
      ? `去排排网比较 (${Math.min(n, SMPP_MAX_COMPARE)})`
      : '去排排网比较';
    if (jiuquanBtn) {
      jiuquanBtn.textContent = jiuquanBtnText(n);
    }
    deleteBtn.hidden = !onDelete;
    updateSelectedCells();
  };

  tbody.onclick = (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('a,button,input,select,textarea,label')) return;
    const td = target.closest('td.fund-detail-fund-cell');
    if (!td || !tbody.contains(td)) return;
    const code = String(td.getAttribute('data-fund-code') || '').trim();
    if (!code) return;
    if (smppSelectedCodes.has(code)) smppSelectedCodes.delete(code);
    else smppSelectedCodes.add(code);
    updateFloatingActions();
  };

  compareBtn.onclick = () => openSmppCompare(mapping);

  if (jiuquanBtn) {
    jiuquanBtn.onclick = () => {
      const codes = Array.from(smppSelectedCodes);
      if (!codes.length) return;
      openJiuquanCompare(codes);
    };
  }

  deleteBtn.onclick = () => {
    if (!onDelete) return;
    const selectedCodes = Array.from(smppSelectedCodes);
    selectedCodes.forEach((code) => {
      const fund = codeToFund.get(code);
      if (fund) onDelete(fund, code);
    });
    smppSelectedCodes.clear();
    hideFloatingActions();
    updateSelectedCells();
  };

  updateFloatingActions();
}

/* ========== 主渲染函数 ========== */

/**
 * 渲染基金详情纵向表格
 * @param {HTMLElement} tbody - 目标 tbody
 * @param {Array} funds - 基金数据（需有 code, name；主页还有 color, _rawBuyFee, buyFee 等）
 * @param {Object} options
 * @param {HTMLElement} [options.wrapEl] - 外层容器，用于控制 display
 * @param {Array}    [options.metas] - 预加载的 meta 数据，不传则通过 fetchMeta 逐个拉取
 * @param {function} [options.fetchMeta] - (code) => Promise<meta>，用于拉取单只基金的详情
 * @param {boolean}  [options.showDiscountedBuyFee] - 是否显示买入原价 + 折后两行（主页用）
 * @param {function} [options.onDelete] - (fund, code) => void，传入则显示删除按钮
 */
export async function renderFundDetailTable(tbody, funds, options = {}) {
  const { wrapEl, metas: preloadedMetas, fetchMeta, showDiscountedBuyFee, onDelete } = options;

  if (!tbody) return;
  if (!funds || !funds.length) {
    if (wrapEl) wrapEl.style.display = 'none';
    smppSelectedCodes.clear();
    hideFloatingActions();
    return;
  }
  if (wrapEl) wrapEl.style.display = '';

  const metas = preloadedMetas || await Promise.all(funds.map(async f => {
    const code = (f.code || '').trim();
    if (!code || !fetchMeta) return {};
    try { return (await fetchMeta(code)) || {}; } catch { return {}; }
  }));

  const stageCompareMeta = buildStageReturnCompareMeta(metas);

  const rows = [
    {
      label: '基金名称',
      render: (f, _m, i) => {
        const color = f.color || getColorForIndex(i);
        return `<span class="fund-detail-color-dot" style="background:${color}"></span>${escapeHtml(f.name || '未命名基金')}`;
      }
    },
    { label: '基金代码', render: (f) => escapeHtml(f.code || '-') },
    { label: '基金类型', render: (_f, m) => escapeHtml(m.fundType || '-') },
    { label: '成立日期', render: (f, m) => escapeHtml(m.establishmentDate || f.establishmentDate || '-') },
    { label: '规模数据', render: (_f, m) => formatNetAssetScale(m.netAssetScale), nowrap: false },
  ];

  if (showDiscountedBuyFee) {
    rows.push(
      { label: '买入费率', render: (f) => f._rawBuyFee != null ? (f._rawBuyFee * 100).toFixed(2) + '%' : '-' },
      { label: '买入费率（折后）', render: (f) => f.buyFee != null ? (f.buyFee * 100).toFixed(2) + '%' : '-' },
    );
  } else {
    rows.push(
      { label: '申购费率', render: (f) => formatPctValue(f.buyFee) },
    );
  }

  rows.push(
    { label: '年化费率', render: (f) => formatPctValue(f.annualFee) },
    { label: '卖出费率分段', render: (f) => formatSellSegments(f.sellFeeSegments), nowrap: false },
    { label: '跟踪标的', render: (f, m) => escapeHtml(m.trackingTarget || f.trackingTarget || '-'), nowrap: false },
    { label: '业绩基准', render: (_f, m) => escapeHtml(m.performanceBenchmark || '-'), nowrap: false },
    {
      label: '收益数据（全部）',
      render: (_f, m) => formatStageReturns(
        m.stageReturns, stageCompareMeta.periods, stageCompareMeta.maxByPeriod
      ),
      nowrap: false
    },
    { label: '基金公司', render: (f, m) => escapeHtml(m.fundManager || f.fundManager || '-') },
    { label: '交易状态', render: (_f, m) => escapeHtml(formatTradingStatus(m.tradingStatus)) },
    { label: '更新时间', render: (_f, m) => escapeHtml(m.updatedAt || '-') },
    {
      label: '原始数据',
      render: (f) => {
        const code = (f.code || '').trim();
        if (!code) return '-';
        const isOverseas = /^968\d{3}$/.test(code);
        const emUrl = isOverseas
          ? `https://overseas.1234567.com.cn/${code}`
          : `https://fundf10.eastmoney.com/jjfl_${code}.html`;
        const sohuUrl = `https://q.fund.sohu.com/${code}/index.shtml?code=${code}`;
        return `<a href="${emUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-secondary">天天基金</a> <a href="${sohuUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-secondary">搜狐</a>`;
      }
    },
  );

  tbody.innerHTML = rows.map(row => {
    const th = `<th class="fund-detail-row-label">${row.label}</th>`;
    const style = row.nowrap === false ? ' style="white-space:normal"' : '';
    const tds = funds.map((f, i) => {
      const code = escapeHtml(String(f?.code || '').trim());
      return `<td class="fund-detail-fund-cell" data-fund-code="${code}"${style}>${row.render(f, metas[i], i)}</td>`;
    }).join('');
    return `<tr>${th}${tds}</tr>`;
  }).join('');

  const smppMapping = await loadSmppMapping();
  bindSmppColumnSelection(tbody, funds, smppMapping, { onDelete });
}
