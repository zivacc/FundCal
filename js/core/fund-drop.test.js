import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailDropCode } from './fund-drop.js';
test('detail drops can select only a valid code from the dragged snapshot', () => {
  const items=[{code:'004685'},{code:'001564'}];
  assert.equal(detailDropCode('fund:001564',items),'001564');
  for(const mode of ['fund:999999','fund:001564/extra','fund:bad','add',null])assert.equal(detailDropCode(mode,items),null);
});
