import { pinyin } from 'pinyin-pro';
import { indexReturnType } from '../../js/domain/index-return.js';

const INDEX_FIELDS = 'ts_code,code,name,fullname,publisher,category,market,index_type,base_date,base_point,list_date,weight_rule,description,primary_source';
const SOURCE_PRIORITY = { csindex: 0, cnindex: 0, tushare: 1, wind: 2 };
const VALIDATION_BASIS = { csindex: 'official_full_file', cnindex: 'official_full_file', tushare: 'api_full_result', wind: 'provider_totals' };

export const isFullIndexCode = code => typeof code === 'string' && code.length <= 80 && /^[A-Z0-9][A-Z0-9._-]*\.[A-Z]{1,8}$/i.test(code);
const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const finite = value => typeof value === 'number' && Number.isFinite(value);

export class IndexSnapshotNotFoundError extends Error {}

function findIndex(db, code) {
  if (!hasTable(db, 'index_basic')) return null;
  const exact = db.prepare(`SELECT ${INDEX_FIELDS} FROM index_basic WHERE ts_code=?`).get(code);
  if (exact) return exact;
  // A suffix is part of identity. Only a unique case variant may resolve.
  const variants = db.prepare(`SELECT ${INDEX_FIELDS} FROM index_basic WHERE ts_code=? COLLATE NOCASE LIMIT 2`).all(code);
  return variants.length === 1 ? variants[0] : null;
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

/** Recheck stored totals rather than trusting a 'complete' label after later edits. */
function verifiedSnapshots(db, code = null) {
  if (!hasTable(db, 'index_constituent_snapshot') || !hasTable(db, 'index_constituent_weight')) return [];
  const columns = db.prepare('PRAGMA table_info(index_constituent_snapshot)').all();
  const basis = columns.some(c => c.name === 'validation_basis') ? 's.validation_basis' : "'provider_totals'";
  const scope = code == null ? '' : 'AND s.index_ts_code=?';
  const rows = db.prepare(`SELECT s.id,s.index_ts_code,s.as_of_date,s.source,s.expected_count,s.constituent_count,
      s.weight_sum_pct,s.declared_weight_sum_pct,${basis} validation_basis,
      count(w.constituent_code) actual_count,sum(w.weight_pct) actual_sum,
      sum(CASE WHEN typeof(w.weight_pct) NOT IN ('integer','real') OR w.weight_pct<0 OR w.weight_pct>100
        OR w.constituent_code IS NULL OR w.name IS NULL OR trim(w.constituent_code)='' OR trim(w.name)='' THEN 1 ELSE 0 END) invalid_rows
    FROM index_constituent_snapshot s JOIN index_constituent_weight w ON w.snapshot_id=s.id
    WHERE s.validation='complete' ${scope} GROUP BY s.id`).all(...(code == null ? [] : [code]));
  return rows.filter(r => validDate(r.as_of_date) && Number.isSafeInteger(r.id) && r.id > 0
    && Number.isSafeInteger(r.expected_count) && r.expected_count > 0 && r.expected_count === r.constituent_count
    && r.actual_count === r.constituent_count && r.invalid_rows === 0
    && VALIDATION_BASIS[r.source] === r.validation_basis
    && [r.actual_sum, r.weight_sum_pct, r.declared_weight_sum_pct].every(finite)
    && Math.abs(r.actual_sum - 100) <= 0.100000001
    && Math.abs(r.actual_sum - r.weight_sum_pct) <= 0.001000001
    && Math.abs(r.actual_sum - r.declared_weight_sum_pct) <= 0.001000001)
    .sort((a, b) => b.as_of_date.localeCompare(a.as_of_date)
      || SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source] || a.source.localeCompare(b.source) || b.id - a.id);
}

function publicSnapshot(row) {
  return { id: row.id, asOfDate: row.as_of_date, source: row.source, count: row.constituent_count,
    weightSumPct: row.actual_sum, validationBasis: row.validation_basis };
}

function trackingFunds(db, code) {
  if (!hasTable(db, 'index_fund_tracker') || !hasTable(db, 'fund_basic')) return [];
  const meta = hasTable(db, 'fund_meta');
  const rows = db.prepare(`SELECT b.code,b.ts_code,b.name,b.fund_type,b.management,t.match_type,
      ${meta ? 'm.mgmt_fee,m.custody_fee,m.sales_service_fee' : 'NULL mgmt_fee,NULL custody_fee,NULL sales_service_fee'}
    FROM index_fund_tracker t JOIN fund_basic b ON b.ts_code=t.fund_ts_code
    ${meta ? 'LEFT JOIN fund_meta m ON m.ts_code=b.ts_code' : ''}
    WHERE t.index_ts_code=? AND b.ts_code=b.code||'.OF'
    ORDER BY b.code,b.ts_code`).all(code);
  const unique = new Map();
  for (const row of rows) {
    if (!/^\d{6}$/.test(row.code) || unique.has(row.code)) continue;
    const fees = [row.mgmt_fee, row.custody_fee, row.sales_service_fee];
    unique.set(row.code, { code: row.code, ts_code: row.ts_code, name: row.name || row.code,
      fundType: row.fund_type, management: row.management,
      annualFee: fees.every(f => finite(f) && f >= 0) ? fees.reduce((sum, f) => sum + f, 0) : null,
      matchType: row.match_type });
  }
  return [...unique.values()];
}

