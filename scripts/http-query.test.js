import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, InvalidQueryError } from './http-query.js';

test('query decoding handles Chinese, spaces, literal plus and equals', () => {
  assert.deepEqual(parseQuery('/api/fund/list?q=%E6%B2%AA%E6%B7%B1+300&filter=a=b%3Dc&symbol=%2B&percent=100%25'), {
    q: '沪深 300', filter: 'a=b=c', symbol: '+', percent: '100%',
  });
});

test('empty values and duplicate keys preserve the existing last-value convention', () => {
  assert.deepEqual(parseQuery('/api/fund/list'), {});
  assert.deepEqual(parseQuery('/api/fund/list?'), {});
  assert.deepEqual(parseQuery('/api/fund/list?q=old&q=new&flag&empty='), { q: 'new', flag: '', empty: '' });
});

test('malformed percent escapes and UTF-8 are rejected explicitly', () => {
  for (const query of ['q=%', 'q=%GG', 'q=%E4%B8', '%=value', 'q=%C0%AF']) {
    assert.throws(() => parseQuery(`/api/fund/list?${query}`), InvalidQueryError);
  }
});

test('prototype-looking query keys remain ordinary own properties', () => {
  const query = parseQuery('/?__proto__=value&constructor=test');
  assert.equal(Object.getPrototypeOf(query), Object.prototype);
  assert.equal(Object.hasOwn(query, '__proto__'), true);
  assert.equal(query.__proto__, 'value');
});
