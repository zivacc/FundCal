import { BASKET_KEY, createBasketStore } from './basket-store.js';

// 页面与浮窗共享同一实例，包括当前标签页变更和跨标签页同步。
let storage;
let storageFailed = false;
try { storage = window.localStorage; } catch { storageFailed = true; }
export const basket = createBasketStore(storage, () => { storageFailed = true; });
export const basketStorageFailed = () => storageFailed;
window.addEventListener('storage', event => {
  if (event.key === BASKET_KEY || event.key === null) basket.sync(event.newValue);
});
