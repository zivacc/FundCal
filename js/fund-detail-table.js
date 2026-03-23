/**
 * 基金详情表格 - 共享模块
 * 供主页 (app.js) 和指数选基页 (index-picker-page.js) 共用
 */
import { escapeHtml, getColorForIndex } from './utils.js';

/* ========== 排排网映射 ========== */

export const smppSelectedCodes = new Set();
let _smppMappingCache = null;
let _smppMappingLoading = null;

export async function loadSmppMapping() {
  if (_smppMappingCache) return _smppMappingCache;
  if (_smppMappingLoading) return _smppMappingLoading;
  _smppMappingLoading = (async () => {
    try {
      const res = await fetch('data/smpp/simuwang-code-mapping-2026-03-22.json');
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
  const sorted = segs.slice().sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  return sorted.map(s => {
    const label = s.unbounded ? `≥${s.days}天` : `${s.days}天`;
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

/* ========== 排排网操作行 ========== */

function renderSmppActionRow(tbody, funds, smppMapping, { onDelete } = {}) {
  const MAX_COMPARE = 10;
  const mapping = smppMapping || {};
  const actionRow = document.createElement('tr');
  actionRow.className = 'fund-detail-action-row';

  const th = document.createElement('th');
  th.className = 'fund-detail-row-label';
  const compareBtn = document.createElement('button');
  compareBtn.type = 'button';
  compareBtn.className = 'btn btn-sm btn-primary fund-detail-compare-btn';
  compareBtn.title = '在排排网对比选中的基金（最多10只）';
  th.appendChild(compareBtn);
  actionRow.appendChild(th);

  const currentCodes = new Set(funds.map(f => (f.code || '').trim()).filter(Boolean));
  smppSelectedCodes.forEach(c => { if (!currentCodes.has(c)) smppSelectedCodes.delete(c); });

  function updateCompareBtn() {
    const n = smppSelectedCodes.size;
    compareBtn.textContent = n > 0 ? `排排网比较 (${Math.min(n, MAX_COMPARE)})` : '排排网比较';
    compareBtn.disabled = n === 0;
  }

  funds.forEach(f => {
    const td = document.createElement('td');
    td.className = 'fund-detail-action-cell';
    const code = (f.code || '').trim();
    const hasMapping = code && !!mapping[code];

    if (code) {
      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      const isSelected = smppSelectedCodes.has(code);
      selectBtn.className = 'btn btn-sm fund-detail-select-btn' + (isSelected ? ' active' : '');
      selectBtn.textContent = isSelected ? '已选' : '选中';
      if (!hasMapping) {
        selectBtn.disabled = true;
        selectBtn.title = '排排网无此基金映射';
      }
      selectBtn.addEventListener('click', () => {
        if (!hasMapping) return;
        if (smppSelectedCodes.has(code)) {
          smppSelectedCodes.delete(code);
          selectBtn.classList.remove('active');
          selectBtn.textContent = '选中';
        } else {
          smppSelectedCodes.add(code);
          selectBtn.classList.add('active');
          selectBtn.textContent = '已选';
        }
        updateCompareBtn();
      });
      td.appendChild(selectBtn);

      if (!hasMapping) {
        const tag = document.createElement('span');
        tag.className = 'fund-detail-no-mapping';
        tag.textContent = '无映射';
        td.appendChild(tag);
      }
    }

    if (onDelete) {
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-sm btn-secondary fund-detail-delete-btn';
      deleteBtn.textContent = '删除';
      deleteBtn.title = '移除该基金卡片';
      deleteBtn.addEventListener('click', () => {
        smppSelectedCodes.delete(code);
        onDelete(f, code);
      });
      td.appendChild(deleteBtn);
    }

    actionRow.appendChild(td);
  });

  compareBtn.addEventListener('click', () => {
    const selected = Array.from(smppSelectedCodes).slice(0, MAX_COMPARE);
    const internalCodes = selected.map(c => mapping[c]).filter(Boolean);
    if (internalCodes.length === 0) {
      alert(selected.length === 0
        ? '请先选中至少一只基金'
        : '选中的基金在排排网映射表中未找到对应代码');
      return;
    }
    const url = 'https://dc.simuwang.com/comparison/index.html?id=' + internalCodes.join('%7C');
    window.open(url, '_blank');
  });

  updateCompareBtn();
  tbody.appendChild(actionRow);
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
    const tds = funds.map((f, i) => `<td${style}>${row.render(f, metas[i], i)}</td>`).join('');
    return `<tr>${th}${tds}</tr>`;
  }).join('');

  const smppMapping = await loadSmppMapping();
  renderSmppActionRow(tbody, funds, smppMapping, { onDelete });
}
