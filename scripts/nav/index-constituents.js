import { createHash } from 'node:crypto';
import { windTables } from './wind-index-data.js';

export function ensureIndexConstituents(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS index_constituent_snapshot (
    id INTEGER PRIMARY KEY,
    index_ts_code TEXT NOT NULL REFERENCES index_basic(ts_code),
    as_of_date TEXT NOT NULL,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    expected_count INTEGER NOT NULL CHECK(expected_count > 0),
    constituent_count INTEGER NOT NULL CHECK(constituent_count = expected_count),
    weight_sum_pct REAL NOT NULL,
    declared_weight_sum_pct REAL NOT NULL,
    validation TEXT NOT NULL CHECK(validation = 'complete'),
    receipt_sha256 TEXT NOT NULL,
    receipt_path TEXT NOT NULL,
    UNIQUE(index_ts_code, as_of_date, source)
  );
  CREATE TABLE IF NOT EXISTS index_constituent_weight (
    snapshot_id INTEGER NOT NULL REFERENCES index_constituent_snapshot(id) ON DELETE CASCADE,
    constituent_code TEXT NOT NULL,
    name TEXT NOT NULL,
    weight_pct REAL NOT NULL CHECK(weight_pct >= 0 AND weight_pct <= 100),
    PRIMARY KEY(snapshot_id, constituent_code)
  );
  CREATE INDEX IF NOT EXISTS idx_constituent_code ON index_constituent_weight(constituent_code);
  CREATE INDEX IF NOT EXISTS idx_constituent_snapshot_date ON index_constituent_snapshot(index_ts_code, as_of_date DESC);`);
  if (!db.prepare('PRAGMA table_info(index_constituent_snapshot)').all().some(c => c.name === 'validation_basis')) {
    db.exec("ALTER TABLE index_constituent_snapshot ADD COLUMN validation_basis TEXT NOT NULL DEFAULT 'provider_totals' CHECK(validation_basis IN ('provider_totals','official_full_file'))");
  }
}

export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}

function number(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value))) throw new Error('Missing or invalid numeric value');
  return Number(value);
}

export function constituentTotals(response) {
  const tables = windTables(response);
  const counts = [], sums = [];
  // Summary tables must be scalar; never mistake a single constituent for a total.
  for (const t of tables) {
    if (t.columns.length !== 1 || t.rows.length !== 1) continue;
    const c = t.columns[0];
    if (/成[份分].*(数量|总数|个数)|总成[份分]数/.test(c.name)) counts.push(number(t.rows[0][0]));
    if (/权重.*(合计|总和)|实际总权重$/.test(c.name)) {
      if (c.unit !== '%') throw new Error('Unknown total weight unit');
      sums.push(number(t.rows[0][0]));
    }
  }
  if (!counts.length || new Set(counts).size !== 1 || !Number.isSafeInteger(counts[0]) || counts[0] < 1) throw new Error('Missing or conflicting constituent count');
  if (!sums.length || new Set(sums).size !== 1) throw new Error('Missing or conflicting total weight');
  return { expectedCount: counts[0], declaredSum: sums[0] };
}

/** Only complete, same-date, same-index, explicitly percentage-valued snapshots pass. */
export function normalizeConstituents(response, indexCode, end, totalsResponse = response) {
  if (!validDate(end)) throw new Error('Invalid end date');
  const { expectedCount, declaredSum } = constituentTotals(totalsResponse);
  const rows = new Map(), dates = new Set();
  for (const t of windTables(response)) {
    const code = t.columns.find(c => /^指数成[份分]代码$/.test(c.name));
    if (!code) continue;
    const name = t.columns.find(c => /^指数成[份分]简称$/.test(c.name));
    const weights = t.columns.filter(c => /成[份分]权重(?:单位)?$/.test(c.name));
    if (!name || weights.length !== 1 || weights[0].unit !== '%') throw new Error('Missing constituent columns or unknown weight unit');
    for (const r of t.records) {
      if (String(r['Wind代码']).toUpperCase() !== indexCode.toUpperCase()) throw new Error('Wrong index identity');
      const date = r['日期'];
      if (!validDate(date) || date > end) throw new Error('Invalid or future weight date');
      dates.add(date);
      const security = r[code.name];
      if (typeof security !== 'string' || !/^[A-Z0-9][A-Z0-9._-]*\.[A-Z]{1,8}$/i.test(security) || typeof r[name.name] !== 'string' || !r[name.name].trim()) throw new Error('Invalid constituent identity');
      const row = { code: security.toUpperCase(), name: r[name.name], weight_pct: number(r[weights[0].name]) };
      if (row.weight_pct < 0 || row.weight_pct > 100) throw new Error('Invalid weight');
      if (rows.has(row.code) && JSON.stringify(rows.get(row.code)) !== JSON.stringify(row)) throw new Error('Conflicting duplicate constituent');
      rows.set(row.code, row);
    }
  }
  if (dates.size !== 1) throw new Error('Missing or mixed snapshot dates');
  const asOfDate = [...dates][0];
  for (const t of windTables(totalsResponse)) {
    if (t.columns.length !== 1 || t.rows.length !== 1) continue;
    const match = t.columns[0].name.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (match && `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}` !== asOfDate) throw new Error('Summary and constituents date mismatch');
  }
  if (rows.size !== expectedCount) throw new Error(`Incomplete constituents: ${rows.size}/${expectedCount}`);
  const sorted = [...rows.values()].sort((a,b) => a.code.localeCompare(b.code));
  const sum = sorted.reduce((s,r) => s + r.weight_pct, 0);
  // Conservative acceptance; do not normalize incomplete or leveraged portfolios to 100%.
  if (Math.abs(sum - 100) > 0.1 || Math.abs(sum - declaredSum) > 0.001) throw new Error(`Weight sum mismatch: ${sum}/${declaredSum}`);
  return { indexCode, asOfDate, expectedCount, declaredSum, weightSum: sum, rows: sorted };
}

export function insertConstituentSnapshot(db, snapshot, { receipt, receiptPath, fetchedAt, source = 'wind' }) {
  // Revalidate the normalized boundary too, so callers cannot bypass completeness checks.
  const { indexCode, asOfDate, expectedCount, declaredSum, rows } = snapshot;
  const basis = snapshot.validationBasis || 'provider_totals';
  if (!['wind','csindex','cnindex'].includes(source) || basis !== (source === 'wind' ? 'provider_totals' : 'official_full_file')) throw new Error('Invalid source or validation basis');
  if (!validDate(asOfDate) || !Number.isSafeInteger(expectedCount) || expectedCount < 1 || rows.length !== expectedCount || new Set(rows.map(r=>r.code)).size !== expectedCount) throw new Error('Invalid snapshot');
  if (!receiptPath || !receipt || !Number.isFinite(Date.parse(fetchedAt))) throw new Error('Missing provenance');
  if (rows.some(r=>typeof r.weight_pct !== 'number' || !Number.isFinite(r.weight_pct) || r.weight_pct < 0 || r.weight_pct > 100 || !r.code || !r.name)) throw new Error('Invalid weight row');
  const sum = rows.reduce((s,r)=>s+r.weight_pct,0);
  if (!Number.isFinite(declaredSum) || Math.abs(sum-100)>0.1 || Math.abs(sum-declaredSum)>0.001) throw new Error('Invalid weight sum');
  return db.transaction(() => {
    const old = db.prepare('SELECT * FROM index_constituent_snapshot WHERE index_ts_code=? AND as_of_date=? AND source=?').get(indexCode,asOfDate,source);
    if (old) {
      const existing = db.prepare('SELECT constituent_code code,name,weight_pct FROM index_constituent_weight WHERE snapshot_id=? ORDER BY constituent_code').all(old.id);
      const ordered = [...rows].sort((a,b)=>a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
      if (old.constituent_count !== expectedCount || JSON.stringify(existing)!==JSON.stringify(ordered)) throw new Error('Existing snapshot conflict; explicit revision review required');
      return { id: old.id, inserted: 0 };
    }
    const result=db.prepare(`INSERT INTO index_constituent_snapshot(index_ts_code,as_of_date,source,fetched_at,expected_count,constituent_count,weight_sum_pct,declared_weight_sum_pct,validation,receipt_sha256,receipt_path,validation_basis)
      VALUES(?,?,?,?,?,?,?,?,'complete',?,?,?)`).run(indexCode,asOfDate,source,fetchedAt,expectedCount,rows.length,sum,declaredSum,createHash('sha256').update(receipt).digest('hex'),receiptPath,basis);
    const add=db.prepare('INSERT INTO index_constituent_weight(snapshot_id,constituent_code,name,weight_pct) VALUES(?,?,?,?)');
    for (const r of rows) add.run(result.lastInsertRowid,r.code,r.name,r.weight_pct);
    return { id: Number(result.lastInsertRowid), inserted: rows.length };
  })();
}
