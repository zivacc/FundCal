import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterSearchIndex } from './search.js';
const fund = { code: '001564', name: '东方红京东大数据混合A', initials: 'dfhjddsjhha', kind: 'fund' };
const index = { code: 'NDX.GI', name: '纳斯达克100指数', kind: 'index' };
test('middle initials, Chinese substring, multi-token and ordered fuzzy matches', () => {
  for (const q of ['jd', 'JD', '京东', '东方红 大数据 A', 'dfhdsj', '东方红数据', '００１５６４']) {
    assert.deepEqual(filterSearchIndex([fund], q), [fund], q);
  }
});
test('English index codes and aliases work for indices and tracking labels', () => {
  for (const q of ['NDX', 'ndx.gi', 'nasdaq100', 'nasdaq', 'nasda']) assert.deepEqual(filterSearchIndex([index], q), [index]);
  assert.equal(filterSearchIndex([{ label: '纳斯达克100指数' }], 'NDX').length, 1);
  assert.equal(filterSearchIndex([{ label: '沪深300指数' }], 'CSI300').length, 1);
});
test('rank exact ahead of containment and fuzzy; scopes and limits are independent', () => {
  const literal = { code: '123456', name: 'JD', initials: 'jd' };
  assert.deepEqual(filterSearchIndex([fund, literal], 'jd'), [literal, fund]);
  assert.equal(filterSearchIndex([fund, index], 'ndx', { kinds: ['fund'] }).length, 0);
  assert.equal(filterSearchIndex([fund, literal], 'jd', { limit: 1 })[0], literal);
  assert.deepEqual(filterSearchIndex([fund], 'jd', { predicate: () => false }), []);
});
test('mixed codes are not reduced to digits; punctuation cannot match everything', () => {
  for (const q of ['A500', '%', '___', '', '   ', '不存在', '999999']) assert.deepEqual(filterSearchIndex([fund, index], q), []);
  assert.equal(filterSearchIndex([{code:'000905.SH',name:'中证500'}], 'A500').length, 0);
});
test('one-letter typo is supported only for sufficiently long Latin tokens', () => {
  assert.equal(filterSearchIndex([index], 'nasdaqx').length, 1);
  assert.equal(filterSearchIndex([index], 'nasdqa').length, 1);
  assert.equal(filterSearchIndex([fund], 'jx').length, 0);
});
test('duplicate symbols stay separate across kinds; prefer available fund records', () => {
  const placeholder = {...fund, needsCrawl:true};
  assert.deepEqual(filterSearchIndex([placeholder, fund], 'jd'), [fund]);
  assert.equal(filterSearchIndex([fund, {...fund, kind:'index'}], 'jd').length, 2);
});
test('literal code hits suppress unrelated fuzzy noise within the selected scope', () => {
  const unrelated = { label: 'MSCI China Dividend Index' };
  assert.deepEqual(filterSearchIndex([unrelated, index], 'NDX'), [index]);
  assert.deepEqual(filterSearchIndex([unrelated, index], 'NDX', { predicate: item => item !== index }), [unrelated]);
});
