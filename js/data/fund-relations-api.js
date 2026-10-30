import { getFeeApiBase } from './fund-api.js';
import { cachedJsonFetch } from './idb-cache.js';

export async function fetchFundRelations(code) {
  const base = getFeeApiBase();
  if (!base) throw new Error('关联基金需要连接数据服务');
  if (!/^\d{6}$/.test(code)) throw new Error('基金代码无效');
  const url = `${base.replace(/\/$/, '')}/${code}/related`;
  const { data } = await cachedJsonFetch(url, { key: `fund-related:${url}` });
  if (!data) throw new Error('关联基金暂时不可用');
  return data;
}

export async function resolveFundMaster(code) {
  const base = getFeeApiBase();
  if (!base || !/^\d{6}$/.test(code)) throw new Error('关联基金数据服务不可用');
  const response = await fetch(`${base.replace(/\/$/, '')}/${code}/related?resolveMaster=1`);
  if (!response.ok) throw new Error('母基金查询失败');
  return response.json();
}

export async function fetchFofHoldings(code) {
  const base = getFeeApiBase();
  if (!base || !/^\d{6}$/.test(code)) throw new Error('持仓数据服务不可用');
  // The server owns the disclosure cache; transient error statuses must stay retryable.
  const response = await fetch(`${base.replace(/\/$/, '')}/${code}/holdings`);
  if (!response.ok) throw new Error('持仓加载失败');
  return response.json();
}
