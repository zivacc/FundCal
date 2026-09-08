import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseWindCodes,windRunDirectory} from './sync-wind-index.js';
import {selectTotalReturnCandidates} from './wind-index-data.js';

test('Explicit index scope validates full codes and isolates progress from the full run',()=>{
 const codes=parseWindCodes('ixic.gi,DJI.GI,IXIC.GI,000012.SH');
 assert.deepEqual(codes,['000012.SH','DJI.GI','IXIC.GI']);
 assert.equal(windRunDirectory(codes),windRunDirectory(parseWindCodes('DJI.GI,000012.SH,IXIC.GI')));
 assert.notEqual(windRunDirectory(codes),windRunDirectory(null));
 for(const value of ['','IXIC','000012','DJI.GI,','../x']) assert.throws(()=>parseWindCodes(value));
 assert.equal(parseWindCodes(undefined),null);
});
test('Provider total-return name is recognized even without a base date',()=>{
 const base={'Wind代码':'DJI.GI','证券全称':'道琼斯工业平均指数','全收益指数代码':'DJITR.GI'};
 const candidate={'Wind代码':'DJITR.GI','证券全称':'道琼斯工业平均总回报指数','收益处理方式':'全收益指数','基期':null};
 assert.deepEqual(selectTotalReturnCandidates(base,[candidate]),[candidate]);
 assert.deepEqual(selectTotalReturnCandidates(base,[{...candidate,'收益处理方式':'净收益指数'}]),[]);
});
test('Verified total-return series remains usable without an associated code',()=>{
 const bond={'Wind代码':'000012.SH','证券全称':'上证国债指数','收益处理方式':'全收益指数','全收益指数代码':''};
 assert.deepEqual(selectTotalReturnCandidates(bond,[]),[bond]);
 assert.deepEqual(selectTotalReturnCandidates({...bond,'收益处理方式':'全价指数'},[]),[]);
});
