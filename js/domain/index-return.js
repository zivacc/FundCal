/** Prefer a verified provider definition over a name-based fallback. */
export function indexReturnType(row) {
  const explicit = row.index_type || row['收益处理方式'];
  if (explicit === '全收益指数') return 'total';
  if (explicit === '净收益指数') return 'net';
  if (explicit === '全价指数') return 'full_price';
  if (explicit === '价格指数') return 'price';
  const text = `${row.fullname || row['证券全称'] || ''} ${row.name || row['证券简称'] || ''}`;
  if (/净收益/.test(text)) return 'net';
  if (/全收益/.test(text)) return 'total';
  return 'price';
}

export function indexReturnLabel(row) {
  return {total:'全收益',net:'净收益',full_price:'全价',price:'价格'}[row.returnType]
    || (row.isPrice ? '价格' : '');
}

/** Local archives may store an English full name and the official Chinese name. */
export function profileMatchesIndex(index, profile) {
  if(!profile?.['证券全称']) return false;
  if(String(index.ts_code).toUpperCase()!==String(profile['Wind代码']).toUpperCase()) return false;
  return !index.fullname || index.fullname===profile['证券全称'] || index.name===profile['证券全称']
    || Boolean(index.name && index.name===profile['证券简称']);
}
