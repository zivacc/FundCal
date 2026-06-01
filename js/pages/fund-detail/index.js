/**
 * 基金详情页 (page-fund-detail)
 *
 * 路由: #/fund/<code>  无 code 时显示搜索框。
 * 数据来源: /api/fund/:code (fee), /api/nav/:code (history via compare), /api/fund/stats/detail (peers)
 *
 * 卡片结构: hero / 基础信息 / 费率 / 买入段 / 卖出赎回段 / 阶段业绩 / 净值曲线 / 同指数 / 原始数据
 */

import { createTypeahead } from '../../components/typeahead.js';
import { fetchSearchIndexFromAPI, fetchFundRawFromAPI, fetchStatsDetailFromAPI } from '../../data/fund-api.js';
import { fetchNavCompareCached, periodToRange, pickInterval } from '../../data/nav-api.js';

const els = {};
const state = {
  searchIndex: null,
  currentCode: '',
  currentData: null,
  chart: null,
  rawViewMode: 'table', // 'table' | 'json'
  navPeriod: 'MAX',
};

function $(id) { return document.getElementById(id); }

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

function parseHashCode() {
  const h = (window.location.hash || '').replace(/^#\/?/, '');
  const parts = h.split('/');
  if (parts[0] !== 'fund') return '';
  const code = (parts[1] || '').trim();
  return /^\d{6}$/.test(code) ? code : '';
}

function fmtPct(v, digits = 2) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `${Number(v).toFixed(digits)}%`;
}

function fmtRate(v, digits = 3) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `${Number(v).toFixed(digits)}%`;
}

function fmtText(v) {
  if (v == null || v === '') return '—';
  return String(v);
}

/* ========== 搜索框 ========== */

async function ensureSearchIndex() {
  if (state.searchIndex) return state.searchIndex;
  try {
    state.searchIndex = await fetchSearchIndexFromAPI();
  } catch {
    state.searchIndex = [];
  }
  return state.searchIndex;
}

function setupSearch() {
  const input = $('fd-search-input');
  const dropdown = $('fd-search-dropdown');
  if (!input || !dropdown) return;

  createTypeahead({
    inputEl: input,
    dropdownEl: dropdown,
    search: async (q) => {
      const idx = await ensureSearchIndex();
      const query = q.trim().toLowerCase();
      if (!query) return [];
      const matches = [];
      for (const it of idx) {
        if (!it) continue;
        const code = String(it.code || '');
        const name = String(it.name || '');
        const initials = String(it.initials || '');
        if (
          code.includes(query) ||
          name.toLowerCase().includes(query) ||
          initials.toLowerCase().includes(query)
        ) {
          matches.push(it);
          if (matches.length >= 30) break;
        }
      }
      return matches;
    },
    renderItem: (item) => `
      <span class="fund-search-item-code">${escapeHtml(item.code)}</span>
      <span class="fund-search-item-name">${escapeHtml(item.name || '')}</span>
    `,
    onSelect: (item) => {
      if (item && item.code) {
        window.location.hash = `#/fund/${item.code}`;
      }
    },
    clearOnSelect: true,
  });
}

/* ========== 渲染 ========== */

function renderHero(d) {
  const el = $('fd-card-hero');
  if (!el) return;
  const status = d.tradingStatus || {};
  const sub = status.subscribe || '';
  const red = status.redeem || '';
  const subBadge = sub
    ? `<span class="fd-hero-badge ${/限|暂停|不/.test(sub) ? 'fd-badge-warn' : ''}">申购：${escapeHtml(sub)}</span>`
    : '';
  const redBadge = red
    ? `<span class="fd-hero-badge ${/限|暂停|不/.test(red) ? 'fd-badge-warn' : ''}">赎回：${escapeHtml(red)}</span>`
    : '';
  const typeBadge = d.fundType
    ? `<span class="fd-hero-badge fd-badge-muted">${escapeHtml(d.fundType)}</span>`
    : '';
  el.innerHTML = `
    <span class="fd-hero-code">${escapeHtml(d.code || state.currentCode)}</span>
    <h2 class="fd-hero-name">${escapeHtml(d.name || '未知基金')}</h2>
    <div class="fd-hero-meta">
      ${typeBadge}
      ${subBadge}
      ${redBadge}
      ${d.fundManager ? `<span>${escapeHtml(d.fundManager)}</span>` : ''}
      ${d.establishmentDate ? `<span>成立 ${escapeHtml(d.establishmentDate)}</span>` : ''}
    </div>
  `;
}

