import test from 'node:test';
import assert from 'node:assert/strict';
import { createListSelection } from './selection.js';

const rows = ['A', 'B', 'C', 'D', 'E'].map(code => ({ code, name: `基金${code}` }));
function setup() {
  const selected = new Map();
  const model = createListSelection(selected);
  return { selected, model, select: (code, options) => model.select(rows, code, options),
    codes: () => [...selected.keys()] };
}

test('plain click replaces; Ctrl and Command toggle independent rows and retain names', () => {
  const s = setup();
  s.select('A'); s.select('C', { ctrlKey: true }); s.select('E', { metaKey: true });
  assert.deepEqual(s.codes(), ['A', 'C', 'E']);
  assert.equal(s.selected.get('C'), '基金C');
  s.select('C', { metaKey: true });
  assert.deepEqual(s.codes(), ['A', 'E']);
  s.select('B'); s.select('B');
  assert.deepEqual(s.codes(), ['B']);
});

test('Shift extends, shrinks and crosses its fixed anchor in current display order', () => {
  const s = setup(); s.select('C');
  s.select('E', { shiftKey: true }); assert.deepEqual(s.codes(), ['C', 'D', 'E']);
  s.select('D', { shiftKey: true }); assert.deepEqual(s.codes(), ['C', 'D']);
  s.select('A', { shiftKey: true }); assert.deepEqual(s.codes(), ['A', 'B', 'C']);
});

test('modifier + Shift preserves baseline selections while resizing a range', () => {
  const s = setup(); s.selected.set('outside-page', '其他页');
  s.select('B', { ctrlKey: true });
  s.select('E', { ctrlKey: true, shiftKey: true });
  assert.deepEqual(s.codes(), ['outside-page', 'B', 'C', 'D', 'E']);
  s.select('C', { metaKey: true, shiftKey: true });
  assert.deepEqual(s.codes(), ['outside-page', 'B', 'C']);
});

test('page/sort/filter refresh clears anchor but retains selection; first Shift starts a new anchor', () => {
  const s = setup(); s.select('A'); s.model.resetAnchor();
  assert.deepEqual(s.codes(), ['A']);
  s.select('E', { shiftKey: true, ctrlKey: true });
  assert.deepEqual(s.codes(), ['A', 'E']);
  s.select('D', { shiftKey: true }); assert.deepEqual(s.codes(), ['D', 'E']);
  s.model.resetAnchor();
  s.model.select([...rows].reverse(), 'D');
  s.model.select([...rows].reverse(), 'B', { shiftKey: true });
  assert.deepEqual(s.codes(), ['D', 'C', 'B']);
});

test('touch/keyboard toggle works; unavailable rows are excluded from clicks and ranges', () => {
  const s = setup(); s.select('A', { toggle: true }); s.select('E', { toggle: true });
  assert.deepEqual(s.codes(), ['A', 'E']);
  s.select('E', { toggle: true }); assert.deepEqual(s.codes(), ['A']);
  const incomplete = rows.map(r => ({ ...r, needsCrawl: r.code === 'C' }));
  s.model.select(incomplete, 'A');
  assert.equal(s.model.select(incomplete, 'C'), false);
  assert.equal(s.model.select(incomplete, 'missing'), false);
  s.model.select(incomplete, 'E', { shiftKey: true });
  assert.deepEqual(s.codes(), ['A', 'B', 'D', 'E']);
});
