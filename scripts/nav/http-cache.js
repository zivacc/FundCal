/**
 * HTTP 缓存与条件请求工具，nav-api / fund-api 共用。
 *
 * - computeETag(body): FNV-1a 32-bit weak ETag
 * - ifNoneMatchHits(headerVal, etag): 处理多值/通配/weak-strong 等价
 * - jsonCached(req, res, data, opts): 序列化一次 + 304 短路 + max-age
 */

/**
 * @param {string} body
 * @returns {string} 形如 `W/"af7c2b13"`，含引号
 */
export function computeETag(body) {
  let h = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `W/"${(h >>> 0).toString(16).padStart(8, '0')}"`;
}

/**
 * @param {string|undefined} headerVal
 * @param {string} etag
 * @returns {boolean}
 */
export function ifNoneMatchHits(headerVal, etag) {
  if (!headerVal || !etag) return false;
  const norm = (s) => s.trim().replace(/^W\//, '');
  const target = norm(etag);
  for (const part of headerVal.split(',')) {
    const p = part.trim();
    if (p === '*') return true;
    if (norm(p) === target) return true;
  }
  return false;
}

/**
 * 发送可缓存 JSON：序列化 → ETag → 命中 If-None-Match 则 304，否则 200。
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {any} data
 * @param {{ maxAge?: number, scope?: 'private'|'public' }} [opts]
 */
export function jsonCached(req, res, data, opts = {}) {
  const { maxAge = 60, scope = 'private' } = opts;
  const body = JSON.stringify(data);
  const etag = computeETag(body);
  const cc = `${scope}, max-age=${maxAge}, must-revalidate`;

  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', cc);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (ifNoneMatchHits(req.headers && req.headers['if-none-match'], etag)) {
    res.writeHead(304);
    res.end();
    return;
  }

  res.writeHead(200);
  res.end(body);
}
