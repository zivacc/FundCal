/** Stored index/fund references only; never infer an index code from a display name. */
export function loadTrackingIndexMap(db, { fundCode } = {}) {
  const links = new Map();
  if (fundCode != null && !/^\d{6}$/.test(String(fundCode))) return links;
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'
    AND name IN ('index_fund_tracker','index_basic')`).all();
  if (tables.length !== 2) return links;

  const filter = fundCode == null ? "t.fund_ts_code GLOB '[0-9][0-9][0-9][0-9][0-9][0-9].OF'" : 't.fund_ts_code = ?';
  const rows = db.prepare(`SELECT t.fund_ts_code, t.index_ts_code AS code,
      COALESCE(NULLIF(b.name,''), t.index_ts_code) AS name, t.match_type AS matchType
    FROM index_fund_tracker t JOIN index_basic b ON b.ts_code = t.index_ts_code
    WHERE ${filter} ORDER BY t.fund_ts_code, t.index_ts_code`).all(...(fundCode == null ? [] : [`${fundCode}.OF`]));
  for (const row of rows) {
    if (!links.has(row.fund_ts_code)) links.set(row.fund_ts_code, []);
    const refs = links.get(row.fund_ts_code);
    if (!refs.some(ref => ref.code === row.code)) {
      refs.push({ code: row.code, name: row.name, matchType: row.matchType || null });
    }
  }
  return links;
}

/** Group existing fund references by the exact tracking label used by fund stats. */
export function groupTrackingIndexes(rows, linksByFund) {
  const groups = new Map();
  for (const row of rows) {
    const label = String(row.tracking_target || '').trim();
    if (!label || label.includes('该基金无跟踪标的')) continue;
    const refs = linksByFund.get(row.ts_code) || [];
    if (!groups.has(label)) groups.set(label, new Map());
    const group = groups.get(label);
    for (const ref of refs) group.set(ref.code, { code: ref.code, name: ref.name });
  }
  return new Map([...groups].map(([label, group]) => [label, [...group.values()].sort((a, b) => a.code.localeCompare(b.code))]));
}