function returnLinks(db, code) {
  if (!hasTable(db, 'index_return_links')) return [];
  // Other price codes may share an already-verified return version. Expose a
  // navigation link only; every profile, tracker and weight query remains exact.
  return db.prepare(`SELECT b.ts_code,b.name,b.fullname,b.index_type FROM index_basic b WHERE b.ts_code IN (
      SELECT CASE WHEN l.index_ts_code=? THEN l.return_ts_code ELSE l.index_ts_code END FROM index_return_links l
        WHERE l.index_ts_code=? OR l.return_ts_code=?
      UNION SELECT sibling.index_ts_code FROM index_return_links direct JOIN index_return_links sibling
        ON sibling.return_ts_code=direct.return_ts_code WHERE direct.index_ts_code=?
    ) AND b.ts_code<>? ORDER BY b.ts_code`).all(code, code, code, code, code)
    .map(row => ({ code: row.ts_code, name: row.name || row.ts_code, returnType: indexReturnType(row) }));
}

/** Public detail DTO; never returns local receipts, source payloads or filesystem paths. */
function readIndexDetail(db, code, { snapshotId = null } = {}) {
  const basic = findIndex(db, code);
  if (!basic) return null;
  const tsCode = basic.ts_code;
  const allSnapshots = verifiedSnapshots(db, tsCode);
  const selected = snapshotId == null ? allSnapshots[0] : allSnapshots.find(row => row.id === snapshotId);
  if (snapshotId != null && !selected) throw new IndexSnapshotNotFoundError('Snapshot not found');
  const daily = hasTable(db, 'index_daily');
  const quote = daily ? db.prepare('SELECT end_date,close,pct_chg,source FROM index_daily WHERE ts_code=? ORDER BY end_date DESC LIMIT 1').get(tsCode) : null;
  const history = daily ? db.prepare('SELECT min(end_date) start,max(end_date) end,count(*) count FROM index_daily WHERE ts_code=?').get(tsCode) : { start: null, end: null, count: 0 };
  return { index: { ...basic, returnType: indexReturnType(basic) }, quote: quote || null, history,
    returnLinks: returnLinks(db, tsCode), trackingFunds: trackingFunds(db, tsCode),
    snapshots: allSnapshots.map(publicSnapshot), constituents: {
      snapshot: selected ? publicSnapshot(selected) : null,
      rows: selected ? db.prepare(`SELECT constituent_code code,name,weight_pct weightPct FROM index_constituent_weight
        WHERE snapshot_id=? ORDER BY weight_pct DESC,constituent_code`).all(selected.id) : [],
    } };
}

export function queryIndexDetail(db, code, options = {}) {
  // Validation and the displayed rows must come from the same read snapshot,
  // even if an independent data importer commits during this request.
  return db.transaction(() => readIndexDetail(db, code, options))();
}

/** Detail discovery includes tracked and constituent-only indices, unlike the NAV comparison pool. */
function readIndexDetailSearch(db) {
  if (!hasTable(db, 'index_basic')) return [];
  const conditions = [];
  if (hasTable(db, 'index_daily')) conditions.push('EXISTS(SELECT 1 FROM index_daily d WHERE d.ts_code=b.ts_code)');
  if (hasTable(db, 'index_fund_tracker')) conditions.push('EXISTS(SELECT 1 FROM index_fund_tracker t WHERE t.index_ts_code=b.ts_code)');
  const snapshots = verifiedSnapshots(db);
  conditions.push('b.ts_code IN (SELECT value FROM json_each(?))');
  const rows = db.prepare(`SELECT b.ts_code,b.name,b.fullname,b.index_type FROM index_basic b
    WHERE ${conditions.join(' OR ')} ORDER BY b.ts_code`).all(JSON.stringify([...new Set(snapshots.map(s => s.index_ts_code))]));
  return rows.map(row => ({ code: row.ts_code, name: row.name || row.ts_code, fullname: row.fullname || '',
    initials: pinyin(row.name || '', { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase(),
    kind: 'index', index_type: row.index_type, returnType: indexReturnType(row), isPrice: indexReturnType(row) === 'price' }));
}

export function queryIndexDetailSearch(db) {
  return db.transaction(() => readIndexDetailSearch(db))();
}
