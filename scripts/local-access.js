/** 抓取仅允许本机直连。Tunnel 同样来自 loopback，必须同时验证 Host、Origin 和代理标记。 */
export function isLocalManagementRequest(req) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) return false;
  const headers = req.headers || {};
  if (Object.keys(headers).some(key => /^(?:forwarded|x-forwarded-.*|cf-.*)$/i.test(key))) return false;
  const isLocalHost = value => /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(value || '');
  if (!isLocalHost(headers.host)) return false;
  if (headers['sec-fetch-site'] === 'cross-site') return false;
  if (headers.origin) {
    try {
      const origin = new URL(headers.origin);
      if (!['http:', 'https:'].includes(origin.protocol) || !isLocalHost(origin.host)) return false;
    } catch { return false; }
  }
  return true;
}
