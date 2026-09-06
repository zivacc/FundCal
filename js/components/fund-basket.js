import { BASKET_KEY, createBasketStore, normalizeFundRefs } from '../data/basket-store.js';
import { currentFundRoute, getFundReceiver, getPageFundSelection, escapeFundAttribute as escapeHtml } from '../core/fund-transfer.js';

const trigger = document.getElementById('fund-basket-button');
const root = document.createElement('div');
root.id = 'fund-basket-ui';
root.innerHTML = `
  <section id="fund-basket-panel" role="dialog" aria-modal="false" aria-labelledby="fund-basket-title" hidden>
    <header><div><h2 id="fund-basket-title">基金篮子 <span id="fund-basket-total"></span></h2><p>跨页面使用 · 自动保存</p></div><button type="button" data-basket-action="close" aria-label="关闭基金篮子">×</button></header>
    <div class="basket-pending" hidden><span id="basket-pending-label"></span><button type="button" data-basket-action="collect">加入篮子</button></div>
    <div class="basket-list-tools"><label><input type="checkbox" id="basket-select-all"> 全选</label><button type="button" data-basket-action="remove-selected">移除所选</button><button type="button" data-basket-action="clear">清空</button></div>
    <div id="fund-basket-list"></div>
    <footer><button type="button" id="basket-drag-selected" data-basket-drag="selection">⠿ 拖出所选</button><p id="basket-use-hint"></p><div class="basket-use-actions"><button type="button" data-basket-action="add">添加到当前页</button><button type="button" data-basket-action="replace">替换当前页</button></div></footer>
  </section>
  <div id="basket-drop-zones" hidden><button type="button" data-basket-drop="add"><strong>＋ 添加</strong><span>保留当前基金，去重后加入</span></button><button type="button" data-basket-drop="replace"><strong>⇄ 替换</strong><span>替换当前基金，保留页面设置</span></button><button type="button" id="basket-drag-cancel" aria-label="取消拖动">取消 · Esc</button></div>
  <button type="button" id="basket-drop-target" aria-label="加入基金篮子" hidden><span>加入篮子</span></button>
  <div id="basket-drag-ghost" hidden></div>
  <div id="basket-live-status" role="status" aria-live="polite" hidden></div>`;
