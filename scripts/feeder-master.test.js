import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { parseFeederMaster, createFeederMasterLoader } from './feeder-master.js';
import { createFofHoldingsLoader } from './fof-holdings.js';

const fixture = (link = '<a href="http://fund.eastmoney.com/510310.html">查看相关ETF&gt;</a>', code = '110020') =>
  `<title>易方达沪深300ETF联接A(${code})</title><div class="fundDetail-header"><div class="fundDetail-tit"><div><span class="ui-num">${code}</span></div>${link}</div><div class="fundDetail-tools"></div></div>`;
const relations = { code: '110020', isFeeder: true, masterMissing: true, feederFunds: [], shareClasses: [] };

function database(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE fund_basic(ts_code,code,name,management,fund_type);
    CREATE TABLE fund_meta(ts_code,name_crawler,management_crawler,fund_type_crawler);
    INSERT INTO fund_basic VALUES ('110020.OF','110020','沪深300ETF联接A','甲','指数'),
      ('510310.OF','510310','沪深300ETF','甲','指数'), ('000001.OF','000001','FOF','甲','FOF');
    INSERT INTO fund_meta(ts_code) SELECT ts_code FROM fund_basic;`);
  return db;
}

test('master parser requires both identities and the explicit forward ETF link', () => {
  assert.equal(parseFeederMaster(fixture(), '110020').masterCode, '510310');
  assert.equal(parseFeederMaster(fixture('<a href="http://fund.eastmoney.com/022928.html">查看相关ETF联接&gt;</a>'), '110020').status, 'unavailable');
  assert.equal(parseFeederMaster(fixture(''), '110020').status, 'unavailable');
  assert.throws(() => parseFeederMaster(fixture().replace('<span class="ui-num">110020', '<span class="ui-num">110021'), '110020'));
  assert.throws(() => parseFeederMaster(fixture().replace('(110020)', '(110021)'), '110020'));
  for (const url of ['https://evil.example/510310.html','https://fund.eastmoney.com/110020.html']) {
    assert.throws(() => parseFeederMaster(fixture(`<a href="${url}">查看相关ETF&gt;</a>`), '110020'));
  }
  assert.throws(() => parseFeederMaster(fixture('<a href="http://fund.eastmoney.com/510310.html">查看相关ETF&gt;</a><a href="http://fund.eastmoney.com/510300.html">查看相关ETF&gt;</a>'), '110020'));
});

test('master enrichment only reads missing feeder relations, caches explicit codes and distinguishes missing local detail', async t => {
  const db = database(t);
  let calls = 0;
  const load = createFeederMasterLoader({ fetchImpl: async () => { calls++; return new Response(fixture()); } });
  for (const skip of [{ ...relations, isFeeder: false }, { ...relations, masterMissing: false }, null]) assert.equal(await load(db, skip), skip);
  assert.equal(calls, 0);
  const first = await load(db, relations);
  assert.equal(first.masterMissing, false);
  assert.equal(first.feederFunds[0].code, '510310');
  assert.equal(first.feederFunds[0].available, true);
  assert.equal(first.feederFunds[0].basis, 'eastmoney_explicit_target_etf');
  assert.match(first.masterLookup.fetchedAt, /^\d{4}-/);
  assert.equal(first.masterLookup.asOfDate, undefined);
  db.exec("DELETE FROM fund_meta WHERE ts_code='510310.OF'");
  const second = await load(db, relations);
  assert.equal(calls, 1);
  assert.equal(second.feederFunds[0].available, false);
  assert.equal(second.feederFunds[0].name, '目标 ETF 510310');
});

test('FOF and mother-fund fetches share the same concurrency ceiling and release it after failures', async t => {
  const db = database(t);
  const limiter = { active: 0 };
  let resolve;
  const masters = createFeederMasterLoader({ limiter, maxConcurrent: 1, fetchImpl: async () => new Promise(r => { resolve = r; }) });
  let fofCalls = 0;
  const holdings = createFofHoldingsLoader({ limiter, maxConcurrent: 1, fetchImpl: async () => { fofCalls++; throw new Error('offline'); } });
  const first = masters(db, relations);
  assert.equal((await holdings(db, '000001')).status, 'busy');
  assert.equal(fofCalls, 0);
  resolve(new Response(fixture()));
  await first;
  assert.equal(limiter.active, 0);
  assert.equal((await holdings(db, '000001')).status, 'error');
  assert.equal(limiter.active, 0);
});
