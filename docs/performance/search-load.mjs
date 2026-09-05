/** 本地 HTTP 微基准；SQL 只读连接，比较查询在同一读事务中执行。 */
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { pinyin } from 'pinyin-pro';
import { createSearchIndexStore } from '../../scripts/search-index-cache.js';
import { buildListQuery, parseListParams } from '../../scripts/list-query.js';

const http = [];
for (const path of ['/api/fund/search-index', '/api/fund/list?page=1&size=30&q=hs300', '/api/fund/list?page=1&size=30&q=000001']) {
  let etag;
  for (let i = 0; i < 4; i++) {
    const start = performance.now();
    const response = await fetch('http://127.0.0.1:3457' + path, { headers: { 'Accept-Encoding': 'gzip', ...(i === 3 ? { 'If-None-Match': etag } : {}) } });
    const headersMs = performance.now() - start;
    const body = await response.text();
    etag = response.headers.get('etag');
    http.push({ path, i, status: response.status, headersMs: +headersMs.toFixed(2), totalMs: +(performance.now() - start).toFixed(2),
      decodedBytes: Buffer.byteLength(body), contentLength: response.headers.get('content-length'), encoding: response.headers.get('content-encoding') });
  }
}
const db = new Database(fileURLToPath(new URL('../../data/fundcal.db', import.meta.url)), { readonly: true, fileMustExist: true });
const comparisons = db.transaction(() => {
  const store = createSearchIndexStore(name => pinyin(name, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase());
  const searchIndex = store.load(db, true);
  return [
    { q: 'hs300', size: '30' }, { q: 'hs300', size: '30', page: '2' }, { q: '000001' }, { q: '不存在的基金名字' },
    { q: '沪深', sort: 'annualFee:desc' }, { q: '沪深', buyFeeMax: '0.01' }, { q: '沪深', source: 'tushare' },
  ].map(qs => {
    const query = buildListQuery({ ...parseListParams(qs), searchIndex });
    const oldJoin = sql => sql.replace('FROM json_each(?) search_match CROSS JOIN fund_meta m INDEXED BY idx_fund_meta_code ON m.code = search_match.value',
      'FROM fund_meta m JOIN json_each(?) search_match ON search_match.value = m.code');
    const before = performance.now();
    const oldRows = db.prepare(oldJoin(query.sql)).all(...query.params);
    const oldCount = db.prepare(oldJoin(query.countSql)).get(...query.params).n;
    const beforeMs = performance.now() - before;
    const after = performance.now();
    const rows = db.prepare(query.sql).all(...query.params);
    const count = db.prepare(query.countSql).get(...query.params).n;
    const afterMs = performance.now() - after;
    const same = JSON.stringify(oldRows) === JSON.stringify(rows) && oldCount === count;
    if (!same) throw new Error('Query behavior changed: ' + JSON.stringify(qs));
    return { qs, count, rows: rows.length, same, beforeMs: +beforeMs.toFixed(2), afterMs: +afterMs.toFixed(2),
      plan: db.prepare('EXPLAIN QUERY PLAN ' + query.sql).all(...query.params).map(row => row.detail) };
  });
})();
db.close();
console.log(JSON.stringify({ at: new Date().toISOString(), node: process.version,
  note: 'Local serial samples, not browser input-to-render or public Cloudflare latency. Server warms the search index on startup; the first request may overlap warmup. SQL-only timings exclude JS matching.', http, comparisons }, null, 2));
