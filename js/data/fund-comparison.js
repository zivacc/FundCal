import { getFeeApiBase } from './fund-api.js';
import { fetchMorningstarHistory } from './morningstar-api.js';

/** Independent failures retain the other source. Only raw rates are used: no zero defaults. */
export async function fetchComparisonFund(code, { refresh = false } = {}) {
  if (!/^\d{6}$/.test(code)) throw new Error('无效基金代码');
  const base = getFeeApiBase();
  const urls = [base && `${base.replace(/\/$/, '')}/${code}/fee`, `data/allfund/funds/${code}.json`].filter(Boolean);
  const loadRaw = async () => {
    for (const url of urls) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000), ...(refresh ? { cache: 'no-cache' } : {}) });
        if (!response.ok) continue;
        const raw = await response.json();
        if (raw && String(raw.code) === code) return { raw, source: url.startsWith('data/') ? 'static' : 'api' };
      } catch { /* A static shard may still be available. */ }
    }
    throw new Error('基础资料加载失败');
  };
  const [raw, history] = await Promise.allSettled([loadRaw(), fetchMorningstarHistory(code, { refresh })]);
  return {
    code,
    name: raw.status === 'fulfilled' ? raw.value.raw.name || code : code,
    raw: raw.status === 'fulfilled' ? raw.value.raw : null,
    source: raw.status === 'fulfilled' ? raw.value.source : null,
    history: history.status === 'fulfilled' ? history.value : null,
    errors: [raw.status === 'rejected' && '基础资料暂不可用', history.status === 'rejected' && '晨星历史暂不可用'].filter(Boolean),
    warnings: raw.status === 'fulfilled' && raw.value.source === 'static' ? ['备份资料 · 当前费率待在线核验'] : [],
  };
}