function kv(label, value, opts = {}) {
  const cls = ['fd-kv-value'];
  if (opts.num) cls.push('fd-kv-value-num');
  if (opts.strong) cls.push('fd-kv-value-strong');
  return `
    <div class="fd-kv">
      <span class="fd-kv-label">${escapeHtml(label)}</span>
      <span class="${cls.join(' ')}">${value == null ? '—' : value}</span>
    </div>
  `;
}

function renderOverview(d) {
  const el = $('fd-overview-body');
  if (!el) return;
  const scale = d.netAssetScale;
  const scaleText = scale ? (scale.text || scale.amountText || '') : '';
  el.innerHTML = `
    <div class="fd-kv-grid">
      ${kv('基金代码', escapeHtml(d.code || state.currentCode))}
      ${kv('基金类型', escapeHtml(fmtText(d.fundType)))}
      ${kv('基金公司', escapeHtml(fmtText(d.fundManager)))}
      ${kv('成立日期', escapeHtml(fmtText(d.establishmentDate)))}
      ${kv('资产规模', escapeHtml(scaleText || '—') + (scale && scale.asOfDate ? ` <span style="color:var(--text-tertiary);font-size:0.78rem">(${escapeHtml(scale.asOfDate)})</span>` : ''))}
      ${kv('跟踪标的', escapeHtml(fmtText(d.trackingTarget)))}
      ${kv('业绩基准', escapeHtml(fmtText(d.performanceBenchmark)))}
      ${kv('更新时间', escapeHtml(fmtText(d.updatedAt)))}
    </div>
  `;
}

function renderFees(d) {
  const el = $('fd-fees-body');
  if (!el) return;
  const op = d.operationFees || {};
  const floating = d.isFloatingAnnualFee ? '<span class="fd-hero-badge fd-badge-warn" style="margin-left:0.4rem">浮动</span>' : '';
  el.innerHTML = `
    <div class="fd-kv-grid">
      ${kv('买入费率', fmtRate(d.buyFee), { num: true, strong: true })}
      ${kv('年化费率', fmtRate(d.annualFee) + floating, { num: true, strong: true })}
      ${kv('管理费', fmtRate(op.managementFee), { num: true })}
      ${kv('托管费', fmtRate(op.custodyFee), { num: true })}
      ${kv('销售服务费', fmtRate(op.salesServiceFee), { num: true })}
      ${kv('运作费合计', fmtRate(op.total), { num: true })}
    </div>
  `;
}

