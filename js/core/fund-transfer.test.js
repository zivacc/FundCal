import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareFundTransfer, fundDragAttrs, registerFundSource, getPageFundSelection } from './fund-transfer.js';
test('transfer prepares with bounded concurrency, preserves order and rejects missing data',async()=>{
 const refs=Array.from({length:8},(_,i)=>({code:String(i+1).padStart(6,'0')}));let active=0,max=0;
 const values=await prepareFundTransfer(refs,async item=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;return item.code;},3);
 assert.equal(max,3);assert.deepEqual(values,refs.map(x=>x.code));
 await assert.rejects(prepareFundTransfer(refs,async()=>null),/数据加载失败/);
});
test('drag metadata escapes names and rejects nonfund sources',()=>{
 assert.match(fundDragAttrs({code:'000001',name:'a"<b>'}),/a&quot;&lt;b&gt;/);
 assert.equal(fundDragAttrs({code:'000300.SH'}),'');
});

test('explicit column selection wins; a page fund drag stays single without explicit selection', t => {
  const oldWindow = globalThis.window;
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  globalThis.window = { location: { hash: '#/calc' }, dispatchEvent() {} };
  const funds = [{ code: '000001' }, { code: '110011' }];
  let selected = [];
  registerFundSource('test-page', 'calc', () => funds, 0, false);
  registerFundSource('test-columns', 'calc', () => selected, 20);
  assert.equal(getPageFundSelection().length, 2);
  assert.deepEqual(getPageFundSelection(true), []);
  selected = [funds[1]];
  assert.deepEqual(getPageFundSelection(true).map(f => f.code), ['110011']);
  assert.deepEqual(getPageFundSelection().map(f => f.code), ['110011']);
  window.location.hash = '#/list';
  assert.deepEqual(getPageFundSelection(), []);
});
