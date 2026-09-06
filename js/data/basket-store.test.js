import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASKET_KEY, createBasketStore, normalizeFundRefs, mergeFundRefs } from './basket-store.js';
const a={code:'000001',name:'华夏成长'},b={code:'110011',name:'易方达'};
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};};
test('basket keeps only valid public fund references, deduplicated in order',()=>{
 assert.deepEqual(normalizeFundRefs([a,b,a,{code:'000300.SH'},{code:'x<script>'},{code:'000005',kind:'index'}]),[a,b]);
 assert.deepEqual(mergeFundRefs([a],[a,b]),[a,b]);
 assert.deepEqual(mergeFundRefs([a],[b],'replace'),[b]);
 assert.throws(()=>mergeFundRefs([a],[b],'add',1),/最多/);
});
test('basket persists independently, restores, removes and synchronizes another tab',()=>{
 const storage=memory(),store=createBasketStore(storage);let changes=0;store.subscribe(()=>changes++);
 assert.equal(store.add([a,b]),2);assert.equal(store.add([a]),0);
 assert.deepEqual(createBasketStore(storage).get(),[a,b]);
 const copy=store.get();copy[0].name='changed';assert.equal(store.get()[0].name,a.name);
 store.remove([a.code]);assert.deepEqual(store.get(),[b]);
 store.sync(JSON.stringify({v:1,items:[a]}));assert.deepEqual(store.get(),[a]);
 store.clear();assert.deepEqual(JSON.parse(storage.getItem(BASKET_KEY)).items,[]);assert.equal(changes,5);
});
test('corrupt or disabled storage does not prevent using the in-memory basket',()=>{
 const storage=memory();storage.setItem(BASKET_KEY,'not json');assert.deepEqual(createBasketStore(storage).get(),[]);
 let failed=0;const unavailable={getItem(){throw Error();},setItem(){throw Error();}};
 const store=createBasketStore(unavailable,()=>failed++);store.add([a]);assert.deepEqual(store.get(),[a]);assert.equal(failed,2);
});
