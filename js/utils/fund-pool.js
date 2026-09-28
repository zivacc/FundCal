// null = 全库；[] = 明确的空池。空值/无效代码不能扩大查询范围。
export function normalizePoolCodes(value) {
  if (value == null) return null;
  const codes = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(codes.map(code => String(code).trim()).filter(code => /^\d{6}$/.test(code)))].slice(0, 200);
}

export function restrictFundPool(rows, codes) {
  const pool = normalizePoolCodes(codes);
  if (pool === null) return rows;
  const allowed = new Set(pool);
  return rows.filter(row => allowed.has(row.code));
}
