import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASKET_DROP_DIAMETER, insideDropCircle, detailDropCode } from './fund-drop.js';
test('basket accepts the expanded annulus and rejects points outside the drawn circle', () => {
  const box={left:10,top:20,width:BASKET_DROP_DIAMETER,height:BASKET_DROP_DIAMETER};
  assert.equal(BASKET_DROP_DIAMETER,260);
  assert.ok(insideDropCircle(250,150,box));
  assert.ok(insideDropCircle(140,280,box));
  assert.ok(!insideDropCircle(271,150,box));
  assert.ok(!insideDropCircle(10,20,box));
});
test('detail drops can select only a valid code from the dragged snapshot', () => {
  const items=[{code:'004685'},{code:'001564'}];
  assert.equal(detailDropCode('fund:001564',items),'001564');
  for(const mode of ['fund:999999','fund:001564/extra','fund:bad','add',null])assert.equal(detailDropCode(mode,items),null);
});
