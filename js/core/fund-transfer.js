import { normalizeFundRefs } from '../data/basket-store.js';
export const escapeFundAttribute = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

const sources = new Map();
const receivers = new Map();
export const currentFundRoute = () => (window.location.hash.match(/^#\/(\w+)/)?.[1] || 'calc');
export const notifyFundSelection = () => window.dispatchEvent(new Event('fundcal-selection-change'));
export function registerFundSource(key, route, getSelection, priority = 0, explicitSelection = true) {
  sources.set(key, { route, getSelection, priority, explicitSelection }); notifyFundSelection();
}
export function getPageFundSelection(explicitOnly = false) {
  const route = currentFundRoute();
  for (const source of [...sources.values()].filter(s => s.route === route && (!explicitOnly || s.explicitSelection)).sort((a, b) => b.priority - a.priority)) {
    const items = normalizeFundRefs(source.getSelection());
    if (items.length) return items;
  }
  return [];
}
export function registerFundReceiver(route, receive) { receivers.set(route, receive); notifyFundSelection(); }
export function getFundReceiver(route = currentFundRoute()) {
  return document.querySelector(`.page.active[data-route="${route}"]`) ? receivers.get(route) : null;
}
export function fundDragAttrs(fund) {
  const item = normalizeFundRefs([fund])[0];
  return item ? `data-fund-drag="${item.code}" data-fund-name="${escapeFundAttribute(item.name)}"` : '';
}
export const fundDragHandle = () => '<button type="button" class="fund-drag-handle" aria-label="拖动基金" title="拖入篮子；点击选择操作">⠿</button>';

/** 有限并发，全部准备成功后由页面一次性应用，失败不清空原有基金。 */
export async function prepareFundTransfer(items, load, concurrency = 4) {
  const refs = normalizeFundRefs(items);
  const result = new Array(refs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, refs.length) }, async () => {
    while (next < refs.length) {
      const index = next++;
      result[index] = await load(refs[index]);
      if (!result[index]) throw new Error(`基金 ${refs[index].code} 数据加载失败，请重试`);
    }
  }));
  return result;
}
