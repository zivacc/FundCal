import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import http from 'node:http';
import { once } from 'node:events';
import { createApiServer } from '../serve-fund-api.js';
import { createIndexDetailRouter } from './index-detail-api.js';
import { queryIndexDetail, queryIndexDetailSearch, isFullIndexCode, IndexSnapshotNotFoundError } from './index-detail-query.js';

function database(t, { optional = true } = {}) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE index_basic(ts_code TEXT PRIMARY KEY,code TEXT,name TEXT,fullname TEXT,publisher TEXT,category TEXT,
    market TEXT,index_type TEXT,base_date TEXT,base_point REAL,list_date TEXT,weight_rule TEXT,description TEXT,primary_source TEXT);
    CREATE TABLE index_daily(ts_code TEXT,end_date TEXT,close REAL,pct_chg REAL,source INTEGER);
    CREATE TABLE fund_basic(ts_code TEXT PRIMARY KEY,code TEXT,name TEXT,fund_type TEXT,management TEXT);
    CREATE TABLE fund_meta(ts_code TEXT PRIMARY KEY,mgmt_fee REAL,custody_fee REAL,sales_service_fee REAL);
    CREATE TABLE index_fund_tracker(index_ts_code TEXT,fund_ts_code TEXT,match_type TEXT);
    INSERT INTO index_basic(ts_code,code,name,index_type,publisher) VALUES('000300.SH','000300','沪深300','价格指数','中证指数');
    INSERT INTO index_basic(ts_code,code,name,index_type) VALUES('H00300.CSI','H00300','沪深300全收益','全收益指数');
    INSERT INTO index_daily VALUES('000300.SH','20260828',4500,1.2,3),('000300.SH','20260831',4520,NULL,4);
  `);
  if (optional) db.exec(`CREATE TABLE index_return_links(index_ts_code TEXT,return_ts_code TEXT);
    CREATE TABLE index_constituent_snapshot(id INTEGER PRIMARY KEY,index_ts_code TEXT,as_of_date TEXT,source TEXT,
      expected_count INTEGER,constituent_count INTEGER,weight_sum_pct REAL,declared_weight_sum_pct REAL,
      validation TEXT,validation_basis TEXT,receipt_path TEXT,receipt_sha256 TEXT,fetched_at TEXT);
    CREATE TABLE index_constituent_weight(snapshot_id INTEGER,constituent_code TEXT,name TEXT,weight_pct REAL,
      PRIMARY KEY(snapshot_id,constituent_code));
  `);
  return db;
}

function snapshot(db, { id = 1, code = '000300.SH', date = '2026-08-31', source = 'wind', weights = [60, 40] } = {}) {
  const basis = { wind: 'provider_totals', csindex: 'official_full_file', cnindex: 'official_full_file', tushare: 'api_full_result' }[source];
  const sum = weights.reduce((total, weight) => total + weight, 0);
  db.prepare(`INSERT INTO index_constituent_snapshot VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, code, date, source, weights.length, weights.length, sum, sum, 'complete', basis,
    '/private/local/receipt.json', 'private-hash', '2026-10-12T00:00:00Z');
  weights.forEach((weight, i) => db.prepare('INSERT INTO index_constituent_weight VALUES(?,?,?,?)').run(id, `${i + 1}.SH`, `证券${i + 1}`, weight));
}

async function start(t, db, options = {}) {
  const server = createApiServer({ indexRouter: createIndexDetailRouter({ dbFactory: () => db }), ...options });
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (path, opts = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, agent: false, ...opts }, res => {
      let body = '';
      res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: body ? JSON.parse(body) : null }));
      res.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
}

