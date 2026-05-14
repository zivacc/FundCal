/**
 * 基金 / 指数 key 判别 + kind 常量.
 *
 * 命名空间约定 (前后端共用):
 *   - 基金 key: 6 位纯数字 (如 "000300"); 后端拼 ".OF" 取场外
 *   - 指数 key: tushare ts_code 形式 (如 "HSI.HI" / "NDX.GI" / "AU9999.SGE" / "000300.SH")
 *
 * 正向匹配: 优先确认形态而非"非基金即指数". 未知输入 (如 "abc"/"12345") 既非
 * 基金也非指数, 调用方可显式处理或让其报错暴露上游 bug.
 */

export const KIND = Object.freeze({
  FUND: 'fund',
  INDEX: 'index',
});

const FUND_RE = /^\d{6}$/;
const INDEX_RE = /^[A-Z0-9]+\.[A-Z]{2,4}$/i;

/** @param {string} key */
export function isFundCode(key) {
  return typeof key === 'string' && FUND_RE.test(key);
}

/** @param {string} key */
export function isIndexKey(key) {
  return typeof key === 'string' && INDEX_RE.test(key);
}

/**
 * 给定 key 返回 'fund' / 'index' / null. null 表示未识别 — 调用方决定如何处理
 * (一般是抛错或忽略, 不应静默当作某一种).
 *
 * @param {string} key
 * @returns {'fund' | 'index' | null}
 */
export function detectKind(key) {
  if (isFundCode(key)) return KIND.FUND;
  if (isIndexKey(key)) return KIND.INDEX;
  return null;
}
