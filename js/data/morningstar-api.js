import { getFeeApiBase } from './fund-api.js';

// 同代码共享请求和五分钟结果；批量导入也只允许四个晨星请求同时在途。
const cache = new Map();
const queue = [];
let active = 0;
function drain() {
  while (active < 4 && queue.length) {
    const job = queue.shift(); active++;
    job.run().then(job.resolve, job.reject).finally(() => { active--; drain(); });
  }
}
export function fetchMorningstarHistory(code, { refresh = false } = {}) {
  if (!/^\d{6}$/.test(code)) return Promise.resolve(null);
  const entry = cache.get(code);
  if (entry && (entry.pending || !refresh && Date.now() - entry.savedAt < 300000)) return entry.promise;
  const next = { pending: true, savedAt: 0 };
  next.promise = new Promise((resolve, reject) => {
    queue.push({ resolve, reject, run: async () => {
      const base = getFeeApiBase();
      if (!base) throw new Error('需要连接基金数据 API');
      const res = await fetch(`${base.replace(/\/$/, '')}/${code}/morningstar`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error('晨星数据暂时无法加载');
      const data = await res.json();
      next.pending = false; next.savedAt = Date.now();
      return data;
    } });
    drain();
  }).catch(error => { if (cache.get(code) === next) cache.delete(code); throw error; });
  cache.set(code, next);
  return next.promise;
}
