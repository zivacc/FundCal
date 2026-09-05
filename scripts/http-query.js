/** 查询参数格式错误与业务执行错误分开处理。 */
export class InvalidQueryError extends Error {
  constructor() {
    super('Invalid query encoding');
    this.name = 'InvalidQueryError';
  }
}

/** 按标准表单编码解析查询：+ 为空格，保留值中的 =，重复参数取最后一项。 */
export function parseQuery(url = '') {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const query = url.slice(idx + 1);
  // URLSearchParams 会静默替换错误 UTF-8；先拒绝损坏的编码，避免错误查询。
  try { decodeURIComponent(query); }
  catch { throw new InvalidQueryError(); }
  return Object.fromEntries(new URLSearchParams(query));
}