function renderSegments(elId, segs, kindLabel) {
  const el = $(elId);
  if (!el) return;
  if (!Array.isArray(segs) || !segs.length) {
    el.innerHTML = `<div class="fd-table-empty">无${kindLabel}分段数据</div>`;
    return;
  }
  const rows = segs.map((s, i) => {
    const to = s.to;
    let range;
    if (i === 0) {
      range = to == null ? '全部持有期' : `&lt; ${escapeHtml(to)} 天`;
    } else {
      const prev = segs[i - 1].to;
      range = to == null
        ? `≥ ${escapeHtml(prev)} 天`
        : `${escapeHtml(prev)} – ${escapeHtml(to)} 天`;
    }
    const rate = typeof s.rate === 'number' ? s.rate : Number(s.rate);
    return `
      <tr>
        <td>${range}</td>
        <td class="fd-table-num">${fmtRate(rate)}</td>
      </tr>
    `;
  }).join('');
  el.innerHTML = `
    <table class="fd-table">
      <thead><tr><th>持有期</th><th style="text-align:right">费率</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderBuySegments(d) {
  // buyFeeSegments 可能在 buyFeeSegments / purchaseSegments
  const segs = d.buyFeeSegments || d.purchaseSegments || d.buySegments || [];
  renderSegments('fd-buy-seg-body', segs, '买入');
}

function renderSellSegments(d) {
  const segs = d.sellFeeSegments || d.redeemSegments || [];
  renderSegments('fd-sell-seg-body', segs, '卖出 / 赎回');
}

function renderStages(d) {
  const el = $('fd-stages-body');
  if (!el) return;
  const stages = Array.isArray(d.stageReturns) ? d.stageReturns : [];
  if (!stages.length) {
    el.innerHTML = '<div class="fd-table-empty">无阶段业绩数据</div>';
    return;
  }
  const asOf = d.stageReturnsAsOf ? `<p class="fd-nav-hint">截至 ${escapeHtml(d.stageReturnsAsOf)}</p>` : '';
  const rows = stages.map(s => {
    const pct = s.returnPct;
    const text = s.returnText || (pct == null ? '—' : `${pct.toFixed(2)}%`);
    const cls = pct == null ? '' : (pct >= 0 ? 'fd-stage-pos' : 'fd-stage-neg');
    return `
      <tr>
        <td>${escapeHtml(s.period || '')}</td>
        <td class="fd-table-num ${cls}">${escapeHtml(text)}</td>
      </tr>
    `;
  }).join('');
  el.innerHTML = `
    <table class="fd-table">
      <thead><tr><th>区间</th><th style="text-align:right">涨幅</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${asOf}
  `;
}

/* ── 净值曲线 ── */

function disposeChart() {
  if (state.chart) {
    try { state.chart.dispose(); } catch {}
    state.chart = null;
  }
}

async function renderNavChart(code) {
  const wrap = $('fd-nav-chart');
  const hint = $('fd-nav-hint');
  if (!wrap) return;
  if (!window.echarts) {
    wrap.innerHTML = '<div class="fd-table-empty">echarts 未加载</div>';
    return;
  }
  hint.textContent = '正在加载净值数据...';
  const { start, end } = periodToRange(state.navPeriod);
  const interval = pickInterval(state.navPeriod);
  let data;
  try {
    data = await fetchNavCompareCached({ codes: [code], start, end, interval });
  } catch (err) {
    hint.textContent = `净值加载失败: ${err.message || err}`;
    return;
  }
  const s = data && data.series && data.series[0];
  if (!s || !s.dates || !s.dates.length) {
    disposeChart();
    wrap.innerHTML = '<div class="fd-table-empty">区间内无净值数据</div>';
    hint.textContent = '';
    return;
  }
  // echarts 需要清掉 .fd-table-empty 占位
  if (!wrap.querySelector('canvas') && !state.chart) {
    wrap.innerHTML = '';
  }
  disposeChart();
  state.chart = window.echarts.init(wrap);
  const navs = s.navs || [];
  const adjNavs = s.adjNavs || [];
  state.chart.setOption({
    grid: { left: 50, right: 20, top: 20, bottom: 40 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: { data: ['单位净值', '复权净值'], bottom: 0 },
    xAxis: { type: 'category', data: s.dates, boundaryGap: false },
    yAxis: { type: 'value', scale: true, axisLabel: { formatter: (v) => Number(v).toFixed(3) } },
    dataZoom: [{ type: 'inside' }],
    series: [
      { name: '单位净值', type: 'line', data: navs, showSymbol: false, smooth: false, lineStyle: { width: 1.5 } },
      { name: '复权净值', type: 'line', data: adjNavs, showSymbol: false, smooth: false, lineStyle: { width: 1.5, type: 'dashed' } },
    ],
  });
  hint.textContent = `共 ${s.dates.length} 个交易日 · ${s.dates[0]} → ${s.dates[s.dates.length - 1]}`;
}

function setupNavPeriodSwitch() {
  const group = $('fd-nav-period-group');
  if (!group) return;
  group.addEventListener('click', (e) => {
    const btn = e.target instanceof HTMLElement ? e.target.closest('.fd-nav-period-btn') : null;
    if (!btn) return;
    const p = btn.getAttribute('data-period') || 'MAX';
    if (p === state.navPeriod) return;
    state.navPeriod = p;
    group.querySelectorAll('.fd-nav-period-btn').forEach(b => b.classList.toggle('fd-nav-period-btn-active', b === btn));
    if (state.currentCode) renderNavChart(state.currentCode);
  });
}

/* ── 同跟踪标的基金 ── */

async function renderPeers(d) {
  const el = $('fd-peers-body');
  if (!el) return;
  const target = d.trackingTarget;
  if (!target) {
    el.innerHTML = '<div class="fd-table-empty">该基金未标注跟踪标的</div>';
    return;
  }
  el.innerHTML = '<div class="fd-table-empty">加载中…</div>';
  const list = await fetchStatsDetailFromAPI('tracking', target);
  if (!list || !list.length) {
    el.innerHTML = `<div class="fd-table-empty">未找到同跟踪「${escapeHtml(target)}」的其他基金</div>`;
    return;
  }
  const me = state.currentCode;
  const others = list.filter(it => it.code !== me).slice(0, 50);
  if (!others.length) {
    el.innerHTML = `<div class="fd-table-empty">同跟踪「${escapeHtml(target)}」目前仅本基金一只</div>`;
    return;
  }
  const rows = others.map(it => `
    <tr>
      <td><a class="fd-peer-link" href="#/fund/${escapeHtml(it.code)}">${escapeHtml(it.code)}</a></td>
      <td>${escapeHtml(it.name || '')}</td>
      <td>${escapeHtml(it.fundManager || '')}</td>
    </tr>
  `).join('');
  el.innerHTML = `
    <table class="fd-table">
      <thead><tr><th>代码</th><th>名称</th><th>基金公司</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="fd-nav-hint">${others.length === 50 ? '仅显示前 50 条' : `共 ${others.length} 只`} · 跟踪「${escapeHtml(target)}」</p>
  `;
}

/* ── 原始数据 ── */

function renderRawAsTable(detail) {
  const seen = new Set();
  function val(v) {
    if (v == null) return '';
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') return escapeHtml(String(v));
    if (t === 'object') {
      if (seen.has(v)) return '<span style="color:var(--text-tertiary)">[Circular]</span>';
      seen.add(v);
      const html = Array.isArray(v) ? arr(v) : obj(v);
      seen.delete(v);
      return html;
    }
    return escapeHtml(String(v));
  }
  function obj(o) {
    const entries = Object.entries(o);
    if (!entries.length) return '<span style="color:var(--text-tertiary)">{}</span>';
    return `<table class="modal-json-table-inner modal-json-table-inner-nested"><tbody>${
      entries.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${val(v)}</td></tr>`).join('')
    }</tbody></table>`;
  }
  function arr(a) {
    if (!a.length) return '<span style="color:var(--text-tertiary)">[]</span>';
    return `<table class="modal-json-table-inner modal-json-table-inner-nested"><tbody>${
      a.map((v, i) => `<tr><th>[${i}]</th><td>${val(v)}</td></tr>`).join('')
    }</tbody></table>`;
  }
  return obj(detail);
}

