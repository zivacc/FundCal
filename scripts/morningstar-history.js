/** Independent reference data; never merge estimates into current contractual fees. */
export function turnoverPercentile(value, peers) {
  const valid = peers.filter(v => Number.isFinite(v) && v >= 0);
  const n = valid.length;
  if (!Number.isFinite(value) || value < 0 || n < 2) return { percentile: null, sampleSize: n };
  const below = valid.filter(v => v < value).length;
  const equal = valid.filter(v => v === value).length;
  return { percentile: Math.round(10000 * (below + equal / 2) / n) / 100, sampleSize: n };
}

export function loadMorningstarHistory(db, code) {
  if (!/^\d{6}$/.test(code)) throw new Error('Invalid fund code');
  const rows = db.prepare(`SELECT s.as_of_date, s.source_file, s.generated_at,
      f.code, f.name, f.morningstar_category, f.total_fee_pct, f.total_fee_rank_pct,
      f.explicit_fee_pct, f.explicit_fee_rank_pct, f.implicit_fee_pct, f.implicit_fee_rank_pct,
      f.turnover_pct, f.category_median_turnover_pct
    FROM morningstar_fee_snapshot s LEFT JOIN morningstar_fund_fee f
      ON f.as_of_date=s.as_of_date AND f.code=? ORDER BY s.as_of_date`).all(code);
  const peers = db.prepare(`SELECT turnover_pct FROM morningstar_fund_fee
    WHERE as_of_date=? AND morningstar_category=? AND turnover_pct >= 0`);
  const periods = rows.map(row => ({ ...row,
    available: row.code != null,
    turnover: turnoverPercentile(row.turnover_pct, row.morningstar_category
      ? peers.all(row.as_of_date, row.morningstar_category).map(p => p.turnover_pct) : []),
  }));
  return { code, source: 'Morningstar 晨星', sourceUrl: `https://www.morningstar.cn/fund/${code}.html`,
    percentileMethod: '(低于本基金的样本数 + 相同值样本数 × 0.5) / 有效样本数 × 100',
    periods };
}
