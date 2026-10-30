/**
 * Index rebalancing turnover and snapshot weight-change proxies are separate.
 * S&P Index Mathematics, “Index Turnover”, excludes market-price drift:
 * https://www.spglobal.com/spdji/en/documents/methodologies/methodology-index-math.pdf
 * Existing month-end holdings cannot recreate that event-level calculation.
 */
export const TURNOVER_METHOD_URL = 'https://www.spglobal.com/spdji/en/documents/methodologies/methodology-index-math.pdf';
const VALID_SOURCES = new Set(['csindex', 'cnindex', 'tushare']);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const missing = reason => ({ status: 'unavailable', valuePct: null, reason });

function weights(snapshot) {
  if (!Array.isArray(snapshot?.rows) || !snapshot.rows.length || snapshot.rows.length !== snapshot.count) return null;
  const values = new Map();
  for (const row of snapshot.rows) {
    if (typeof row.code !== 'string' || !row.code.trim() || values.has(row.code)
      || !finite(row.weightPct) || row.weightPct < 0 || row.weightPct > 100) return null;
    values.set(row.code, row.weightPct);
  }
  const sum = [...values.values()].reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > .100000001) return null;
  return { values, sum };
}

/** Percentage inputs remain percentage outputs; raw source weights are not normalized. */
export function estimateIndexWeightChange(previous, current) {
  if (!current) return missing('no_current_snapshot');
  if (!VALID_SOURCES.has(current.source)) return missing('unverified_effective_date');
  if (!previous) return missing('no_previous_same_source');
  if (typeof current.indexCode !== 'string' || !current.indexCode.trim()
    || previous.indexCode !== current.indexCode || previous.source !== current.source) return missing('incompatible_snapshots');
  if (!validDate(previous.asOfDate) || !validDate(current.asOfDate) || previous.asOfDate >= current.asOfDate) return missing('invalid_dates');
  const before = weights(previous), after = weights(current);
  if (!before || !after) return missing('invalid_weights');
  const codes = new Set([...before.values.keys(), ...after.values.keys()]);
  let totalChange = 0, added = 0, removed = 0;
  for (const code of codes) {
    totalChange += Math.abs((after.values.get(code) ?? 0) - (before.values.get(code) ?? 0));
    if (!before.values.has(code)) added++;
    if (!after.values.has(code)) removed++;
  }
  return { status: 'available', valuePct: totalChange / 2, method: 'half_absolute_snapshot_weight_change',
    priceAdjusted: false, annualized: false, normalized: false, source: current.source,
    from: { id: previous.id, asOfDate: previous.asOfDate, count: previous.count, weightSumPct: before.sum },
    to: { id: current.id, asOfDate: current.asOfDate, count: current.count, weightSumPct: after.sum },
    addedCount: added, removedCount: removed };
}

/** Explicit import contract for a future verified disclosure feed. Never called by GET readers. */
export function ensureIndexTurnoverSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS index_turnover_disclosure (
    index_ts_code TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    turnover_pct REAL NOT NULL CHECK(turnover_pct >= 0),
    convention TEXT NOT NULL CHECK(convention IN ('one_way','two_way','provider_defined')),
    annualized INTEGER NOT NULL CHECK(annualized IN (0,1)),
    definition TEXT NOT NULL,
    source TEXT NOT NULL,
    source_url TEXT NOT NULL,
    published_at TEXT NOT NULL,
    validation TEXT NOT NULL CHECK(validation = 'verified'),
    PRIMARY KEY(index_ts_code,period_start,period_end,source,convention)
  )`);
}

export function publicTurnoverDisclosure(row, indexCode) {
  if (!row || row.index_ts_code !== indexCode || row.validation !== 'verified'
    || !validDate(row.period_start) || !validDate(row.period_end) || row.period_start > row.period_end
    || !validDate(row.published_at) || row.published_at < row.period_end
    || !finite(row.turnover_pct) || row.turnover_pct < 0
    || !['one_way', 'two_way', 'provider_defined'].includes(row.convention)
    || ![0, 1].includes(row.annualized)
    || ![row.definition, row.source].every(value => typeof value === 'string' && value.trim())) return null;
  let url;
  try { url = new URL(row.source_url); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return { valuePct: row.turnover_pct, periodStart: row.period_start, periodEnd: row.period_end,
    convention: row.convention, annualized: row.annualized === 1, definition: row.definition,
    source: row.source, sourceUrl: url.href, publishedAt: row.published_at };
}

export function readIndexTurnoverDisclosure(db, indexCode) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='index_turnover_disclosure'").get()) return null;
  const rows = db.prepare(`SELECT index_ts_code,period_start,period_end,turnover_pct,convention,annualized,
    definition,source,source_url,published_at,validation FROM index_turnover_disclosure
    WHERE index_ts_code=? AND validation='verified' ORDER BY period_end DESC,published_at DESC,source`).all(indexCode);
  return rows.map(row => publicTurnoverDisclosure(row, indexCode)).find(Boolean) || null;
}
