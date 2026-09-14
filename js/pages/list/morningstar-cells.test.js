import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMorningstarCells } from './morningstar-cells.js';

test('Morningstar list cells preserve percent units, zero and source date', () => {
  const html = renderMorningstarCells({ implicitFeePct: 0, totalFeePct: 2.45, asOfDate: '2025-12-31' });
  assert.match(html, />0.00%</);
  assert.match(html, />2.45%</);
  assert.match(html, />2025-12-31</);
  assert.equal((html.match(/<td /g) || []).length, 3);
});
test('missing Morningstar data is never zero and source text cannot inject HTML', () => {
  for (const reference of [null, undefined, { implicitFeePct: NaN, totalFeePct: null, asOfDate: '<img src=x>' }]) {
    const html = renderMorningstarCells(reference);
    assert.equal((html.match(/>—</g) || []).length, 3);
    assert.ok(!html.includes('<img'));
  }
});
