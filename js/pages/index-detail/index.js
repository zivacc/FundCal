import { createTypeahead } from '../../components/typeahead.js';
import { fetchIndexDetailSearch, fetchIndexDetail } from '../../data/index-api.js';
import { fetchNavCompare, periodToRange } from '../../data/nav-api.js';
import { filterSearchIndex } from '../../utils/search.js';
import { escapeHtml } from '../../utils/format.js';
import { indexDetailHref } from '../../utils/index-links.js';
import { getChartTheme, cssVar } from '../../core/theme.js';
import { fundDragAttrs, fundDragHandle, registerFundSource, notifyFundSelection, escapeFundAttribute } from '../../core/fund-transfer.js';
import { basket } from '../../data/basket.js';
import { parseIndexRoute, dateLabel, numberLabel, percentLabel, sourceLabel, returnLabel,
  tableRows, pageRows, weightSummary, snapshotWarning } from './presentation.js';

const $ = id => document.getElementById(`id-${id}`);
const state = { code: '', data: null, selected: new Set(), fundPage: 1, weightPage: 1, period: 'MAX',
  series: null, chart: null, controller: null, version: 0, snapshotVersion: 0, snapshotController: null };
let resizeFrame = 0;

function status(message, retry = false) {
  $('status').hidden = false;
  $('status').innerHTML = `<p>${escapeHtml(message)}</p>${retry ? '<button type="button" class="btn btn-sm btn-secondary" id="id-retry">重新加载</button>' : !state.code ?
    '<div class="id-actions"><a class="btn btn-sm btn-secondary" href="#/index-detail/399300.SZ">沪深300</a><a class="btn btn-sm btn-secondary" href="#/index-detail/399006.SZ">创业板指</a><a class="btn btn-sm btn-secondary" href="#/index-detail/HSI.HI">恒生指数</a></div>' : ''}`;
  $('retry')?.addEventListener('click', () => loadIndex(state.code));
}

function setupSearch() {
  createTypeahead({ inputEl: $('search-input'), dropdownEl: $('search-dropdown'),
    preload: fetchIndexDetailSearch,
    search: async query => filterSearchIndex(await fetchIndexDetailSearch(), query, { limit: 30, kinds: ['index'] }),
    renderItem: item => `<span class="fund-search-item-code">${escapeHtml(item.code)}</span><span class="fund-search-item-name">${escapeHtml(item.name)}</span>`,
    onSelect: item => { window.location.hash = indexDetailHref(item.code); }, clearOnSelect: true,
  });
  $('search-input').disabled = false;
}

