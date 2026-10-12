import { getNavApiBase } from './nav-api.js';
import { cachedJsonFetch } from './idb-cache.js';

// A separate pool includes indexes with tracking/weights but no market history.
// Do not widen the NAV comparator's history-only pool.
export async function fetchIndexDetailSearch() {
  const base = getNavApiBase();
  if (!base) return [];
  const { data } = await cachedJsonFetch(`${base}/index/search-index`, {
    key: `${base}/index/detail-search-index`, staleWhileRevalidate: true,
  });
  return Array.isArray(data) ? data : [];
}

export async function fetchIndexDetail(code, { snapshot, signal } = {}) {
  const base = getNavApiBase();
  if (!base) throw new Error('当前部署没有指数详情 API');
  const qs = snapshot ? `?snapshot=${encodeURIComponent(snapshot)}` : '';
  const response = await fetch(`${base}/index/${encodeURIComponent(code)}${qs}`, { signal });
  if (!response.ok) {
    if (response.status === 404) throw new Error(snapshot ? '该指数没有这份权重快照' : '未找到该指数，请通过搜索选择完整指数代码');
    throw new Error(`指数数据加载失败（HTTP ${response.status}）`);
  }
  return response.json();
}
