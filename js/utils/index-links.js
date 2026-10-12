import { isIndexKey } from '../core/code-kind.js';

/** Preserve the database's exact code (including case), not a guessed alias. */
export function indexDetailHref(code) {
  return isIndexKey(code) && !/\.OF$/i.test(code)
    ? `#/index-detail/${encodeURIComponent(code)}`
    : '';
}
