export const BASKET_KEY = 'fundcal-basket-v1';
export const BASKET_LIMIT = 200;

/** 篮子只传递公开基金引用，不复制页面费率配置或净值数据。 */
export function normalizeFundRefs(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).flatMap(item => {
    const code = String(item?.code || '').trim();
    if (!/^\d{6}$/.test(code) || item?.kind === 'index' || seen.has(code)) return [];
    seen.add(code);
    return [{ code, name: String(item.name || code).trim().slice(0, 160) || code }];
  });
}

export function mergeFundRefs(existing, incoming, mode = 'add', limit = BASKET_LIMIT) {
  if (!['add', 'replace'].includes(mode)) throw new Error('不支持的基金操作');
  const result = normalizeFundRefs(mode === 'replace' ? incoming : [...existing, ...incoming]);
  if (result.length > limit) throw new Error(`最多支持 ${limit} 只基金，请减少所选数量`);
  return result;
}

export function createBasketStore(storage, onStorageError = () => {}) {
  let items = [];
  const listeners = new Set();
  const read = raw => {
    try { const value = JSON.parse(raw); return value?.v === 1 ? normalizeFundRefs(value.items).slice(0, BASKET_LIMIT) : []; }
    catch { return []; }
  };
  try { items = read(storage?.getItem(BASKET_KEY)); } catch { onStorageError(); }
  const get = () => items.map(item => ({ ...item }));
  const emit = () => listeners.forEach(fn => fn(get()));
  const save = next => {
    items = next;
    try { if (!storage) throw new Error(); storage.setItem(BASKET_KEY, JSON.stringify({ v: 1, items })); }
    catch { onStorageError(); }
    emit();
  };
  return {
    get,
    add(incoming) { const next = mergeFundRefs(items, incoming); const count = next.length - items.length; save(next); return count; },
    remove(codes) { const remove = new Set(codes); save(items.filter(item => !remove.has(item.code))); },
    clear() { save([]); },
    sync(raw) { items = read(raw); emit(); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