test('detail returns public profile, quote and exact history coverage, not raw receipts', t => {
  const db = database(t); snapshot(db);
  const result = queryIndexDetail(db, '000300.SH');
  assert.equal(result.index.returnType, 'price');
  assert.equal(result.index.publisher, '中证指数');
  assert.deepEqual(result.quote, { end_date: '20260831', close: 4520, pct_chg: null, source: 4 });
  assert.deepEqual(result.history, { start: '20260828', end: '20260831', count: 2 });
  assert.deepEqual(result.constituents.rows.map(r => r.weightPct), [60, 40]);
  assert.deepEqual(Object.keys(result.snapshots[0]), ['id', 'asOfDate', 'source', 'count', 'weightSumPct', 'validationBasis']);
  assert.doesNotMatch(JSON.stringify(result), /private|receipt|fetched_at/);
});

test('snapshot default uses latest date, then official, Tushare and Wind priority', t => {
  const db = database(t);
  snapshot(db, { id: 1, source: 'csindex', date: '2026-07-31' });
  snapshot(db, { id: 2, source: 'wind' });
  snapshot(db, { id: 3, source: 'tushare' });
  snapshot(db, { id: 4, source: 'cnindex' });
  assert.deepEqual(queryIndexDetail(db, '000300.SH').snapshots.map(r => r.id), [4, 3, 2, 1]);
  snapshot(db, { id: 5, source: 'wind', date: '2026-09-30' });
  assert.equal(queryIndexDetail(db, '000300.SH').constituents.snapshot.id, 5);
  assert.equal(queryIndexDetail(db, '000300.SH', { snapshotId: 1 }).constituents.snapshot.id, 1);
});

test('incomplete, inconsistent, invalid-basis and damaged weight snapshots are excluded', t => {
  const db = database(t);
  for (let id = 1; id <= 8; id++) snapshot(db, { id });
  db.exec(`DELETE FROM index_constituent_weight WHERE snapshot_id=1 AND constituent_code='1.SH';
    UPDATE index_constituent_snapshot SET expected_count=3 WHERE id=2;
    UPDATE index_constituent_snapshot SET weight_sum_pct=90 WHERE id=3;
    UPDATE index_constituent_snapshot SET declared_weight_sum_pct=90 WHERE id=4;
    UPDATE index_constituent_snapshot SET validation_basis='official_full_file' WHERE id=5;
    UPDATE index_constituent_weight SET weight_pct=-1 WHERE snapshot_id=6;
    UPDATE index_constituent_snapshot SET as_of_date='2026-02-31' WHERE id=7;
    UPDATE index_constituent_snapshot SET validation='partial' WHERE id=8;`);
  assert.deepEqual(queryIndexDetail(db, '000300.SH').snapshots, []);
  assert.deepEqual(queryIndexDetail(db, '000300.SH').constituents, { snapshot: null, rows: [] });
  assert.throws(() => queryIndexDetail(db, '000300.SH', { snapshotId: 1 }), IndexSnapshotNotFoundError);
});

test('weights retain provider percentage units and rounding rather than normalizing', t => {
  const db = database(t);
  snapshot(db, { weights: [50.04, 49.99], source: 'cnindex' });
  const result = queryIndexDetail(db, '000300.SH');
  assert.deepEqual(result.constituents.rows.map(r => r.weightPct), [50.04, 49.99]);
  assert.ok(Math.abs(result.constituents.snapshot.weightSumPct - 100.03) < 1e-8);
});

test('related return versions are bidirectional but never borrow constituents', t => {
  const db = database(t); snapshot(db);
  db.exec("INSERT INTO index_return_links VALUES('000300.SH','H00300.CSI')");
  assert.deepEqual(queryIndexDetail(db, '000300.SH').returnLinks, [{ code: 'H00300.CSI', name: '沪深300全收益', returnType: 'total' }]);
  const total = queryIndexDetail(db, 'H00300.CSI');
  assert.equal(total.returnLinks[0].code, '000300.SH');
  assert.equal(total.index.returnType, 'total');
  assert.deepEqual(total.constituents, { snapshot: null, rows: [] });
  assert.throws(() => queryIndexDetail(db, 'H00300.CSI', { snapshotId: 1 }), IndexSnapshotNotFoundError);
});

