import { escapeFundAttribute as escapeHtml } from '../../core/fund-transfer.js';
import { dateLabel, percentLabel, sourceLabel } from './presentation.js';

const unavailable = {
  no_current_snapshot: '暂无完整成分权重，无法推算。',
  no_previous_same_source: '当前只有一期可用快照；需要同一指数、同一来源至少两期完整权重。',
  unverified_effective_date: '当前来源的权重生效日期尚未独立核验，暂不据此推算换手率。',
  incompatible_snapshots: '两期快照的指数代码或来源不一致，无法比较。',
  invalid_dates: '两期快照日期无法形成有效区间。',
  invalid_weights: '两期权重未通过完整性校验，无法推算。',
};
const conventionLabel = value => ({ one_way: '单边', two_way: '双边', provider_defined: '提供方口径' })[value] || '口径未标明';

export function turnoverHtml(turnover = {}) {
  const disclosed = turnover.disclosed;
  const estimate = turnover.estimate;
  const available = estimate?.status === 'available' && Number.isFinite(estimate.valuePct);
  return `<h2 id="id-turnover-title">指数调仓换手率</h2>
    <div class="id-turnover-grid">
      <article><h3>实际披露</h3><strong class="id-turnover-value">${percentLabel(disclosed?.valuePct)}</strong>
        ${disclosed ? `<p class="id-hint">${escapeHtml(dateLabel(disclosed.periodStart))} 至 ${escapeHtml(dateLabel(disclosed.periodEnd))} · ${conventionLabel(disclosed.convention)} · ${disclosed.annualized ? '来源年化值' : '区间值'}<br>
          ${escapeHtml(disclosed.definition)}<br><a href="${escapeHtml(disclosed.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(disclosed.source)}</a> · 披露于 ${escapeHtml(dateLabel(disclosed.publishedAt))}</p>`
          : '<p class="id-hint">暂无已核验的指数换手披露；不以跟踪基金换手率代替。</p>'}</article>
      <article><h3>快照推算 <span class="id-count">未扣除价格漂移</span></h3><strong class="id-turnover-value">${available ? percentLabel(estimate.valuePct) : '—'}</strong>
        <p class="id-hint">${available ? `${escapeHtml(dateLabel(estimate.from.asOfDate))} 至 ${escapeHtml(dateLabel(estimate.to.asOfDate))} · ${escapeHtml(sourceLabel(estimate.source))}<br>
          单边权重变化 · 区间值，未年化<br>新增 ${estimate.addedCount} / 移除 ${estimate.removedCount} 个成分；原始权重合计 ${percentLabel(estimate.from.weightSumPct)} → ${percentLabel(estimate.to.weightSumPct)}`
          : unavailable[estimate?.reason] || '暂无可比较的完整权重快照。'}</p></article>
    </div>
    <details class="id-turnover-method"><summary>计算口径与数据要求</summary>
      <p class="id-hint">快照推算 = ½ × Σ |本期权重 − 上期权重|，仅在两期完整名单内将新增、移除成分的另一侧权重视为零；不归一化原始权重。使用下方所选快照及此前最近一期同来源快照，不跨指数或来源拼接。</p>
      <p class="id-hint">这衡量两期之间的权重差异，包含价格、汇率、公司行为与舍入影响，也无法还原区间内多次调仓；不能当作实际交易换手率。实际指数调仓换手需同一估值时点的调整前后权重，剔除价格漂移。此处不表示成分证券的市场成交换手率。</p>
      <p class="id-hint">口径参考：<a href="https://www.spglobal.com/spdji/en/documents/methodologies/methodology-index-math.pdf" target="_blank" rel="noopener noreferrer">S&amp;P 指数数学方法 · Index Turnover</a>。指数本身不收取基金管理、托管或申赎费；跟踪产品的费率见下方基金及其详情。</p>
    </details>`;
}
