export function detailDropCode(mode, items) {
  const code = /^fund:(\d{6})$/.exec(mode || '')?.[1];
  return code && items.some(item => item.code === code) ? code : null;
}