test('related price codes sharing a verified return version are navigation-only, with no sibling data reuse', t => {
  const db = database(t); snapshot(db);
  db.exec(`INSERT INTO index_basic(ts_code,code,name,index_type) VALUES('399300.SZ','399300','沪深300深市代码','价格指数'),
    ('UNRELATED.CSI','UNRELATED','无关指数','价格指数');
    INSERT INTO index_return_links VALUES('000300.SH','H00300.CSI'),('399300.SZ','H00300.CSI'),('H00300.CSI','H00300.CSI');
    INSERT INTO fund_basic VALUES('000001.OF','000001','深市代码跟踪基金','指数型','公司');
    INSERT INTO index_fund_tracker VALUES('399300.SZ','000001.OF','exact');`);
  const result = queryIndexDetail(db, '000300.SH');
  assert.deepEqual(result.returnLinks.map(r => r.code), ['399300.SZ', 'H00300.CSI']);
  assert.deepEqual(result.trackingFunds, []);
  const sibling = queryIndexDetail(db, '399300.SZ');
  assert.deepEqual(sibling.constituents, { snapshot: null, rows: [] });
  assert.equal(sibling.trackingFunds.length, 1);
  assert.deepEqual(queryIndexDetail(db, 'H00300.CSI').returnLinks.map(r => r.code), ['000300.SH', '399300.SZ']);
});

test('tracking funds are canonical .OF only, deduped, with null for incomplete fee components', t => {
  const db = database(t);
  db.exec(`INSERT INTO fund_basic VALUES('000001.OF','000001','基金A','指数型','公司'),('000001.SH','000001','场内行','ETF','公司'),
    ('000002.OF','000002','基金C','指数型','公司'),('000003.OF','000003','零费率','指数型','公司');
    INSERT INTO fund_meta VALUES('000001.OF',0.005,0.001,0),('000002.OF',0.005,0.001,NULL),('000003.OF',0,0,0);
    INSERT INTO index_fund_tracker VALUES('000300.SH','000001.OF','exact'),('000300.SH','000001.OF','exact'),
      ('000300.SH','000001.SH','exact'),('000300.SH','000002.OF','fuzzy'),('000300.SH','000003.OF','manual');`);
  const funds = queryIndexDetail(db, '000300.SH').trackingFunds;
  assert.deepEqual(funds.map(f => f.code), ['000001', '000002', '000003']);
  assert.equal(funds[0].annualFee, 0.006);
  assert.equal(funds[1].annualFee, null);
  assert.equal(funds[2].annualFee, 0);
  assert.equal(funds[1].matchType, 'fuzzy');
});

test('optional constituent and return tables remain absent after detail/search reads', t => {
  const db = database(t, { optional: false });
  const before = db.prepare('SELECT name FROM sqlite_master ORDER BY name').all();
  const result = queryIndexDetail(db, 'H00300.CSI');
  assert.deepEqual(result.returnLinks, []); assert.deepEqual(result.snapshots, []);
  assert.equal(result.quote, null); assert.deepEqual(result.history, { start: null, end: null, count: 0 });
  assert.deepEqual(queryIndexDetailSearch(db).map(r => r.code), ['000300.SH']);
  assert.deepEqual(db.prepare('SELECT name FROM sqlite_master ORDER BY name').all(), before);
});

test('case resolution preserves stored identity, rejects ambiguity and never drops market suffix', t => {
  const db = database(t);
  db.exec("INSERT INTO index_basic(ts_code,code,name) VALUES('h30590.CSI','h30590','小写主键')");
  assert.equal(queryIndexDetail(db, 'H30590.csi').index.ts_code, 'h30590.CSI');
  assert.equal(queryIndexDetail(db, 'h30590.SH'), null);
  db.exec("INSERT INTO index_basic(ts_code,code,name) VALUES('H30590.CSI','H30590','另一主键')");
  assert.equal(queryIndexDetail(db, 'h30590.csi'), null);
  assert.equal(queryIndexDetail(db, 'h30590.CSI').index.name, '小写主键');
  for (const code of ['000300', '.SH', '000300.SH/other', '../000300.SH', '000300.SH%']) assert.equal(isFullIndexCode(code), false);
});

