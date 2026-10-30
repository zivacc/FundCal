import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { parseFofHoldings, createFofHoldingsLoader } from './fof-holdings.js';

function fixture({ code = '000001', date = '2026-06-30', weight = '10.25%', link = 'https://fund.eastmoney.com/000002.html', duplicate = false } = {}) {
  const row = `<tr><td><a href="${link}" title='完整基金名称A'>缩略名称</a></td><td>${weight}</td><td>5.00%</td></tr>`;
  return `<title>测试FOF(${code})基金净值</title><div id="quotationItem_DataTable"><li id='position_shares'><table><tr><th>基金名称</th><th>持仓占比</th></tr>${row}${duplicate ? row : ''}</table><div>持仓截止日期: ${date}</div></li><li id='position_shares'><table><tr><th>股票名称</th><th>持仓占比</th></tr><tr><td>某股票</td><td>8%</td></tr></table></li></div><!-- 数据tab end -->`;
}

function database(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE fund_basic(ts_code TEXT,code TEXT,name TEXT,management TEXT,fund_type TEXT);
    CREATE TABLE fund_meta(ts_code TEXT,name_crawler TEXT,management_crawler TEXT,fund_type_crawler TEXT);
    INSERT INTO fund_basic VALUES ('000001.OF','000001','测试FOFA','甲','FOF'),
    ('000002.OF','000002','普通基金','甲','混合'), ('000003.OF','000003','另一个FOF','甲','FOF');
    INSERT INTO fund_meta(ts_code) SELECT ts_code FROM fund_basic;`);
  return db;
}

test('FOF parser uses only the fund table, report date, code link and disclosed percentage', () => {
  const data = parseFofHoldings(fixture(), '000001');
  assert.equal(data.coverage, 'top10');
  assert.equal(data.asOfDate, '2026-06-30');
  assert.deepEqual(data.rows, [{ code: '000002', name: '完整基金名称A', weightPct: 10.25 }]);
  assert.equal(parseFofHoldings(fixture({ weight: '0.00%' }), '000001').rows[0].weightPct, 0);
});

test('FOF parser rejects identity, date, duplicate, malformed units, bad links and stocks', () => {
  for (const args of [{ code: '000003' }, { date: '2026-02-30' }, { date: '' }, { weight: '101%' },
    { weight: '--' }, { weight: '0.2' }, { duplicate: true }, { link: 'https://evil.example/000002.html' }]) {
    assert.throws(() => parseFofHoldings(fixture(args), '000001'));
  }
  const stockOnly = fixture().replace('基金名称', '股票名称');
  assert.equal(parseFofHoldings(stockOnly, '000001').status, 'unavailable');
  assert.throws(() => parseFofHoldings('<title>测试(000001)</title>', '000001'));
});

test('holdings loader deduplicates, restricts to known FOF, caches and bounds concurrent upstream work', async t => {
  const db = database(t);
  let calls = 0;
  let resolve;
  const load = createFofHoldingsLoader({ maxConcurrent: 1, fetchImpl: async () => {
    calls++;
    return new Promise(r => { resolve = () => r(new Response(fixture())); });
  } });
  assert.equal(await load(db, '999999'), null);
  assert.equal((await load(db, '000002')).status, 'not_applicable');
  assert.equal(calls, 0);
  const a = load(db, '000001');
  const b = load(db, '000001');
  assert.equal((await load(db, '000003')).status, 'busy');
  resolve();
  const [first, second] = await Promise.all([a, b]);
  assert.deepEqual(first, second);
  assert.equal(first.rows[0].available, true);
  assert.deepEqual(await load(db, '000001'), first);
  assert.equal(calls, 1);
});

test('upstream failures stay distinct from empty holdings and retry after a short failure cache', async t => {
  const db = database(t);
  let now = 1000;
  let calls = 0;
  const load = createFofHoldingsLoader({ now: () => now, fetchImpl: async () => {
    calls++;
    if (calls === 1) throw new Error('secret upstream path');
    return new Response(fixture());
  } });
  assert.equal((await load(db, '000001')).status, 'error');
  assert.equal((await load(db, '000001')).status, 'error');
  assert.equal(calls, 1);
  now += 60001;
  assert.equal((await load(db, '000001')).status, 'available');
  assert.equal(calls, 2);
});

test('oversized upstream pages are rejected instead of retained or parsed', async t => {
  const db = database(t);
  const load = createFofHoldingsLoader({ fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) });
  assert.deepEqual((await load(db, '000001')).rows, []);
  assert.equal((await load(db, '000001')).status, 'error');
});