function renderRaw(d) {
  const el = $('fd-raw-body');
  if (!el) return;
  if (state.rawViewMode === 'json') {
    el.innerHTML = `<pre style="margin:0;white-space:pre-wrap">${escapeHtml(JSON.stringify(d, null, 2))}</pre>`;
  } else {
    el.innerHTML = renderRawAsTable(d);
  }
}

function setupRawActions() {
  const toggleBtn = $('fd-raw-toggle-view');
  const collapseBtn = $('fd-raw-collapse');
  const card = $('fd-card-raw');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      state.rawViewMode = state.rawViewMode === 'json' ? 'table' : 'json';
      toggleBtn.textContent = state.rawViewMode === 'json' ? '转为表格' : '查看 JSON';
      if (state.currentData) renderRaw(state.currentData);
    });
  }
  if (collapseBtn && card) {
    collapseBtn.addEventListener('click', () => {
      const collapsed = card.classList.toggle('fd-collapsed');
      collapseBtn.textContent = collapsed ? '展开' : '折叠';
    });
  }
}

/* ========== 主加载流程 ========== */

async function loadFund(code) {
  if (!code) {
    $('fd-empty').hidden = false;
    $('fd-content').hidden = true;
    disposeChart();
    state.currentCode = '';
    state.currentData = null;
    return;
  }
  state.currentCode = code;
  $('fd-empty').hidden = true;
  $('fd-content').hidden = false;

  // 占位
  $('fd-card-hero').innerHTML = `<span class="fd-hero-code">${escapeHtml(code)}</span><h2 class="fd-hero-name">加载中…</h2>`;
  ['fd-overview-body', 'fd-fees-body', 'fd-buy-seg-body', 'fd-sell-seg-body', 'fd-stages-body', 'fd-peers-body', 'fd-raw-body']
    .forEach(id => { const e = $(id); if (e) e.innerHTML = '<div class="fd-table-empty">加载中…</div>'; });

  let data;
  try {
    data = await fetchFundRawFromAPI(code);
  } catch (err) {
    $('fd-card-hero').innerHTML = `<h2 class="fd-hero-name">加载失败: ${escapeHtml(err.message || String(err))}</h2>`;
    return;
  }
  if (!data) {
    $('fd-card-hero').innerHTML = `<span class="fd-hero-code">${escapeHtml(code)}</span><h2 class="fd-hero-name">未找到该基金</h2>`;
    return;
  }
  state.currentData = data;

  renderHero(data);
  renderOverview(data);
  renderFees(data);
  renderBuySegments(data);
  renderSellSegments(data);
  renderStages(data);
  renderRaw(data);

  // 异步：净值 + peers 不阻塞主信息
  renderNavChart(code);
  renderPeers(data);
}

function onHashChange() {
  // 仅当当前确实在 fund 路由时响应
  const hash = window.location.hash || '';
  if (!hash.startsWith('#/fund')) return;
  const code = parseHashCode();
  if (code !== state.currentCode) loadFund(code);
}

let initialized = false;

export function pageInit() {
  if (initialized) return;
  initialized = true;
  setupSearch();
  setupNavPeriodSwitch();
  setupRawActions();
  window.addEventListener('hashchange', onHashChange);
  const code = parseHashCode();
  loadFund(code);
}