document.body.append(root);
const panel = root.querySelector('#fund-basket-panel');
const list = root.querySelector('#fund-basket-list');
const zones = root.querySelector('#basket-drop-zones');
const target = root.querySelector('#basket-drop-target');
const ghost = root.querySelector('#basket-drag-ghost');
const selected = new Set();
let toastTimer, storageFailed = false, busy = false, drag = null, candidate = null, suppressClickUntil = 0;
let hoverTimer, hoverRoute, lastFocus;
function announce(message) {
  const status = root.querySelector('#basket-live-status');
  status.textContent = message; status.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { status.hidden = true; }, 5000);
}
let storage;
try { storage = window.localStorage; } catch { storageFailed = true; }
const store = createBasketStore(storage, () => { storageFailed = true; });
function selectedItems() { return store.get().filter(item => selected.has(item.code)); }
function useItems() { const items = selectedItems(); return items.length ? items : store.get(); }
function render() {
  const items = store.get();
  const codes = new Set(items.map(item => item.code));
  for (const code of selected) if (!codes.has(code)) selected.delete(code);
  trigger.querySelector('.basket-count').textContent = items.length;
  trigger.setAttribute('aria-label', `基金篮子，${items.length} 只；点击打开，拖动使用整篮`);
  root.querySelector('#fund-basket-total').textContent = `${items.length} 只`;
  list.innerHTML = items.length ? items.map(item => `<div class="basket-fund-row${selected.has(item.code) ? ' is-selected' : ''}" data-basket-row="${item.code}">
    <label><input type="checkbox" data-basket-select="${item.code}" ${selected.has(item.code) ? 'checked' : ''} aria-label="选择 ${escapeHtml(item.name)}"></label>
    <div class="basket-fund-name"><strong>${escapeHtml(item.name)}</strong><span>${item.code}</span></div>
    <button type="button" class="fund-drag-handle" data-basket-drag="${item.code}" aria-label="拖动 ${escapeHtml(item.name)}" title="拖出此基金；已勾选时拖出所选">⠿</button>
    <button type="button" data-basket-remove="${item.code}" aria-label="移除 ${escapeHtml(item.name)}">×</button></div>`).join('') : '<div class="basket-empty">篮子还是空的<p>选择基金后点击“加入篮子”，<br>或把基金旁的 ⠿ 拖到顶栏篮子。</p></div>';
  const all = root.querySelector('#basket-select-all');
  all.checked = !!items.length && selected.size === items.length; all.indeterminate = selected.size > 0 && selected.size < items.length;
  all.disabled = !items.length;
  root.querySelector('[data-basket-action="remove-selected"]').disabled = !selected.size;
  root.querySelector('[data-basket-action="clear"]').disabled = !items.length;
  const handle = root.querySelector('#basket-drag-selected');
  handle.disabled = !selected.size; handle.textContent = `⠿ 拖出所选${selected.size ? ` ${selected.size} 只` : ''}`;
  refreshContext();
}
function refreshContext() {
  const incoming = getPageFundSelection();
  trigger.classList.toggle('has-selection', incoming.length > 0);
  const pending = root.querySelector('.basket-pending'); pending.hidden = !incoming.length;
  root.querySelector('#basket-pending-label').textContent = `${getPageFundSelection(true).length ? '已选中' : '当前页面'} ${incoming.length} 只基金`;
  const receiver = getFundReceiver();
  const routeName = currentFundRoute() === 'nav' ? '净值比较' : '计算器';
  root.querySelector('#basket-use-hint').textContent = receiver ? `${selected.size ? '所选' : '整篮'} ${useItems().length} 只 → ${routeName}` : '切换到计算器或净值比较后使用篮子';
  root.querySelectorAll('.basket-use-actions button').forEach(button => { button.disabled = busy || !receiver || !useItems().length; });
  if (drag) { zones.hidden = drag.origin !== 'basket' || !receiver; positionTarget(); positionDropLabels(); }
}
function positionDropLabels() {
  const bottom = panel.hidden ? 0 : panel.getBoundingClientRect().bottom;
  zones.style.setProperty('--basket-panel-offset', `${Math.max(0, bottom - 56)}px`);
}
function openPanel(show = panel.hidden) {
  panel.hidden = !show; trigger.setAttribute('aria-expanded', String(show));
  if (show) { lastFocus = document.activeElement; render(); panel.querySelector('[data-basket-action="close"]').focus({ preventScroll: true }); }
  else if (panel.contains(document.activeElement)) (lastFocus?.isConnected ? lastFocus : trigger).focus({ preventScroll: true });
}
function collect(items) {
  try {
    const count = store.add(items);
    announce(`${count ? `已加入 ${count} 只基金` : '这些基金已在篮子中'}${storageFailed ? '；当前浏览器无法保存，仅本次会话有效' : ''}`);
  } catch (error) { announce(error.message); }
}
async function applyToPage(items, mode) {
  const receiver = getFundReceiver();
  if (!receiver || busy || !items.length) return;
  busy = true; refreshContext();
  announce(`正在${mode === 'replace' ? '替换' : '添加'} ${items.length} 只基金…`);
  try {
    const count = await receiver(items, mode);
    announce(`已${mode === 'replace' ? '替换' : '添加'} ${count ?? items.length} 只基金`);
    openPanel(false);
  } catch (error) { announce(error.message || '基金操作失败，请重试'); }
  finally { busy = false; refreshContext(); }
}
function sourceAt(event) {
  const node = event.target.closest?.('#fund-basket-button, [data-basket-drag], [data-basket-row], [data-fund-drag]');
  if (!node) return null;
  // 画廊卡片正文用于旋转浏览，篮子转移从独立把手开始。
  if (node.closest('.fund-card-stage') && !event.target.closest('.fund-drag-handle')) return null;
  if (event.target.closest('input, select, textarea, a, label') || event.target.closest('button') && !event.target.closest('.fund-drag-handle, #fund-basket-button, [data-basket-drag]')) return null;
  let items, origin;
  if (node === trigger) { items = store.get(); origin = 'basket'; }
  else if (node.dataset.basketDrag === 'selection') { items = selectedItems(); origin = 'basket'; }
  else if (node.dataset.basketDrag || node.dataset.basketRow) {
    const code = node.dataset.basketDrag || node.dataset.basketRow;
    items = selected.has(code) ? selectedItems() : store.get().filter(item => item.code === code); origin = 'basket';
  } else {
    const one = normalizeFundRefs([{ code: node.dataset.fundDrag, name: node.dataset.fundName }]);
    const selection = getPageFundSelection(true);
    items = selection.some(item => item.code === one[0]?.code) ? selection : one; origin = 'page';
  }
  return items?.length ? { node, items, origin } : null;
}
function positionTarget() {
  const box = trigger.getBoundingClientRect();
  target.style.left = `${box.x + box.width / 2}px`;
  target.style.top = `${box.y + box.height / 2}px`;
}
function startDrag(source, keyboard = false) {
  drag = { ...source, keyboard };
  document.body.classList.add('basket-dragging');
  trigger.classList.add('is-drop-ready');
  target.hidden = source.origin === 'basket';
  ghost.hidden = keyboard;
  ghost.textContent = `${source.items.length} 只基金 · ${source.items[0].name}${source.items.length > 1 ? ' 等' : ''}`;
  refreshContext();
  if (keyboard) {
    if (!zones.hidden) zones.querySelector('[data-basket-drop]').focus();
    else if (!target.hidden) target.focus();
    else { announce('请先切换到计算器或净值比较'); stopDrag(); }
  }
}
function dropAt(x, y) {
  const box = trigger.getBoundingClientRect();
  if (drag?.origin !== 'basket' && Math.hypot(x - box.x - box.width / 2, y - box.y - box.height / 2) < 68) return 'basket';
  const element = document.elementFromPoint(x, y);
  return element?.closest('[data-basket-drop]')?.dataset.basketDrop || null;
}
function stopDrag() {
  const source = drag;
  drag = null; candidate = null; clearTimeout(hoverTimer); hoverRoute = null;
  document.body.classList.remove('basket-dragging');
  trigger.classList.remove('is-drop-ready', 'is-drop-over'); target.classList.remove('is-over');
  zones.hidden = true; target.hidden = true; ghost.hidden = true;
  zones.querySelectorAll('[data-basket-drop]').forEach(node => node.classList.remove('is-over'));
  if (source?.keyboard) (source.node?.isConnected ? source.node : trigger).focus({ preventScroll: true });
}
function finishDrop(mode) {
  const items = drag?.items || [];
  stopDrag();
  if (mode === 'basket') collect(items);
  else if (mode) void applyToPage(items, mode);
}
trigger.addEventListener('click', () => openPanel());
root.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.id === 'basket-drop-target') { finishDrop('basket'); return; }
  if (button.dataset.basketDrop) { finishDrop(button.dataset.basketDrop); return; }
  if (button.id === 'basket-drag-cancel') { stopDrag(); return; }
  if (button.dataset.basketRemove) { store.remove([button.dataset.basketRemove]); return; }
  const action = button.dataset.basketAction;
  if (action === 'close') openPanel(false);
  if (action === 'collect') collect(getPageFundSelection());
  if (action === 'clear') store.clear();
  if (action === 'remove-selected') store.remove([...selected]);
  if (action === 'add' || action === 'replace') void applyToPage(useItems(), action);
});
root.addEventListener('change', event => {
  if (event.target.id === 'basket-select-all') { selected.clear(); if (event.target.checked) store.get().forEach(item => selected.add(item.code)); render(); }
  if (event.target.dataset.basketSelect) { const code = event.target.dataset.basketSelect; if (event.target.checked) selected.add(code); else selected.delete(code); render(); root.querySelector(`[data-basket-select="${code}"]`)?.focus({ preventScroll: true }); }
});
// 所有页面共用一个 Pointer Events 生命周期；触屏仅从把手起拖，正文继续自然滚动。
document.addEventListener('pointerdown', event => {
  suppressClickUntil = 0;
  if (event.button !== 0 || drag || busy) return;
  const source = sourceAt(event);
  if (!source) { if (!panel.hidden && !root.contains(event.target) && !trigger.contains(event.target)) openPanel(false); return; }
  if (event.pointerType !== 'mouse' && !event.target.closest('.fund-drag-handle, #fund-basket-button, [data-basket-drag]')) return;
  candidate = { ...source, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
});
document.addEventListener('pointermove', event => {
  if (!candidate || candidate.pointerId !== event.pointerId) return;
  if (!drag && Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) < 8) return;
  if (!drag) { startDrag(candidate); candidate.node.setPointerCapture(event.pointerId); }
  event.preventDefault();
  ghost.style.left = `${Math.min(window.innerWidth - 180, Math.max(8, event.clientX + 12))}px`;
  ghost.style.top = `${Math.min(window.innerHeight - 48, event.clientY + 18)}px`;
  const mode = dropAt(event.clientX, event.clientY);
  target.classList.toggle('is-over', mode === 'basket'); trigger.classList.toggle('is-drop-over', mode === 'basket');
  zones.querySelectorAll('[data-basket-drop]').forEach(node => node.classList.toggle('is-over', node.dataset.basketDrop === mode));
  const tab = document.elementFromPoint(event.clientX, event.clientY)?.closest('.top-rail-tab');
  const route = tab?.dataset.route;
  if (route !== hoverRoute) {
    clearTimeout(hoverTimer); hoverRoute = route;
    if (route && route !== currentFundRoute()) hoverTimer = setTimeout(() => { window.location.hash = `#/${route}`; }, 600);
  }
}, { passive: false });
document.addEventListener('pointerup', event => {
  if (event.pointerId !== candidate?.pointerId) return;
  if (drag) { const mode = dropAt(event.clientX, event.clientY); suppressClickUntil = performance.now() + 350; finishDrop(mode); }
  candidate = null;
});
document.addEventListener('pointercancel', () => { stopDrag(); });
document.addEventListener('lostpointercapture', event => {
  // 触屏起拖时把手的隐式捕获会移交给整行；只有当前拖动节点丢失捕获才取消。
  if (event.pointerId === candidate?.pointerId && event.target === candidate.node) stopDrag();
});
document.addEventListener('dragstart', event => { if (sourceAt(event)) event.preventDefault(); });
document.addEventListener('click', event => {
  if (event.detail > 0 && performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  const handle = event.target.closest('.fund-drag-handle, #basket-drag-selected');
  if (handle) { const source = sourceAt(event); if (source) { event.preventDefault(); event.stopImmediatePropagation(); startDrag(source, true); } }
}, true);
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (drag) { event.preventDefault(); event.stopImmediatePropagation(); stopDrag(); }
  else if (!panel.hidden) { event.preventDefault(); event.stopImmediatePropagation(); openPanel(false); }
}, true);
window.addEventListener('fundcal-selection-change', refreshContext);
window.addEventListener('fundcal-route-ready', refreshContext);
window.addEventListener('hashchange', refreshContext);
window.addEventListener('resize', () => { if (drag) { positionTarget(); positionDropLabels(); } });
new ResizeObserver(() => { if (drag) positionDropLabels(); }).observe(panel);
window.addEventListener('blur', () => { if (drag && !drag.keyboard) stopDrag(); });
window.addEventListener('storage', event => { if (event.key === BASKET_KEY) store.sync(event.newValue); });
// NAV 全屏隐藏顶栏时，保留同一个篮子入口；退出后归位。
const triggerSlot = document.createComment('fund-basket-slot');
trigger.before(triggerSlot);
const syncFullscreen = () => {
  const full = document.body.classList.contains('is-fullscreen-nav');
  if (trigger.classList.contains('basket-fullscreen') === full) return;
  trigger.classList.toggle('basket-fullscreen', full);
  if (full) root.append(trigger); else triggerSlot.after(trigger);
  if (drag) positionTarget();
};
new MutationObserver(syncFullscreen).observe(document.body, { attributes: true, attributeFilter: ['class'] });
syncFullscreen();
store.subscribe(render);
render();
