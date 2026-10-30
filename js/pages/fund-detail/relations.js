import { fetchFundRelations, fetchFofHoldings, resolveFundMaster } from '../../data/fund-relations-api.js';
import { escapeHtml } from '../../utils/format.js';
import { fundDragAttrs, fundDragHandle } from '../../core/fund-transfer.js';

const esc = escapeHtml;
const external = code => `https://fund.eastmoney.com/${code}.html`;
function fundLink(row) {
  return row.available
    ? `<a class="fd-peer-link" href="#/fund/${row.code}">${esc(row.name || row.code)}</a>`
    : `<a class="fd-peer-link" href="${external(row.code)}" target="_blank" rel="noopener noreferrer">${esc(row.name || row.code)} ↗</a>`;
}
function table(rows, code, kind) {
  return `<div class="fd-relations-table-wrap"><table class="fd-table"><thead><tr><th>基金</th><th>${kind === 'holdings' ? '持仓占比' : '关系'}</th><th>跳转</th></tr></thead><tbody>${rows.map(row => `<tr ${row.available ? fundDragAttrs(row) : ''}>
    <td>${row.available ? fundDragHandle() : ''}${fundLink(row)}<small class="fd-related-code">${row.code}</small></td>
    <td>${kind === 'holdings' ? `${Number(row.weightPct).toFixed(2)}%` : kind === 'shares' ? esc(row.shareClass ? `${row.shareClass} 类份额` : '其他份额') : row.relation === 'master' ? '联接母基金' : '联接基金'}</td>
    <td>${row.available ? `<a class="fd-peer-link" href="#/compare/${code},${row.code}">对比</a>` : '<span class="fd-nav-hint">来源详情 ↗</span>'}</td>
  </tr>`).join('')}</tbody></table></div>`;
}

function feederGroup(data, code, loading = false) {
  const rows = data.feederFunds.filter(row => !data.shareClasses.some(share => share.code === row.code));
  const lookup = data.masterLookup;
  const source = lookup ? `<p class="fd-nav-hint"><a href="${external(code)}" target="_blank" rel="noopener noreferrer">天天基金明确关联 ↗</a>${lookup.fetchedAt ? ` · 查询时间 ${esc(new Date(lookup.fetchedAt).toLocaleString('zh-CN'))}` : ''}</p>` : '';
  const missing = data.masterMissing ? (loading ? '<p class="fd-nav-hint" role="status">正在核验目标 ETF…</p>'
    : `<p class="fd-nav-hint">${lookup?.status === 'unavailable' ? '来源未提供明确的目标 ETF 链接。' : lookup ? '目标 ETF 关联暂时查询失败。' : '尚未收录该联接基金的母基金代码映射。'}</p><button type="button" class="btn btn-sm btn-secondary" data-retry-master>重试母基金查询</button>`) : '';
  return `<h4>联接基金与母基金</h4>${rows.length ? table(rows, code, 'feeder') : ''}${missing}${source}<p class="fd-nav-hint">${esc(data.feederBasis || '')}${lookup?.status === 'available' ? ' 母基金来自来源页明确的“查看相关ETF”链接。' : ''}</p>`;
}

