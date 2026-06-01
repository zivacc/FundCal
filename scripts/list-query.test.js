import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseListParams, buildListQuery } from './list-query.js';

/* ========== parseListParams ========== */

test('parseListParams: defaults', () => {
  const p = parseListParams({});
  assert.equal(p.page, 1);
  assert.equal(p.size, 100);
  assert.deepEqual(p.sort, { key: 'code', dir: 'asc' });
  assert.equal(p.q, '');
  assert.deepEqual(p.filters.fundType, []);
});

test('parseListParams: clamps page/size', () => {
  assert.equal(parseListParams({ page: '-3' }).page, 1);
  assert.equal(parseListParams({ size: '99999' }).size, 500);
  assert.equal(parseListParams({ size: '0' }).size, 100);
});

test('parseListParams: invalid sort falls back to default', () => {
  const p = parseListParams({ sort: 'evil_col:asc' });
  assert.deepEqual(p.sort, { key: 'code', dir: 'asc' });
});

test('parseListParams: valid sort respected', () => {
  const p = parseListParams({ sort: 'annualFee:desc' });
  assert.deepEqual(p.sort, { key: 'annualFee', dir: 'desc' });
});

test('parseListParams: csv multi-select', () => {
  const p = parseListParams({ fundType: '股票型,债券型 ,, 混合型' });
  assert.deepEqual(p.filters.fundType, ['股票型', '债券型', '混合型']);
});

test('parseListParams: numeric ranges parse', () => {
  const p = parseListParams({ buyFeeMin: '0', buyFeeMax: '0.015' });
  assert.equal(p.filters.buyFeeMin, 0);
  assert.equal(p.filters.buyFeeMax, 0.015);
});

test('parseListParams: bogus numeric → null', () => {
  const p = parseListParams({ buyFeeMin: 'abc' });
  assert.equal(p.filters.buyFeeMin, null);
});

test('parseListParams: floatingFee normalized', () => {
  assert.equal(parseListParams({ floatingFee: 'yes' }).filters.floatingFee, 'yes');
  assert.equal(parseListParams({ floatingFee: 'maybe' }).filters.floatingFee, '');
});

/* ========== buildListQuery ========== */

test('buildListQuery: default has no WHERE bind, defaults source', () => {
  const { sql, countSql, params } = buildListQuery(parseListParams({}));
  assert.equal(params.length, 0);
  assert.match(sql, /m\.source IN \('both','crawler'\)/);
  assert.match(sql, /LIMIT 100 OFFSET 0/);
  assert.match(sql, /ORDER BY \(m\.code\) IS NULL, m\.code ASC/);
  assert.match(countSql, /SELECT COUNT\(\*\)/);
});

test('buildListQuery: q numeric → code prefix', () => {
  const { sql, params } = buildListQuery(parseListParams({ q: '510' }));
  assert.match(sql, /m\.code LIKE \?/);
  assert.deepEqual(params, ['510%']);
});

test('buildListQuery: q text → name LIKE + code prefix OR', () => {
  const { sql, params } = buildListQuery(parseListParams({ q: '易方达' }));
  assert.match(sql, /OR m\.code LIKE \?/);
  assert.equal(params[0], '%易方达%');
  assert.equal(params[1], '易方达%');
});

test('buildListQuery: multi-select IN with placeholders', () => {
  const { sql, params } = buildListQuery(parseListParams({ fundType: '股票型,债券型' }));
  assert.match(sql, /IN \(\?,\?\)/);
  assert.deepEqual(params, ['股票型', '债券型']);
});

test('buildListQuery: floatingFee yes', () => {
  const { sql } = buildListQuery(parseListParams({ floatingFee: 'yes' }));
  assert.match(sql, /m\.is_floating_annual_fee = 1/);
});

test('buildListQuery: floatingFee no', () => {
  const { sql } = buildListQuery(parseListParams({ floatingFee: 'no' }));
  assert.match(sql, /is_floating_annual_fee IS NULL OR m\.is_floating_annual_fee = 0/);
});

test('buildListQuery: numeric range bound order', () => {
  const { sql, params } = buildListQuery(parseListParams({
    buyFeeMin: '0', buyFeeMax: '0.015', annualFeeMin: '0', annualFeeMax: '0.02',
  }));
  assert.match(sql, /buy_fee,0\) >= \?/);
  assert.match(sql, /buy_fee,0\) <= \?/);
  assert.deepEqual(params, [0, 0.015, 0, 0.02]);
});

test('buildListQuery: trackingTarget substring lowercased', () => {
  const { params } = buildListQuery(parseListParams({ trackingTarget: 'CSI300' }));
  assert.deepEqual(params, ['%csi300%']);
});

test('buildListQuery: sort desc with NULLS LAST', () => {
  const { sql } = buildListQuery(parseListParams({ sort: 'annualFee:desc' }));
  assert.match(sql, /\(m\.annual_fee\) IS NULL, m\.annual_fee DESC/);
});

test('buildListQuery: sort by sellFee uses join alias sf', () => {
  const { sql } = buildListQuery(parseListParams({ sort: 'sellFee:asc' }));
  assert.match(sql, /\(sf\.rate\) IS NULL, sf\.rate ASC/);
});

test('buildListQuery: page 3 size 50 → OFFSET 100', () => {
  const { sql } = buildListQuery(parseListParams({ page: '3', size: '50' }));
  assert.match(sql, /LIMIT 50 OFFSET 100/);
});

test('buildListQuery: SQL injection on sort blocked by whitelist', () => {
  const { sql } = buildListQuery(parseListParams({ sort: 'name;DROP TABLE x:asc' }));
  // 不在白名单 → fallback code
  assert.match(sql, /ORDER BY \(m\.code\) IS NULL, m\.code ASC/);
  assert.doesNotMatch(sql, /DROP TABLE/);
});

test('buildListQuery: explicit source param overrides default', () => {
  const { sql, params } = buildListQuery(parseListParams({ source: 'tushare' }));
  assert.match(sql, /m\.source IN \(\?\)/);
  assert.deepEqual(params, ['tushare']);
});
