import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { parseQuery } from '../http-query.js';
import { jsonCached } from './http-cache.js';
import { isFullIndexCode, queryIndexDetail, queryIndexDetailSearch, IndexSnapshotNotFoundError } from './index-detail-query.js';

const DB_PATH = fileURLToPath(new URL('../../data/fundcal.db', import.meta.url));

function readonlyFactory() {
  let db;
  return () => {
    if (!db) {
      db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
      db.pragma('busy_timeout = 5000');
    }
    return db;
  };
}

function json(res, status, error) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(status);
  res.end(JSON.stringify({ error }));
}

/** GET-only reader. A missing optional table remains missing; no schema initialization. */
export function createIndexDetailRouter({ dbFactory = readonlyFactory() } = {}) {
  return function indexRouter(req, res) {
    const path = (req.url || '').split('?')[0];
    const search = /^\/api\/index\/search-index\/?$/.test(path);
    const match = path.match(/^\/api\/index\/([^/]+)\/?$/);
    if (!search && !match) return false;
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      json(res, 405, 'Method Not Allowed');
      return true;
    }
    const query = req.query ?? parseQuery(req.url);
    if (search) {
      jsonCached(req, res, queryIndexDetailSearch(dbFactory()), { maxAge: 300 });
      return true;
    }
    let code;
    try { code = decodeURIComponent(match[1]); }
    catch { json(res, 400, 'Invalid index code'); return true; }
    if (!isFullIndexCode(code)) { json(res, 400, 'Invalid index code'); return true; }
    let snapshotId = null;
    if (Object.hasOwn(query, 'snapshot')) {
      if (!/^[1-9]\d*$/.test(query.snapshot) || !Number.isSafeInteger(Number(query.snapshot))) {
        json(res, 400, 'Invalid snapshot');
        return true;
      }
      snapshotId = Number(query.snapshot);
    }
    try {
      const detail = queryIndexDetail(dbFactory(), code, { snapshotId });
      if (!detail) json(res, 404, 'Index not found');
      else jsonCached(req, res, detail, { maxAge: 300 });
    } catch (error) {
      if (!(error instanceof IndexSnapshotNotFoundError)) throw error;
      json(res, 404, 'Snapshot not found');
    }
    return true;
  };
}
