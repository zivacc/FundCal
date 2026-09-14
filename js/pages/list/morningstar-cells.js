/** Morningstar values already use percent units, unlike current fractional rates. */
export function renderMorningstarCells(reference) {
  const percent = value => Number.isFinite(value) ? `${value.toFixed(2)}%` : '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(reference?.asOfDate || '') ? reference.asOfDate : '—';
  return `<td class="cached-fund-ms-value">${percent(reference?.implicitFeePct)}</td>
    <td class="cached-fund-ms-value">${percent(reference?.totalFeePct)}</td>
    <td class="cached-fund-ms-date">${date}</td>`;
}
