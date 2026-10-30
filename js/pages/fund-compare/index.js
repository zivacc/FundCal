import { createTypeahead } from '../../components/typeahead.js';
import { fetchSearchIndexFromAPI } from '../../data/fund-api.js';
import { filterSearchIndex } from '../../utils/search.js';
import { fetchComparisonFund } from '../../data/fund-comparison.js';
import { basket } from '../../data/basket.js';
import { registerFundSource, registerFundReceiver, notifyFundSelection, prepareFundTransfer, fundDragAttrs, fundDragHandle, escapeFundAttribute as esc } from '../../core/fund-transfer.js';
import { comparisonCodes, comparisonHref, comparisonSections, reportDates } from './model.js';
import { indexDetailHref } from '../../utils/index-links.js';

const STORAGE_KEY = 'fundCalComparison';
const state = { codes: [], entries: [], version: 0, period: 'latest', busy: false };
const $ = id => document.getElementById(`fc-${id}`);
const active = () => /^#\/compare(?:\/|$)/.test(location.hash);
const refs = () => state.entries.map(entry => ({ code: entry.code, name: entry.name }));
function status(message) { $('status').textContent = message; }
function save() { try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state.codes)); } catch { /* URL remains usable. */ } }
function restore() {
  try { const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY)); return Array.isArray(value) ? comparisonCodes(value) : []; }
  catch { return []; }
}

function render() {
  const entries = state.entries;
  $('count').textContent = `${entries.length} / 8`;
  $('empty').hidden = entries.length > 0;
  $('content').hidden = !entries.length;
  $('clear').disabled = !entries.length;
  $('calculate').disabled = !entries.length || state.busy || entries.some(entry => !entry.raw || entry.source === 'static' || entry.raw.annualFee == null);
  $('refresh').disabled = !entries.length || state.busy;
  const dates = reportDates(entries);
  if (state.period !== 'latest' && !dates.includes(state.period)) state.period = 'latest';
  $('period').innerHTML = '<option value="latest">各基金最新收录</option>' + dates.map(date => `<option value="${esc(date)}">${esc(date)} · 同一期</option>`).join('');
  $('period').value = state.period;
  $('table').style.setProperty('--fc-columns', String(Math.max(1, entries.length)));
  $('table').innerHTML = `<caption>基金基本资料、费率、换手率及历史业绩对比</caption>
    <colgroup><col class="fc-metric-col">${entries.map(() => '<col>').join('')}</colgroup>
    <thead><tr><th scope="col" class="fc-metric">指标</th>${entries.map(entry => `<th scope="col" ${fundDragAttrs(entry)}>
      ${fundDragHandle()}<div class="fc-fund-heading"><a href="#/fund/${entry.code}"><span>${entry.code}</span><strong>${esc(entry.name)}</strong></a>
      <button type="button" class="fc-remove" data-remove="${entry.code}" aria-label="移除 ${esc(entry.name)}">×</button></div>
      ${(entry.raw?.trackingIndexes || []).map(index => {
        const href = indexDetailHref(index.code);
        return href ? `<a class="fc-index-link" href="${href}">${esc(index.name || index.code)} ↗</a>` : '';
      }).join('')}
      ${entry.errors?.length || entry.warnings?.length ? `<p class="fc-column-status">${esc([...(entry.errors || []), ...(entry.warnings || [])].join('；'))}<button type="button" data-retry="${entry.code}">重试</button></p>` : ''}
    </th>`).join('')}</tr></thead>
    ${comparisonSections(entries).map(section => `<tbody><tr class="fc-section"><th colspan="${entries.length + 1}" scope="colgroup">${esc(section.title)}</th></tr>
      ${section.rows.map(row => `<tr><th scope="row" class="fc-metric">${esc(row.label)}</th>${entries.map(entry => `<td>${esc(row.value(entry, state.period))}</td>`).join('')}</tr>`).join('')}</tbody>`).join('')}`;
  notifyFundSelection();
}

