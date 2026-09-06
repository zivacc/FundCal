/** 晨星快照使用百分数，计算器使用小数费率。缺失/负值不作为零费用。 */
export function normalizeImplicitReference(value, code) {
  if (!value || value.code !== code || !/^\d{6}$/.test(code) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Number.isFinite(value.rate) || value.rate < 0) return null;
  return { code, date: value.date, rate: value.rate };
}
export function latestImplicitReference(history, code) {
  if (history?.code !== code) return null;
  const periods = (history.periods || []).filter(p => p.available && Number.isFinite(p.implicit_fee_pct) && p.implicit_fee_pct >= 0)
    .sort((a, b) => String(b.as_of_date).localeCompare(String(a.as_of_date)));
  for (const p of periods) {
    const reference = normalizeImplicitReference({ code, date: p.as_of_date, rate: p.implicit_fee_pct / 100 }, code);
    if (reference) return reference;
  }
  return null;
}
export function effectiveAnnualFee(fund) {
  const implicit = Number.isFinite(fund.implicitFee) && fund.implicitFee >= 0 ? fund.implicitFee : 0;
  return (fund.annualFee ?? 0) + implicit;
}
