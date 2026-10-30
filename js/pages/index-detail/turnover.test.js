import test from 'node:test';
import assert from 'node:assert/strict';
import { turnoverHtml } from './turnover.js';

test('turnover missing states explain data gaps rather than rendering zero', () => {
  const html = turnoverHtml({ disclosed: null, estimate: { status: 'unavailable', valuePct: null, reason: 'no_previous_same_source' } });
  assert.match(html, /至少两期完整权重/); assert.match(html, /暂无已核验/);
  assert.doesNotMatch(html, /0\.00%/); assert.match(html, /未扣除价格漂移/);
});

test('turnover presentation keeps real zero, time range, units and disclosure attribution', () => {
  const html = turnoverHtml({ disclosed: { valuePct: 0, periodStart: '2026-01-01', periodEnd: '2026-06-30',
    convention: 'two_way', annualized: false, definition: '<script>alert(1)</script>',
    source: '发行机构', sourceUrl: 'https://example.com/report.pdf?x="', publishedAt: '2026-07-01' },
    estimate: { status: 'available', valuePct: 15, source: 'csindex', addedCount: 1, removedCount: 2,
      from: { asOfDate: '2026-06-30', weightSumPct: 100.03 }, to: { asOfDate: '2026-07-31', weightSumPct: 100 } } });
  assert.match(html, /0\.00%/); assert.match(html, /15\.00%/); assert.match(html, /100\.03%/);
  assert.match(html, /双边/); assert.match(html, /未年化/); assert.match(html, /2026-06-30 至 2026-07-31/);
  assert.doesNotMatch(html, /<script>/); assert.match(html, /&quot;/);
});