function renderInfo() {
  const { index: index, quote, history, returnLinks } = state.data;
  $('hero').innerHTML = `<div><span class="id-hero-code">${escapeHtml(index.ts_code)}</span>
    <h2>${escapeHtml(index.name || index.ts_code)}</h2><div class="id-hero-meta">
    <span>${escapeHtml(index.publisher || '发行机构未收录')}</span><span>${escapeHtml(returnLabel(index.returnType))}</span>
    ${index.category ? `<span>${escapeHtml(index.category)}</span>` : ''}</div></div>
    <div class="id-quote"><span class="id-hint">库内最新收盘</span><strong>${numberLabel(quote?.close)}</strong>
    <p class="id-hint">${quote ? `${dateLabel(quote.end_date)} · 日涨跌 ${percentLabel(quote.pct_chg)}` : '暂无行情'}<br>${quote ? `来源 ${escapeHtml(sourceLabel(quote.source))}` : ''}</p></div>
    <div class="id-actions"><a class="btn btn-sm btn-secondary" href="#/index">指数选基</a></div>`;
  const fields = [ ['完整名称', index.fullname], ['指数代码', index.ts_code], ['发行机构', index.publisher],
    ['市场', index.market], ['分类', index.category], ['收益口径', returnLabel(index.returnType)],
    ['基日', dateLabel(index.base_date)], ['基点', numberLabel(index.base_point)], ['发布日期', dateLabel(index.list_date)],
    ['加权方法', index.weight_rule], ['资料主源', sourceLabel(index.primary_source)],
    ['行情覆盖', history.count ? `${dateLabel(history.start)} 至 ${dateLabel(history.end)} · ${numberLabel(history.count, 0)} 点` : '暂无行情'] ];
  $('info').innerHTML = fields.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '—')}</dd></div>`).join('');
  $('description').textContent = index.description || '';
  $('description').hidden = !index.description;
  $('return-links').innerHTML = returnLinks.length
    ? '<span>已核验关联版本（分别查询基金与权重）：</span>' + returnLinks.map(link =>
      `<a href="${indexDetailHref(link.code)}">${escapeHtml(link.name)} · ${escapeHtml(link.code)} · ${escapeHtml(returnLabel(link.returnType))}</a>`).join('') : '';
  $('chart-title').textContent = `指数走势 · ${returnLabel(index.returnType)}`;
}

function pagination(el, result, kind) {
  el.innerHTML = `<span>共 ${result.total} 条 · ${result.page} / ${result.pages} 页</span>
    <button type="button" class="btn btn-sm btn-secondary" data-page="${result.page - 1}" ${result.page <= 1 ? 'disabled' : ''}>上一页</button>
    <button type="button" class="btn btn-sm btn-secondary" data-page="${result.page + 1}" ${result.page >= result.pages ? 'disabled' : ''}>下一页</button>`;
  el.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    if (kind === 'fund') { state.fundPage = Number(button.dataset.page); renderFunds(); }
    else { state.weightPage = Number(button.dataset.page); renderWeightTable(); }
  }));
}

function visibleFunds() {
  return pageRows(tableRows(state.data?.trackingFunds || [], $('fund-query').value, $('fund-sort').value), state.fundPage, 20);
}
function updateSelection() {
  const visible = visibleFunds().rows;
  const count = visible.filter(fund => state.selected.has(fund.code)).length;
  $('fund-select-page').checked = visible.length > 0 && count === visible.length;
  $('fund-select-page').indeterminate = count > 0 && count < visible.length;
  $('fund-select-page').disabled = !visible.length;
  $('add-basket').disabled = state.selected.size === 0;
  $('add-basket').textContent = state.selected.size ? `加入篮子（${state.selected.size}）` : '加入篮子';
  notifyFundSelection();
}
function renderFunds() {
  const funds = state.data.trackingFunds;
  $('fund-count').textContent = `(${funds.length})`;
  const result = visibleFunds();
  state.fundPage = result.page;
  $('fund-rows').innerHTML = result.rows.length ? result.rows.map(row => `<tr ${fundDragAttrs(row)}>
    <td><input type="checkbox" data-code="${row.code}" aria-label="选择 ${escapeFundAttribute(row.name)}" ${state.selected.has(row.code) ? 'checked' : ''}></td>
    <td><a class="id-fund-name" href="#/fund/${row.code}">${escapeHtml(row.name)}</a><span class="id-sub id-mono">${row.code}</span></td>
    <td>${escapeHtml(row.fundType || '—')}<span class="id-sub">${escapeHtml(row.management || '—')}</span></td>
    <td class="id-numeric id-mono">${row.annualFee == null ? '—' : percentLabel(row.annualFee * 100)}</td>
    <td>${escapeHtml(({ exact: '精确', fullname: '全名', name: '名称', fuzzy: '模糊', manual: '人工' })[row.matchType] || row.matchType || '—')}</td><td>${fundDragHandle()}</td></tr>`).join('')
    : `<tr><td colspan="6">${funds.length ? '没有匹配的基金' : '暂无该代码的场外跟踪关系；可查看上方已核验关联版本。'}</td></tr>`;
  pagination($('fund-pages'), result, 'fund');
  updateSelection();
}

function renderWeights() {
  const { snapshots, constituents } = state.data;
  const snapshot = constituents.snapshot;
  $('snapshot').innerHTML = snapshots.length ? snapshots.map(s =>
    `<option value="${s.id}" ${s.id === snapshot?.id ? 'selected' : ''}>${dateLabel(s.asOfDate)} · ${escapeHtml(sourceLabel(s.source))} · ${s.count} 成分</option>`).join('')
    : '<option>暂无完整快照</option>';
  $('snapshot').disabled = snapshots.length < 2;
  $('weight-meta').textContent = snapshot
    ? `权重快照标注日期 ${dateLabel(snapshot.asOfDate)} · ${sourceLabel(snapshot.source)} · ${snapshot.count} 个成分 · ${
      ({ official_full_file: '官方完整文件校验', api_full_result: '完整 API 响应及分页终点校验', provider_totals: '提供方汇总与完整明细校验' })[snapshot.validationBasis] || '完整性校验'}。不归一化原始权重；不同版本不借用成分。`
    : '暂无该指数代码的完整成分权重快照，不从前十大持仓、ETF 持仓或关联指数推算。';
  const warning = snapshotWarning(snapshot);
  $('weight-warning').textContent = warning;
  $('weight-warning').hidden = !warning;
  ['weight-summary', 'top-weights', 'weight-controls', 'weight-table-wrap', 'weight-pages'].forEach(id => { $(id).hidden = !snapshot; });
  if (!snapshot) return;
  const summary = weightSummary(constituents.rows);
  $('weight-summary').innerHTML = `<div><span>成分数量</span><strong>${summary.count}</strong></div>
    <div><span>权重合计</span><strong>${percentLabel(summary.total)}</strong></div>
    <div><span>前十合计</span><strong>${percentLabel(summary.top10)}</strong></div>`;
  const maxWeight = summary.top[0]?.weightPct || 1;
  $('top-weights').innerHTML = summary.top.map((row, i) => `<li>
    <span class="id-weight-name" title="${escapeFundAttribute(row.code + ' · ' + row.name)}">${i + 1}. ${escapeHtml(row.name)}</span>
    <span class="id-weight-value">${percentLabel(row.weightPct)}</span>
    <span class="id-weight-bar"><i style="width:${Math.min(100, row.weightPct / maxWeight * 100)}%"></i></span></li>`).join('');
  renderWeightTable();
}

function renderWeightTable() {
  const rows = state.data.constituents.rows;
  const ranks = new Map(rows.map((row, i) => [row.code, i + 1]));
  const result = pageRows(tableRows(rows, $('weight-query').value, $('weight-sort').value), state.weightPage);
  state.weightPage = result.page;
  $('weight-rows').innerHTML = result.rows.length ? result.rows.map(row => `<tr>
    <td class="id-mono">${ranks.get(row.code)}</td><td class="id-mono">${escapeHtml(row.code)}</td>
    <td>${escapeHtml(row.name)}</td><td class="id-numeric id-mono">${percentLabel(row.weightPct)}</td></tr>`).join('')
    : '<tr><td colspan="4">没有匹配的成分</td></tr>';
  pagination($('weight-pages'), result, 'weight');
}

function clearChart(message = '') {
  state.chart?.dispose(); state.chart = null;
  $('chart').hidden = Boolean(message);
  $('chart-hint').textContent = message;
}
function resizeChart() {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    if ($('content').closest('.page')?.classList.contains('active') && $('chart').clientWidth > 0) state.chart?.resize();
  });
}
function renderChart(preserveZoom = false) {
  if (!state.series || !state.data || !$('content').closest('.page')?.classList.contains('active')) return;
  const latest = state.series.dates.at(-1);
  const end = new Date(`${dateLabel(latest)}T00:00:00`);
  const start = state.period === 'MAX' ? '' : periodToRange(state.period, end).start;
  const points = state.series.dates.flatMap((date, i) => date >= start && Number.isFinite(state.series.navs[i])
    ? [[dateLabel(date), state.series.navs[i]]] : []);
  $('periods').querySelectorAll('button[data-period]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.period === state.period)));
  if (!points.length) { clearChart('该范围暂无有效行情'); return; }
  $('chart').hidden = false;
  if (!window.echarts) { clearChart('图表组件未加载，请刷新页面'); return; }
  if (!state.chart) state.chart = window.echarts.init($('chart'));
  const t = getChartTheme();
  const zoom = preserveZoom ? state.chart.getOption().dataZoom?.[0] : null;
  const range = { start: zoom?.start ?? 0, end: zoom?.end ?? 100 };
  state.chart.setOption({ animation: false, textStyle: { color: t.textSecondary },
    grid: { left: 12, right: 24, top: 24, bottom: 70, containLabel: true },
    tooltip: { trigger: 'axis', confine: true, backgroundColor: t.bgElevated, borderColor: t.rule,
      textStyle: { color: t.textPrimary }, valueFormatter: value => numberLabel(value) },
    xAxis: { type: 'category', data: points.map(p => p[0]), boundaryGap: false,
      axisLine: { lineStyle: { color: t.ruleStrong } }, axisTick: { show: false },
      axisLabel: { color: t.textSecondary, hideOverlap: true, formatter: value => value.slice(0, 7), showMaxLabel: true } },
    yAxis: { type: 'value', scale: true, splitNumber: 4, axisLabel: { color: t.textSecondary, formatter: value => numberLabel(value, 0) },
      splitLine: { lineStyle: { color: t.grid } } },
    dataZoom: [ { type: 'inside', ...range, minValueSpan: Math.min(99, points.length - 1), throttle: 32 },
      { type: 'slider', ...range, bottom: 8, height: 24, minValueSpan: Math.min(99, points.length - 1),
        textStyle: { color: t.textSecondary }, borderColor: t.ruleStrong, backgroundColor: t.bgBase,
        fillerColor: cssVar('--accent-subtle'), handleStyle: { color: t.bgElevated, borderColor: t.accent },
        moveHandleStyle: { color: t.accent },
        dataBackground: { lineStyle: { color: t.accent }, areaStyle: { color: t.accent, opacity: .12 } },
        selectedDataBackground: { lineStyle: { color: t.accent }, areaStyle: { color: t.accent, opacity: .12 } } } ],
    series: [{ name: state.data.index.name, type: 'line', data: points.map(p => p[1]), symbol: 'none',
      sampling: 'lttb', lineStyle: { color: t.accent, width: 1.8 }, itemStyle: { color: t.accent } }],
  }, true);
  $('chart').setAttribute('aria-label', `${state.data.index.name}历史点位，${points[0][0]}至${points.at(-1)[0]}，${points.length}点`);
  $('chart-hint').textContent = `${points[0][0]} 至 ${points.at(-1)[0]} · ${points.length} 个库内交易日收盘点位 · ${returnLabel(state.data.index.returnType)}（不做口径转换）。范围按钮以库内最后行情日为终点；滚轮缩放、拖动平移。`;
  resizeChart();
}

async function loadChart(data, version) {
  if (!data.history.count) { clearChart('暂无该指数的历史行情；基础资料、跟踪基金和权重可独立查看。'); return; }
  clearChart('正在加载历史行情…');
  try {
    const result = await fetchNavCompare({ codes: [data.index.ts_code], start: data.history.start, end: data.history.end, interval: 'daily' });
    if (version !== state.version) return;
    state.series = result?.series?.[0] || null;
    if (!state.series?.dates.length) clearChart('暂无历史行情');
    else renderChart();
  } catch {
    if (version === state.version) clearChart('历史行情加载失败，可点击「重新加载」重试。');
  }
}

async function loadIndex(code) {
  const version = ++state.version;
  ++state.snapshotVersion;
  state.controller?.abort(); state.snapshotController?.abort();
  state.controller = new AbortController();
  state.code = code; state.data = null; state.series = null; state.selected.clear();
  $('weight-meta').parentElement.removeAttribute('aria-busy');
  state.fundPage = state.weightPage = 1; state.period = 'MAX';
  $('content').hidden = true; clearChart(); notifyFundSelection();
  if (!code) { status('搜索一只指数，查看资料、跟踪基金和已有权重快照。'); return; }
  status('正在加载指数资料…');
  try {
    const data = await fetchIndexDetail(code, { signal: state.controller.signal });
    if (version !== state.version) return;
    state.data = data; state.code = data.index.ts_code;
    $('fund-query').value = $('weight-query').value = '';
    $('basket-status').textContent = '';
    $('status').hidden = true; $('content').hidden = false;
    renderInfo(); renderFunds(); renderWeights();
    // Independent chart load must not hide available tracking/weight data on failure.
    loadChart(data, version);
  } catch (error) {
    if (version === state.version && error.name !== 'AbortError') status(error.message, true);
  }
}

async function switchSnapshot() {
  const version = ++state.snapshotVersion;
  const indexVersion = state.version;
  state.snapshotController?.abort(); state.snapshotController = new AbortController();
  const previous = state.data.constituents.snapshot?.id;
  const requested = $('snapshot').value;
  $('weight-meta').textContent = '正在加载权重快照…';
  $('weight-meta').parentElement.setAttribute('aria-busy', 'true');
  try {
    const next = await fetchIndexDetail(state.code, { snapshot: requested, signal: state.snapshotController.signal });
    if (version !== state.snapshotVersion || indexVersion !== state.version) return;
    state.data = { ...state.data, snapshots: next.snapshots, constituents: next.constituents };
    state.weightPage = 1; renderWeights();
  } catch (error) {
    if (version !== state.snapshotVersion || indexVersion !== state.version || error.name === 'AbortError') return;
    $('snapshot').value = String(previous);
    renderWeights();
    $('weight-meta').textContent += ` 快照切换失败：${error.message}。保留原快照。`;
  } finally {
    if (version === state.snapshotVersion) $('weight-meta').parentElement.removeAttribute('aria-busy');
  }
}

function onRoute() {
  const code = parseIndexRoute(window.location.hash);
  if (code === null) {
    ++state.version; ++state.snapshotVersion; state.controller?.abort(); state.snapshotController?.abort();
    clearChart(); state.selected.clear(); state.series = null; state.data = null;
    $('weight-meta').parentElement.removeAttribute('aria-busy'); notifyFundSelection();
    if (window.location.hash.startsWith('#/index-detail')) { $('content').hidden = true; status('指数代码无效，请通过搜索选择。'); }
    return;
  }
  loadIndex(code);
}

export function pageInit() {
  setupSearch();
  registerFundSource('index-detail-funds', 'index-detail', () => state.data?.trackingFunds.filter(row => state.selected.has(row.code)) || [], 10);
  $('fund-rows').addEventListener('change', event => {
    const code = event.target.dataset.code;
    if (!code) return;
    if (event.target.checked) state.selected.add(code); else state.selected.delete(code);
    updateSelection();
  });
  $('fund-select-page').addEventListener('change', event => {
    visibleFunds().rows.forEach(row => { if (event.target.checked) state.selected.add(row.code); else state.selected.delete(row.code); });
    renderFunds();
  });
  $('add-basket').addEventListener('click', () => {
    try {
      const count = basket.add(state.data.trackingFunds.filter(row => state.selected.has(row.code)));
      $('basket-status').textContent = count ? `已加入 ${count} 只基金` : '所选基金已在篮子中';
    } catch (error) { $('basket-status').textContent = error.message; }
  });
  ['fund-query', 'fund-sort'].forEach(id => $(id).addEventListener(id.endsWith('query') ? 'input' : 'change', () => { state.fundPage = 1; if (state.data) renderFunds(); }));
  ['weight-query', 'weight-sort'].forEach(id => $(id).addEventListener(id.endsWith('query') ? 'input' : 'change', () => { state.weightPage = 1; if (state.data) renderWeightTable(); }));
  $('snapshot').addEventListener('change', switchSnapshot);
  $('periods').addEventListener('click', event => { if (event.target.dataset.period) { state.period = event.target.dataset.period; renderChart(); } });
  // Chart retry also refreshes the overview watermark without changing database data.
  const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn btn-sm btn-secondary'; retry.textContent = '重新加载';
  retry.addEventListener('click', () => loadIndex(state.code)); $('periods').appendChild(retry);
  new ResizeObserver(resizeChart).observe($('chart'));
  window.addEventListener('fundcal-theme-change', () => renderChart(true));
  window.addEventListener('fundcal-route-ready', event => { if (event.detail.route === 'index-detail') resizeChart(); });
  window.addEventListener('hashchange', onRoute);
  onRoute();
}
