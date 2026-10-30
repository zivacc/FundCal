/** Bounded public-page reads shared by the optional disclosure adapters. */
export const FUND_PAGE_SOURCE = '天天基金 / 东方财富 Choice';
export const fundPageUrl = code => `https://fund.eastmoney.com/${code}.html`;
export const plainText = html => String(html).replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").trim();
const sharedLimit = { active: 0 };

export function assertFundPageIdentity(html, code) {
  const title = plainText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  if (!title.includes(`(${code})`) && !title.includes(`（${code}）`)) throw new Error('Fund identity mismatch');
}

async function readBounded(response) {
  if (!response.ok) throw new Error('Upstream unavailable');
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('Upstream response too large');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); }
}

export function createPublicFundPageLoader({ parse, fetchImpl = globalThis.fetch, now = Date.now,
  maxConcurrent = 2, limiter = sharedLimit } = {}) {
  const cache = new Map();
  const pending = new Map();
  return async function load(code) {
    if (!/^\d{6}$/.test(code)) throw new Error('Invalid fund code');
    const cached = cache.get(code);
    if (cached && cached.expires > now()) return cached.value;
    if (pending.has(code)) return pending.get(code);
    if (limiter.active >= maxConcurrent) return { code, status: 'busy', rows: [] };
    limiter.active++;
    const promise = (async () => {
      let value;
      try {
        const response = await fetchImpl(fundPageUrl(code), {
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: fundPageUrl(code) },
          redirect: 'error', signal: AbortSignal.timeout(12000),
        });
        value = { ...parse(await readBounded(response), code), fetchedAt: new Date(now()).toISOString() };
      } catch {
        value = { code, status: 'error', rows: [], source: FUND_PAGE_SOURCE, sourceUrl: fundPageUrl(code) };
      }
      if (cache.size >= 128) cache.delete(cache.keys().next().value);
      cache.set(code, { value, expires: now() + (value.status === 'error' ? 60000 : 6 * 3600000) });
      return value;
    })();
    pending.set(code, promise);
    try { return await promise; } finally { pending.delete(code); limiter.active--; }
  };
}
