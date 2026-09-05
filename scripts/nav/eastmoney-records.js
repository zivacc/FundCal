/** Keep the existing adjusted-NAV scale when extending a different provider's history. */
export function buildEastmoneyRecords(code, rawRows, anchor = null) {
  let previous = anchor;
  const records = [];
  const sorted = [...rawRows].sort((a, b) => a.FSRQ.localeCompare(b.FSRQ));
  for (const raw of sorted) {
    const date = String(raw.FSRQ || '').replaceAll('-', '');
    const unit = Number.parseFloat(raw.DWJZ);
    const accum = Number.parseFloat(raw.LJJZ);
    if (!/^\d{8}$/.test(date) || !(unit > 0)) throw new Error(`Invalid NAV: ${code} ${date}`);
    if (previous && date <= previous.end_date) continue;
    let adj = unit;
    if (previous?.unit_nav > 0) {
      // Accumulated NAV minus unit NAV is cumulative cash distributions.
      // Use exact NAV ratios on ordinary days, reported return on split days.
      const dividend = Number.isFinite(accum) && previous.accum_nav != null
        ? accum - unit - (previous.accum_nav - previous.unit_nav) : 0;
      const reported = Number.parseFloat(raw.JZZZL);
      const cashRatio = (unit + Math.max(0, dividend)) / previous.unit_nav;
      const declared = Number.isFinite(reported) ? 1 + reported / 100 : null;
      const ratio = declared != null && Math.abs(cashRatio - declared) > 0.002
        ? declared : cashRatio;
      if (!(ratio > 0)) throw new Error(`Invalid adjusted return: ${code} ${date}`);
      adj = (previous.adj_nav ?? previous.unit_nav) * ratio;
    }
    const row = {
      ts_code: `${code}.OF`, end_date: date, ann_date: null,
      unit_nav: unit, accum_nav: Number.isFinite(accum) ? accum : null,
      accum_div: null, net_asset: null, total_netasset: null, adj_nav: adj, source: 2,
    };
    records.push(row);
    previous = row;
  }
  return records;
}
