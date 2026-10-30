import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { shareFamily, loadFundRelations } from './fund-relations.js';
import { createFundRouter } from './fund-api.js';

function database(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE fund_basic(ts_code TEXT,code TEXT,name TEXT,management TEXT,fund_type TEXT);
    CREATE TABLE fund_meta(ts_code TEXT,name_crawler TEXT,management_crawler TEXT,fund_type_crawler TEXT);
    INSERT INTO fund_basic VALUES
      ('000001.OF','000001','甲精选混合A','甲公司','混合'),
      ('000002.OF','000002','甲精选混合C','甲公司','混合'),
      ('000003.OF','000003','甲精选混合C','乙公司','混合'),
      ('000004.OF','000004','甲精选混合美元C','甲公司','混合'),
      ('000005.SH','000005','甲精选混合B','甲公司','混合'),
      ('000006.OF','000006','甲精选混合','甲公司','混合'),
      ('000007.OF','000007','甲养老(FOF)A','甲公司','FOF-稳健型');
    INSERT INTO fund_meta(ts_code) SELECT ts_code FROM fund_basic;`);
  return db;
}

test('share grouping preserves currencies, horizons and ETF identifiers', () => {
  assert.deepEqual(shareFamily('甲精选混合C'), { name: '甲精选混合', shareClass: 'C' });
  assert.deepEqual(shareFamily('甲养老（FOF）Y'), { name: '甲养老(FOF)', shareClass: 'Y' });
  assert.equal(shareFamily('沪深300ETF').shareClass, null);
  assert.equal(shareFamily('沪深300ETFA').name, '沪深300ETF');
  assert.notEqual(shareFamily('甲基金美元A').name, shareFamily('甲基金人民币C').name);
  assert.notEqual(shareFamily('甲基金三年A').name, shareFamily('甲基金一年C').name);
});

test('related funds use same manager and precise class family, exclude other markets and self', t => {
  const db = database(t);
  const before = db.prepare('SELECT total_changes() n').get().n;
  const data = loadFundRelations(db, '000001', {});
  assert.deepEqual(data.shareClasses.map(row => row.code), ['000002', '000006']);
  assert.equal(data.isFof, false);
  assert.equal(loadFundRelations(db, '000007', {}).isFof, true);
  assert.equal(loadFundRelations(db, '000005', {}), null);
  db.exec("INSERT INTO fund_basic VALUES ('999998.OF','999998','仅基础记录','甲公司','混合')");
  assert.equal(loadFundRelations(db, '999998', {}), null);
  assert.equal(loadFundRelations(db, "' OR 1=1", {}), null);
  assert.equal(db.prepare('SELECT total_changes() n').get().n, before + 1);
});

test('feeder relations use stored codes and flag missing public mother fund instead of borrowing another market', t => {
  const db = database(t);
  const data = loadFundRelations(db, '000001', { codeToFeeder: { '000001': {
    masterKey: '甲ETF', masterCode: '000005', masterName: '甲ETF', feederCodes: ['000001','000002','000002'],
  } } });
  assert.deepEqual(data.feederFunds, [
    { code: '000005', name: '甲ETF', relation: 'master', available: false, basis: 'local_feeder_index' },
    { code: '000002', name: '甲精选混合C', relation: 'feeder', available: true, basis: 'local_feeder_index' },
  ]);
});

async function request(router, url, headers = {}) {
  const result = { headers: {} };
  const res = { setHeader(key, value) { result.headers[key] = value; }, writeHead(status) { result.status = status; },
    end(body) { result.body = body ? JSON.parse(body) : null; } };
  assert.equal(await router({ method: 'GET', url, headers }, res), true);
  return result;
}

test('related HTTP route caches results, responds to ETag and retains partial holdings errors', async t => {
  const db = database(t);
  const router = createFundRouter({ getDatabase: () => db, getFeederRelations: () => ({}),
    loadHoldings: async (db, code) => ({ code, status: 'error', rows: [] }) });
  const result = await request(router, '/api/fund/000001/related');
  assert.equal(result.status, 200);
  assert.equal(result.body.shareClasses.length, 2);
  assert.equal((await request(router, '/api/fund/000001/related', { 'if-none-match': result.headers.ETag })).status, 304);
  assert.equal((await request(router, '/api/fund/999999/related')).status, 404);
  const holdings = await request(router, '/api/fund/000007/holdings');
  assert.equal(holdings.body.status, 'error');
  assert.equal(holdings.headers['Cache-Control'], 'no-store');
});

test('optional master enrichment runs separately and transient errors cannot be HTTP cached', async t => {
  const db = database(t);
  let calls = 0;
  const router = createFundRouter({ getDatabase: () => db, getFeederRelations: () => ({}),
    resolveFeederMaster: async (db, data) => {
      calls++;
      return { ...data, masterLookup: { status: calls === 1 ? 'busy' : 'error' } };
    } });
  assert.equal((await request(router, '/api/fund/000001/related')).status, 200);
  assert.equal(calls, 0);
  for (const status of ['busy', 'error']) {
    const response = await request(router, '/api/fund/000001/related?resolveMaster=1');
    assert.equal(response.body.masterLookup.status, status);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(response.body.shareClasses.length, 2);
  }
  assert.equal((await request(router, '/api/fund/999999/related?resolveMaster=1')).status, 404);
  assert.equal(calls, 2);
});