export function createFundRelations(container, { fetchRelations = fetchFundRelations, fetchHoldings = fetchFofHoldings,
  resolveMaster = resolveFundMaster } = {}) {
  let version = 0;
  let currentCode = '';
  let holdingsVersion = 0;
  let masterVersion = 0;
  let currentRelations;
  const holdingsSection = data => `<section class="fd-related-group"><h4>FOF 披露的持仓基金</h4><div data-fof-holdings>${data}</div></section>`;

  async function loadMaster(code, loadVersion) {
    const requestVersion = ++masterVersion;
    const target = container.querySelector('[data-feeder-relations]');
    if (!target || !currentRelations) return;
    target.innerHTML = feederGroup(currentRelations, code, true);
    try {
      const data = await resolveMaster(code);
      if (version !== loadVersion || requestVersion !== masterVersion) return;
      currentRelations = data;
      target.innerHTML = feederGroup(data, code);
    } catch {
      if (version !== loadVersion || requestVersion !== masterVersion) return;
      target.innerHTML = feederGroup({ ...currentRelations, masterLookup: { status: 'error' } }, code);
    }
  }

  async function loadHoldings(code, loadVersion) {
    const requestVersion = ++holdingsVersion;
    const target = container.querySelector('[data-fof-holdings]');
    if (!target) return;
    target.innerHTML = '<p class="fd-nav-hint" role="status">正在读取最近披露的前十持仓…</p>';
    try {
      const data = await fetchHoldings(code);
      if (version !== loadVersion || requestVersion !== holdingsVersion) return;
      const source = `<a href="${external(code)}" target="_blank" rel="noopener noreferrer">天天基金来源页 ↗</a>`;
      if (data.status !== 'available') {
        const message = data.status === 'busy' ? '持仓查询繁忙，请稍后重试。' : data.status === 'unavailable' ? '来源暂未提供可识别的基金持仓。' : '持仓暂时加载失败。';
        target.innerHTML = `<p class="fd-nav-hint">${message} ${source}</p><button class="btn btn-sm btn-secondary" type="button" data-retry-holdings>重试持仓</button>`;
        return;
      }
      target.innerHTML = `<p class="fd-nav-hint">持仓截至 ${esc(data.asOfDate)} · ${esc(data.source)} · ${source}</p>${table(data.rows, code, 'holdings')}
        <p class="fd-nav-hint">仅展示来源披露的前十基金持仓，不代表完整组合或当前实时持仓。占比为来源原值；库内无场外档案的基金打开来源详情。</p>`;
    } catch {
      if (version !== loadVersion || requestVersion !== holdingsVersion) return;
      target.innerHTML = '<p class="fd-nav-hint">持仓暂时加载失败。</p><button class="btn btn-sm btn-secondary" type="button" data-retry-holdings>重试持仓</button>';
    }
  }

  async function load(code) {
    const loadVersion = ++version;
    ++holdingsVersion;
    ++masterVersion;
    currentRelations = null;
    currentCode = code;
    container.hidden = !code;
    container.innerHTML = code ? '<h3 class="fd-card-title">相关基金</h3><p class="fd-nav-hint" role="status">加载中…</p>' : '';
    if (!code) return;
    try {
      const data = await fetchRelations(code);
      if (version !== loadVersion) return;
      currentRelations = data;
      const groups = [];
      if (data.shareClasses.length) groups.push(`<section class="fd-related-group"><h4>其他份额</h4>${table(data.shareClasses, code, 'shares')}<p class="fd-nav-hint">${esc(data.shareClassBasis)}</p></section>`);
      const otherFeederFunds = data.feederFunds.filter(row => !data.shareClasses.some(share => share.code === row.code));
      if (otherFeederFunds.length || data.isFeeder) groups.push(`<section class="fd-related-group" data-feeder-relations>${feederGroup(data, code, data.masterMissing)}</section>`);
      if (data.feederIndexAvailable === false) groups.push('<p class="fd-nav-hint">联接基金索引暂时不可用。</p>');
      if (data.isFof) groups.push(holdingsSection(''));
      container.innerHTML = `<h3 class="fd-card-title">相关基金</h3>${groups.length ? groups.join('') : '<p class="fd-nav-hint">暂无可识别的其他份额或联接关系。</p>'}`;
      if (data.isFof) loadHoldings(code, loadVersion);
      if (data.isFeeder && data.masterMissing) loadMaster(code, loadVersion);
    } catch {
      if (version !== loadVersion) return;
      container.innerHTML = '<h3 class="fd-card-title">相关基金</h3><p class="fd-nav-hint">关联基金暂时加载失败。</p><button class="btn btn-sm btn-secondary" type="button" data-retry-relations>重试</button>';
    }
  }

  container.addEventListener('click', event => {
    if (event.target.closest('[data-retry-relations]')) load(currentCode);
    if (event.target.closest('[data-retry-holdings]')) loadHoldings(currentCode, version);
    if (event.target.closest('[data-retry-master]')) loadMaster(currentCode, version);
  });
  return { load };
}
