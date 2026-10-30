import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { loadTrackingIndexMap, groupTrackingIndexes } from './index-tracking-links.js';
import { createFundRouter } from './fund-api.js';

function createDb(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE index_basic (ts_code TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE index_fund_tracker (index_ts_code TEXT, fund_ts_code TEXT, match_type TEXT);
    CREATE TABLE fund_basic (ts_code TEXT PRIMARY KEY, name, management, fund_type, benchmark, status);
    CREATE TABLE fund_meta (ts_code TEXT PRIMARY KEY, code, source, tracking_target,
      trading_subscribe, trading_redeem, buy_fee, annual_fee, is_floating_annual_fee,
      mgmt_fee, custody_fee, sales_service_fee, operation_fee_total, net_asset_text,
      net_asset_amount_text, net_asset_as_of, stage_returns_as_of, crawler_updated_at,
      found_date_normalized, name_crawler, fund_type_crawler, management_crawler, benchmark_crawler);
    CREATE TABLE fund_fee_segments (ts_code, kind, seq, to_days, rate);
    CREATE TABLE fund_stage_returns (ts_code, period, return_pct, return_text);
    INSERT INTO index_basic VALUES ('000300.SH','沪深300'), ('h30590.CSI','中证价值回报');
    INSERT INTO fund_basic VALUES ('000001.SH','场内同代码',NULL,NULL,NULL,NULL),
      ('000001.OF','场外基金',NULL,NULL,NULL,NULL), ('000002.OF','另一基金',NULL,NULL,NULL,NULL),
      ('000003.OF','无关联基金',NULL,NULL,NULL,NULL), ('000004.OF','仅 Tushare',NULL,NULL,NULL,NULL);
    INSERT INTO fund_meta (ts_code,code,source,tracking_target) VALUES
      ('000001.SH','000001','crawler','沪深300指数'),
      ('000001.OF','000001','crawler','沪深300指数'),
      ('000002.OF','000002','both','沪深300指数'),
      ('000003.OF','000003','crawler','中证价值回报'),
      ('000004.OF','000004','tushare','沪深300指数');
    INSERT INTO index_fund_tracker VALUES
      ('000300.SH','000001.OF','fullname'), ('000300.SH','000002.OF','fullname'),
      ('h30590.CSI','000002.OF','fuzzy'), ('h30590.CSI','000001.SH','exact'),
      ('h30590.CSI','000004.OF','exact'), ('MISSING.SH','000002.OF','exact');
  `);
  return db;
}

test('stored tracking references preserve codes and match types, exclude other markets and unknown indexes', t => {
  const db = createDb(t);
  const refs = loadTrackingIndexMap(db);
  assert.deepEqual(refs.get('000001.OF'), [{ code: '000300.SH', name: '沪深300', matchType: 'fullname' }]);
  assert.deepEqual(refs.get('000002.OF'), [
    { code: '000300.SH', name: '沪深300', matchType: 'fullname' },
    { code: 'h30590.CSI', name: '中证价值回报', matchType: 'fuzzy' },
  ]);
  assert.equal(refs.has('000001.SH'), false);
  assert.deepEqual([...loadTrackingIndexMap(db, { fundCode: '000002' }).keys()], ['000002.OF']);
  assert.equal(loadTrackingIndexMap(db, { fundCode: "' OR 1=1" }).size, 0);
});

test('tracking stats use supplied fund identities, deduplicate references, and never infer by name', t => {
  const db = createDb(t);
  const rows = db.prepare("SELECT ts_code,tracking_target FROM fund_meta WHERE source IN ('both','crawler')").all();
  const groups = groupTrackingIndexes(rows, loadTrackingIndexMap(db));
  assert.deepEqual(groups.get('沪深300指数'), [
    { code: '000300.SH', name: '沪深300' }, { code: 'h30590.CSI', name: '中证价值回报' },
  ]);
  assert.deepEqual(groups.get('中证价值回报'), []);
});

test('databases without tracking tables remain readable without migrations or guessed links', t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  assert.equal(loadTrackingIndexMap(db).size, 0);
  db.exec('CREATE TABLE index_basic (ts_code,name)');
  assert.equal(loadTrackingIndexMap(db).size, 0);
});

async function request(router, url, headers = {}) {
  const result = { headers: {}, status: null, body: null };
  const res = {
    setHeader(name, value) { result.headers[name.toLowerCase()] = value; },
    writeHead(status) { result.status = status; },
    end(body) { result.body = body == null ? null : JSON.parse(body); },
  };
  assert.equal(await router({ method: 'GET', url, headers }, res), true);
  return result;
}

test('fund API links choose .OF, expose group references, and change ETags when stored relations change', async t => {
  const db = createDb(t);
  const router = createFundRouter({ getDatabase: () => db });
  const detail = await request(router, '/api/fund/000001/fee');
  assert.equal(detail.status, 200);
  assert.equal(detail.body.name, '场外基金');
  assert.equal(detail.body.buyFee, null);
  assert.equal(detail.body.annualFee, null);
  assert.deepEqual(detail.body.operationFees, { managementFee: null, custodyFee: null, salesServiceFee: null, total: null });
  db.prepare("UPDATE fund_meta SET buy_fee=0,annual_fee=0,mgmt_fee=0,custody_fee=0,sales_service_fee=0,operation_fee_total=0 WHERE ts_code='000001.OF'").run();
  const free = await request(router, '/api/fund/000001/fee');
  assert.equal(free.body.buyFee, 0);
  assert.equal(free.body.annualFee, 0);
  assert.deepEqual(free.body.operationFees, { managementFee: 0, custodyFee: 0, salesServiceFee: 0, total: 0 });
  assert.deepEqual(detail.body.trackingIndexes, [{ code: '000300.SH', name: '沪深300', matchType: 'fullname' }]);
  const first = await request(router, '/api/fund/stats');
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.tracking.find(row => row.label === '沪深300指数').indexes, [
    { code: '000300.SH', name: '沪深300' }, { code: 'h30590.CSI', name: '中证价值回报' },
  ]);
  assert.deepEqual(first.body.tracking.find(row => row.label === '中证价值回报').indexes, []);
  assert.equal((await request(router, '/api/fund/stats', { 'if-none-match': first.headers.etag })).status, 304);
  db.prepare("DELETE FROM index_fund_tracker WHERE fund_ts_code='000002.OF' AND index_ts_code='h30590.CSI'").run();
  const changed = await request(router, '/api/fund/stats', { 'if-none-match': first.headers.etag });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.etag, first.headers.etag);
  assert.deepEqual(changed.body.tracking.find(row => row.label === '沪深300指数').indexes, [{ code: '000300.SH', name: '沪深300' }]);
  const full = await request(router, '/api/fund/list?fields=full');
  assert.deepEqual(full.body.find(row => row.name === '场外基金').trackingIndexes, detail.body.trackingIndexes);
  assert.deepEqual(full.body.find(row => row.name === '场内同代码').trackingIndexes, []);
});
