import { getFeeApiBase } from '../../data/fund-api.js';
import { morningstarChartOption } from './morningstar-charts.js';

const fmt = v => v == null ? '—' : `${Number(v).toFixed(2)}%`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createMorningstarHistory(root) {
  let request = null, charts = [], resizeObserver = null, periods = [];
  const theme = new MutationObserver(() => draw());
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  function dispose() {
    request?.abort(); request = null;
    resizeObserver?.disconnect(); resizeObserver = null;
    charts.forEach(c => c.dispose()); charts = []; periods = [];
    root.replaceChildren();
  }
  function draw() {
    const css = getComputedStyle(document.documentElement);
    const colors = { text: css.getPropertyValue('--text-secondary').trim(), grid: css.getPropertyValue('--border').trim() };
    charts.forEach((chart, i) => chart.setOption(morningstarChartOption(periods, i ? 'turnover' : 'fee', colors), true));
  }
  async function load(code) {
    dispose();
    if (!code) return;
    const current = new AbortController(); request = current;
    root.innerHTML = '<div class="fd-card"><h3 class="fd-card-title">晨星 · 历史参考</h3><p role="status">正在加载晨星历史数据…</p></div>';
    try {
      const base = getFeeApiBase();
      if (!base) throw new Error('晨星历史需要连接数据 API');
      const res = await fetch(`${base.replace(/\/$/, '')}/${code}/morningstar`, { signal: current.signal });
      if (!res.ok) throw new Error(`接口返回 ${res.status}`);
      const data = await res.json();
      if (request !== current) return;
      periods = data.periods || [];
      const available = periods.filter(p => p.available);
      if (!available.length) {
        root.innerHTML = '<div class="fd-card"><h3 class="fd-card-title">晨星 · 历史参考</h3><p class="fd-nav-hint">本地晨星快照暂未收录此基金。缺失数据不以零值代替。</p></div>';
        return;
      }
      const latest = available.at(-1);
      const metric = (label, value, detail) => `<div class="fd-ms-metric"><span>${label}</span><strong>${fmt(value)}</strong><small>${detail}</small></div>`;
      root.innerHTML = `<div class="fd-card fd-ms-intro">
        <div class="fd-card-header"><h3 class="fd-card-title">晨星 · 历史参考</h3><a class="fd-peer-link" href="https://www.morningstar.cn/fund/${code}.html" target="_blank" rel="noopener noreferrer">晨星基金页 ↗</a></div>
        <p class="fd-nav-hint">${esc(latest.name)} · ${esc(latest.morningstar_category || '分类缺失')} · 最新收录 ${esc(latest.as_of_date)} · ${available.length} / ${periods.length} 期有记录</p>
        <div class="fd-ms-metrics">
          ${metric('综合费率', latest.total_fee_pct, `显性 ${fmt(latest.explicit_fee_pct)} + 隐性 ${fmt(latest.implicit_fee_pct)}`)}
          ${metric('综合费率同类排名', latest.total_fee_rank_pct, '晨星提供的排名百分比')}
          ${metric('换手率', latest.turnover_pct, `晨星同类中值 ${fmt(latest.category_median_turnover_pct)}`)}
          ${metric('换手率同类百分位', latest.turnover.percentile, `本地计算 · ${latest.turnover.sampleSize} 个有效份额样本`)}
        </div>
        <p class="fd-nav-hint">显性费率来自各快照所记录的招募说明书；隐性费率为晨星据定期报告估算的交易成本及其他费用，仅供参考，不替代上方现行费率。半年快照不是逐日数据，不做插值补齐。</p>
      </div>
      <div class="fd-card">
        <h3 class="fd-card-title">费率历史</h3>
        <p class="fd-nav-hint">每期柱状图堆叠显性与隐性费率，柱高为两者合计；悬停可查看各项费率、晨星综合费率原值与同类排名。</p>
        <div class="fd-ms-chart" data-ms-chart="fee" role="img" aria-label="晨星显性与隐性费率堆叠柱状图，下方为同类排名百分比；数值见下方历史明细"></div>
      </div>
      <div class="fd-card">
        <h3 class="fd-card-title">换手率历史</h3>
        <p class="fd-nav-hint">左轴：换手率实线、同类中值虚线；右轴：同类百分位面积（0–100%），无边界折线。</p>
        <div class="fd-ms-chart" data-ms-chart="turnover" role="img" aria-label="双轴合并图：换手率及同类中值折线使用左轴，百分位无边线面积使用右轴；数值见下方历史明细"></div>
        <p class="fd-nav-hint">百分位越高，换手越高，不代表业绩更好。同一报告期、同一晨星分类内，按基金代码（不同份额分别计数）比较有效换手率；缺失或负值排除，样本少于 2 个不计算。${esc(data.percentileMethod)}。分类按每期记录确定，不用当前分类回填历史。</p>
      </div>
      <details class="fd-card fd-ms-detail"><summary>历史明细与来源 · ${periods.length} 期</summary>
        <div class="fd-ms-table-wrap"><table class="fd-table"><thead><tr><th>截至日期</th><th>晨星分类</th><th>显性费率 / 排名</th><th>隐性费率 / 排名</th><th>综合费率 / 排名</th><th>换手率 / 中值</th><th>换手百分位 / 样本</th><th>来源文件</th></tr></thead><tbody>${periods.map(p => `<tr>
          <td>${esc(p.as_of_date)}</td><td>${esc(p.morningstar_category || (p.available ? '分类缺失' : '未收录'))}</td>
          <td>${fmt(p.explicit_fee_pct)} / ${fmt(p.explicit_fee_rank_pct)}</td><td>${fmt(p.implicit_fee_pct)} / ${fmt(p.implicit_fee_rank_pct)}</td><td>${fmt(p.total_fee_pct)} / ${fmt(p.total_fee_rank_pct)}</td>
          <td>${fmt(p.turnover_pct)} / ${fmt(p.category_median_turnover_pct)}</td><td>${fmt(p.turnover.percentile)} / ${p.turnover.sampleSize}</td><td>${esc(p.source_file)}</td></tr>`).join('')}</tbody></table></div>
        <p class="fd-nav-hint">来源：Morningstar 晨星综合费率历史快照。费率排名使用晨星原值，未重新计算；换手百分位为本站计算，并非晨星官方排名。各期费率四舍五入可能产生加总差异。</p>
      </details>`;
      const containers = [...root.querySelectorAll('[data-ms-chart]')];
      if (!window.echarts) {
        containers.forEach(el => { el.textContent = '图表组件未加载，请展开下方历史明细查看数据。'; });
        return;
      }
      charts = containers.map(el => window.echarts.init(el));
      draw();
      resizeObserver = new ResizeObserver(() => charts.forEach(c => { if (c.getDom().clientWidth) c.resize(); }));
      containers.forEach(el => resizeObserver.observe(el));
    } catch (err) {
      if (request !== current || current.signal.aborted) return;
      root.innerHTML = `<div class="fd-card"><h3 class="fd-card-title">晨星 · 历史参考</h3><p role="status">加载失败：${esc(err.message)}</p><button class="btn btn-sm btn-secondary" type="button">重试</button></div>`;
      root.querySelector('button').addEventListener('click', () => load(code));
    }
  }
  return { load, dispose, destroy() { dispose(); theme.disconnect(); } };
}
