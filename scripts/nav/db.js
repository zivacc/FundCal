/**
 * SQLite database module — connection, schema init, and helpers.
 * Database file: data/fundcal.db (relative to project root).
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'fundcal.db');

let _db = null;

export function getDb() {
  if (_db) return _db;

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');

  initSchema(_db);
  return _db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fund_basic (
      ts_code    TEXT PRIMARY KEY,
      code       TEXT NOT NULL,
      name       TEXT,
      management TEXT,
      custodian  TEXT,
      fund_type  TEXT,
      found_date TEXT,
      status     TEXT,
      market     TEXT,
      benchmark  TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_fund_basic_code ON fund_basic(code);
    CREATE INDEX IF NOT EXISTS idx_fund_basic_type ON fund_basic(fund_type);

    CREATE TABLE IF NOT EXISTS fund_nav (
      ts_code        TEXT NOT NULL,
      end_date       TEXT NOT NULL,
      ann_date       TEXT,
      unit_nav       REAL,
      accum_nav      REAL,
      accum_div      REAL,
      net_asset      REAL,
      total_netasset REAL,
      adj_nav        REAL,
      PRIMARY KEY (ts_code, end_date)
    );
    CREATE INDEX IF NOT EXISTS idx_fund_nav_date ON fund_nav(end_date);

    CREATE TABLE IF NOT EXISTS sync_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ts_code       TEXT,
      api_name      TEXT NOT NULL,
      status        TEXT NOT NULL,
      record_count  INTEGER DEFAULT 0,
      started_at    TEXT,
      finished_at   TEXT,
      error_message TEXT
    );
  `);
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Convert a 6-digit fund code to Tushare ts_code.
 * Looks up fund_basic first; falls back to .OF (open-end fund).
 */
export function codeToTsCode(code) {
  const db = getDb();
  const row = db.prepare('SELECT ts_code FROM fund_basic WHERE code = ?').get(code);
  if (row) return row.ts_code;
  return `${code}.OF`;
}

/**
 * Resolve multiple 6-digit codes to ts_codes.
 * Returns Map<code, ts_code>.
 */
export function codesToTsCodes(codes) {
  const db = getDb();
  const result = new Map();
  const stmt = db.prepare('SELECT code, ts_code FROM fund_basic WHERE code = ?');
  for (const code of codes) {
    const row = stmt.get(code);
    result.set(code, row ? row.ts_code : `${code}.OF`);
  }
  return result;
}

/**
 * Get the latest end_date in fund_nav for a given ts_code.
 * Returns null if no records exist.
 */
export function getLatestNavDate(tsCode) {
  const db = getDb();
  const row = db.prepare(
    'SELECT end_date FROM fund_nav WHERE ts_code = ? ORDER BY end_date DESC LIMIT 1'
  ).get(tsCode);
  return row ? row.end_date : null;
}

/**
 * Bulk upsert fund_nav records inside a transaction.
 */
export function upsertNavRecords(rows) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO fund_nav
      (ts_code, end_date, ann_date, unit_nav, accum_nav, accum_div, net_asset, total_netasset, adj_nav)
    VALUES
      (@ts_code, @end_date, @ann_date, @unit_nav, @accum_nav, @accum_div, @net_asset, @total_netasset, @adj_nav)
  `);
  const tx = db.transaction((records) => {
    for (const r of records) stmt.run(r);
  });
  tx(rows);
}

/**
 * Bulk upsert fund_basic records inside a transaction.
 */
export function upsertFundBasicRecords(rows) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO fund_basic
      (ts_code, code, name, management, custodian, fund_type, found_date, status, market, benchmark, updated_at)
    VALUES
      (@ts_code, @code, @name, @management, @custodian, @fund_type, @found_date, @status, @market, @benchmark, datetime('now'))
  `);
  const tx = db.transaction((records) => {
    for (const r of records) stmt.run(r);
  });
  tx(rows);
}

/**
 * Insert a sync_log entry.
 */
export function logSync({ ts_code, api_name, status, record_count = 0, started_at, finished_at, error_message = null }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO sync_log (ts_code, api_name, status, record_count, started_at, finished_at, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(ts_code, api_name, status, record_count, started_at, finished_at, error_message);
}

export { DB_PATH };