async function loadCodes(codes, { refresh = false } = {}) {
  const version = ++state.version;
  state.codes = codes; state.busy = true;
  state.entries = codes.map(code => state.entries.find(entry => entry.code === code) || { code, name: code });
  save(); render();
  status(codes.length ? '正在读取基金资料与历史参考…' : '搜索基金，或从基金篮子加入，最多比较 8 只。');
  const entries = await prepareFundTransfer(codes.map(code => ({ code })), item => fetchComparisonFund(item.code, { refresh }));
  if (version !== state.version || !active()) return;
  state.entries = entries; state.busy = false;
  render();
  status(entries.some(entry => entry.errors.length || entry.warnings.length) ? '部分资料待核验或加载失败，可在对应基金列重试；其余数据仍可比较。'
    : codes.length ? `已载入 ${codes.length} 只基金。缺失数据以 — 显示；日期与来源见对应行。` : '搜索基金，或从基金篮子加入，最多比较 8 只。');
}

function setCodes(values) {
  try {
    const codes = comparisonCodes(values);
    // Save before navigation so clearing to the bare route does not restore old funds.
    state.codes = codes; save();
    const hash = comparisonHref(codes);
    if (location.hash === hash) void loadCodes(codes);
    else location.hash = hash;
  } catch (error) { status(error.message); }
}

function routeChanged() {
  if (!active()) { ++state.version; state.busy = false; return; }
  const parts = location.hash.split('/');
  try {
    if (parts.length > 3) throw new Error('比较链接格式不正确');
    const codes = parts[2] ? comparisonCodes(parts[2].split(',')) : restore();
    void loadCodes(codes);
  } catch (error) { ++state.version; state.codes = []; state.entries = []; state.busy = false; render(); status(error.message); }
}

export function pageInit() {
  createTypeahead({ inputEl: $('search'), dropdownEl: $('dropdown'), preload: fetchSearchIndexFromAPI,
    search: async query => filterSearchIndex(await fetchSearchIndexFromAPI(), query, { limit: 30, kinds: ['fund'] }),
    renderItem: item => `<span class="fund-search-item-code">${esc(item.code)}</span><span class="fund-search-item-name">${esc(item.name)}</span>`,
    onSelect: item => setCodes([...state.codes, item.code]), clearOnSelect: true,
  });
  $('add-code').addEventListener('click', () => {
    const code = $('search').value.trim();
    if (!/^\d{6}$/.test(code)) { status('输入六位基金代码后添加，或从搜索建议中选择基金。'); return; }
    setCodes([...state.codes, code]); $('search').value = '';
  });
  $('from-basket').addEventListener('click', () => {
    const items = basket.get();
    if (!items.length) { status('基金篮子为空，请先搜索添加基金。'); return; }
    setCodes([...state.codes, ...items.map(item => item.code)]);
  });
  $('clear').addEventListener('click', () => setCodes([]));
  $('refresh').addEventListener('click', () => void loadCodes(state.codes, { refresh: true }));
  $('period').addEventListener('change', event => { state.period = event.target.value; render(); });
  $('table').addEventListener('click', event => {
    const remove = event.target.closest('[data-remove]');
    if (remove) setCodes(state.codes.filter(code => code !== remove.dataset.remove));
    if (event.target.closest('[data-retry]')) void loadCodes(state.codes, { refresh: true });
  });
  $('calculate').addEventListener('click', () => {
    try { sessionStorage.setItem('fundCalCompareFromCache', JSON.stringify({ funds: refs() })); location.hash = '#/calc'; }
    catch { status('浏览器无法保存待比较基金，请通过基金篮子加入计算器。'); }
  });
  registerFundSource('compare', 'compare', refs, 0, false);
  registerFundReceiver('compare', async (items, mode) => {
    const codes = comparisonCodes([...(mode === 'replace' ? [] : state.codes), ...items.map(item => item.code)]);
    const version = state.version;
    const prepared = await prepareFundTransfer(codes.map(code => ({ code })), item => fetchComparisonFund(item.code));
    if (version !== state.version || !active()) throw new Error('比较页面已变化，请重试');
    if (prepared.some(entry => !entry.raw)) throw new Error('部分基金资料暂不可用，当前比较已保留');
    ++state.version; state.codes = codes; state.entries = prepared; state.busy = false; save();
    history.replaceState(null, '', comparisonHref(codes)); render(); status(`已载入 ${codes.length} 只基金。`);
    return items.length;
  });
  window.addEventListener('hashchange', routeChanged);
  routeChanged();
}
