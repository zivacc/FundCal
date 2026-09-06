import { normalizeFundRefs } from '../../data/basket-store.js';

export function planNavBasketTransfer(selected, items, mode, limit = 10) {
  if (!['add', 'replace'].includes(mode)) throw new Error('不支持的基金操作');
  const base = mode === 'replace' ? selected.filter(item => item.isBenchmark) : [...selected];
  const codes = new Set(base.map(item => item.code));
  for (const item of normalizeFundRefs(items)) {
    if (!codes.has(item.code)) { base.push({ ...item, kind: 'fund' }); codes.add(item.code); }
  }
  if (base.length > limit) throw new Error(`净值比较最多 ${limit} 项（含基准），请在篮子中减少勾选数量`);
  return base;
}