test('detail search includes daily, tracked-only and verified constituent-only indices', t => {
  const db = database(t);
  db.exec(`INSERT INTO index_basic(ts_code,code,name) VALUES('HSBT.HI','HSBT','恒生生物科技'),('WEIGHT.CSI','WEIGHT','权重独有'),('BAD.CSI','BAD','损坏权重');
    INSERT INTO index_fund_tracker VALUES('HSBT.HI','000001.OF','exact');`);
  snapshot(db, { code: 'WEIGHT.CSI' }); snapshot(db, { id: 2, code: 'BAD.CSI' });
  db.exec('DELETE FROM index_constituent_weight WHERE snapshot_id=2');
  const rows = queryIndexDetailSearch(db);
  assert.deepEqual(rows.map(r => r.code), ['000300.SH', 'HSBT.HI', 'WEIGHT.CSI']);
  assert.equal(rows[0].initials, 'hs300');
  assert.equal(rows[0].kind, 'index');
  assert.equal(rows[0].returnType, 'price');
});

test('HTTP detail dispatch, encoded full code, search path and ETag conditional requests', async t => {
  const db = database(t); snapshot(db);
  const request = await start(t, db);
  const first = await request('/api/index/000300%2ESH');
  assert.equal(first.status, 200); assert.equal(first.body.index.ts_code, '000300.SH');
  assert.match(first.headers.etag, /^W\/"[0-9a-f]+"$/);
  const hit = await request('/api/index/000300.SH', { headers: { 'If-None-Match': first.headers.etag } });
  assert.equal(hit.status, 304); assert.equal(hit.body, null);
  db.exec("UPDATE index_basic SET name='已修改' WHERE ts_code='000300.SH'");
  const changed = await request('/api/index/000300.SH', { headers: { 'If-None-Match': first.headers.etag } });
  assert.equal(changed.status, 200); assert.notEqual(changed.headers.etag, first.headers.etag);
  assert.equal((await request('/api/index/search-index')).body[0].code, '000300.SH');
});

test('HTTP bad codes and snapshot values are rejected before accessing database', async t => {
  let opened = 0;
  const indexRouter = createIndexDetailRouter({ dbFactory: () => { opened++; throw new Error('should not open'); } });
  const request = await start(t, null, { indexRouter });
  for (const path of ['/api/index/000300', '/api/index/%', '/api/index/a%2Fb.SH', '/api/index/000300.SH?snapshot=',
    '/api/index/000300.SH?snapshot=-1', '/api/index/000300.SH?snapshot=1.5', '/api/index/000300.SH?snapshot=9007199254740993']) {
    assert.equal((await request(path)).status, 400, path);
  }
  const method = await request('/api/index/000300.SH', { method: 'POST' });
  assert.equal(method.status, 405); assert.equal(method.headers.allow, 'GET');
  assert.equal((await request('/api/index/search-index', { method: 'POST' })).status, 405);
  assert.equal(opened, 0);
});

test('HTTP missing index, unknown or cross-index snapshot return 404 and errors are no-store', async t => {
  const db = database(t); snapshot(db);
  const request = await start(t, db);
  for (const path of ['/api/index/UNKNOWN.CSI', '/api/index/000300.SH?snapshot=999', '/api/index/H00300.CSI?snapshot=1']) {
    const result = await request(path);
    assert.equal(result.status, 404); assert.equal(result.headers['cache-control'], 'no-store');
  }
  assert.equal((await request('/api/index/000300.SH?snapshot=1')).status, 200);
});
