import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureBenchmarkSelection, replaceBenchmarkSelection } from './benchmark-selection.js';
const fund = { code: '000001', name: '基金', kind: 'fund' };
const benchmark = { code: 'HSI.HI', name: '恒生', kind: 'index', isBenchmark: true, color: 'red' };
test('empty and legacy selections always recover one available benchmark', () => {
  for (const items of [[], [fund], Array.from({ length: 10 }, (_, i) => ({ ...fund, code: String(i) }))]) {
    const result = ensureBenchmarkSelection(items, '债券');
    assert.equal(result.filter(item => item.isBenchmark).length, 1);
    assert.equal(result.at(-1).code, '000012.SH');
    assert.equal(result.length, items.length + 1);
  }
});
test('existing benchmark survives restoration and duplicate index is reused', () => {
  assert.deepEqual(ensureBenchmarkSelection([fund, benchmark]), [fund, benchmark]);
  const index = { code: '000300.SH', name: '沪深300', kind: 'index' };
  const result = ensureBenchmarkSelection([fund, index]);
  assert.equal(result.length, 2);
  assert.equal(result.at(-1).isBenchmark, true);
  assert.equal(index.isBenchmark, undefined);
});
test('replacing benchmark merges an existing comparison index and retains color', () => {
  const result = replaceBenchmarkSelection([fund, benchmark, { code: '000905.SH', kind: 'index' }], { tsCode: '000905.SH', label: '中证500' });
  assert.equal(result.length, 2);
  assert.deepEqual(result.at(-1), { code: '000905.SH', name: '中证500', kind: 'index', color: 'red', isBenchmark: true });
});
