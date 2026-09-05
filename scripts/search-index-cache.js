import { gzipSync } from 'node:zlib';
import { computeETag, ifNoneMatchHits } from './nav/http-cache.js';

/** 每个 DB 连接一份索引快照；外部提交和本连接写入都会使快照失效。 */
export function createSearchIndexStore(getInitials) {
  const snapshots = new WeakMap();
  function snapshot(db) {
    const revision = `${db.pragma('data_version', { simple: true })}:${db.prepare('SELECT total_changes() AS n').get().n}`;
    const previous = snapshots.get(db);
    if (previous?.revision === revision) return previous;
    const rows = db.prepare(`SELECT m.ts_code, m.code, m.source, m.name_crawler, b.name
      FROM fund_meta m LEFT JOIN fund_basic b ON b.ts_code = m.ts_code ORDER BY m.code`).all();
    const items = new Map(), all = [], published = [];
    for (const row of rows) {
      const name = row.name != null && String(row.name).trim() !== '' ? row.name : row.name_crawler || '';
      const old = previous?.items.get(row.ts_code);
      const item = old?.name === name && old.code === row.code ? old : { code: row.code, name, initials: getInitials(name) };
      items.set(row.ts_code, item);
      all.push(item);
      if (['both', 'crawler'].includes(row.source)) published.push(item);
    }
    const current = { revision, items, all, published };
    snapshots.set(db, current);
    return current;
  }
  function response(db) {
    const current = snapshot(db);
    if (!current.response) {
      const body = JSON.stringify(current.published);
      current.response = { body, etag: computeETag(body), gzip: gzipSync(body) };
    }
    return current.response;
  }
  return {
    load: (db, includePlaceholders = false) => snapshot(db)[includePlaceholders ? 'all' : 'published'],
    warm: response,
    send(req, res, db) {
      const { body, etag, gzip } = response(db);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=600, must-revalidate');
      res.setHeader('ETag', etag);
      res.setHeader('Vary', 'Accept-Encoding');
      if (ifNoneMatchHits(req.headers?.['if-none-match'], etag)) { res.writeHead(304); res.end(); return; }
      const encodings = String(req.headers?.['accept-encoding'] || '').toLowerCase().split(',').map(value => value.trim().split(';'));
      const gzipOption = encodings.find(([name]) => name === 'gzip') || encodings.find(([name]) => name === '*');
      const quality = gzipOption?.slice(1).find(param => param.trim().startsWith('q='));
      const compressed = gzipOption && (quality == null || Number(quality.trim().slice(2)) > 0);
      if (compressed) res.setHeader('Content-Encoding', 'gzip');
      const payload = compressed ? gzip : body;
      res.setHeader('Content-Length', Buffer.byteLength(payload));
      res.writeHead(200);
      res.end(payload);
    },
  };
}
