import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planNavBasketTransfer } from './basket-transfer.js';
const benchmark={code:'000300.SH',kind:'index',isBenchmark:true,color:'red'},fund={code:'000001',name:'A',kind:'fund'};
test('NAV add deduplicates and replace always retains benchmark',()=>{
 assert.deepEqual(planNavBasketTransfer([benchmark,fund],[fund],'add'),[benchmark,fund]);
 const result=planNavBasketTransfer([benchmark,fund],[{code:'110011',name:'B'}],'replace');
 assert.equal(result[0],benchmark);assert.deepEqual(result[1],{code:'110011',name:'B',kind:'fund'});
});
test('over-capacity transfers are rejected instead of silently dropping funds',()=>{
 const original=[benchmark,fund];assert.throws(()=>planNavBasketTransfer(original,[{code:'110011'}],'add',2),/最多/);
 assert.deepEqual(original,[benchmark,fund]);
});
