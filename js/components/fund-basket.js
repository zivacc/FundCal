import { syncSelectAll } from './selection.js';
import { detailDropCode } from '../core/fund-drop.js';
import { createGlassMotion } from '../core/glass-motion.js';
import { attachGlassRim, glassCornerRadius, rimOutset } from '../core/glass-rim.js';
import { applyGlassRefraction, reducedGlassTransparency, removeGlassRefraction } from '../core/glass-refraction.js';
import { normalizeFundRefs } from '../data/basket-store.js';
import { basket as store, basketStorageFailed } from '../data/basket.js';
import { currentFundRoute, getFundReceiver, getPageFundSelection, escapeFundAttribute as escapeHtml } from '../core/fund-transfer.js';

const trigger = document.getElementById('fund-basket-button');
const root = document.createElement('div');
root.id = 'fund-basket-ui';
root.innerHTML = `
  <section id="fund-basket-panel" role="dialog" aria-modal="false" aria-labelledby="fund-basket-title" hidden>
    <header><div><h2 id="fund-basket-title">基金篮子 <span id="fund-basket-total"></span></h2><p>跨页面使用 · 自动保存</p></div><button type="button" data-basket-action="close" aria-label="关闭基金篮子">×</button></header>
    <div class="basket-pending" hidden><span id="basket-pending-label"></span><button type="button" data-basket-action="collect">加入篮子</button></div>
    <div class="basket-list-tools"><button type="button" id="basket-select-all" class="select-all-btn" aria-pressed="false">全选</button><button type="button" data-basket-action="remove-selected">移除所选</button><button type="button" data-basket-action="clear">清空</button></div>
    <div id="fund-basket-list"></div>
    <footer><button type="button" id="basket-drag-selected" data-basket-drag="selection">移动所选</button><p id="basket-use-hint"></p><div class="basket-use-actions"><button type="button" data-basket-action="add">添加到当前页</button><button type="button" data-basket-action="replace">替换当前页</button></div></footer>
  </section>
  <div id="basket-drop-zones" role="group" aria-label="选择拖入方式" hidden><button type="button" data-basket-drop="add"><strong>＋ 添加</strong><small>保留当前基金，去重后加入</small></button><button type="button" data-basket-drop="replace"><strong>⇄ 替换</strong><small>替换当前基金，保留页面设置</small></button><button type="button" id="basket-drag-cancel" aria-label="取消拖动">取消</button></div>
  <section id="basket-fund-picker" aria-label="选择要查看的基金" hidden><header><strong id="basket-fund-picker-title"></strong><button type="button" data-basket-action="cancel">取消 · Esc</button></header><div id="basket-fund-choices"></div></section>
  <div id="basket-drag-ghost" class="glass-hover-frame" aria-hidden="true" hidden><span class="basket-ghost-label"></span></div>
  <div id="basket-live-status" role="status" aria-live="polite" hidden></div>`;
document.body.append(root);
const panel = root.querySelector('#fund-basket-panel');
const list = root.querySelector('#fund-basket-list');
const zones = root.querySelector('#basket-drop-zones');
const ghost = root.querySelector('#basket-drag-ghost');
const picker = root.querySelector('#basket-fund-picker');
const choices = root.querySelector('#basket-fund-choices');
const fundTab = document.querySelector('.top-rail-tab[data-route="fund"]');
let pickerItems = null, scrollFrame = 0;
const selected = new Set();
let toastTimer, busy = false, drag = null, candidate = null, suppressClickUntil = 0;
let hoverTimer, hoverRoute, lastFocus, cancelledPointer;
function announce(message) {
  const status = root.querySelector('#basket-live-status');
  status.textContent = message; status.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { status.hidden = true; }, 5000);
}
function selectedItems() { return store.get().filter(item => selected.has(item.code)); }
function useItems() { const items = selectedItems(); return items.length ? items : store.get(); }
function syncTrigger() {
  const receiving = drag?.origin === 'page';
  trigger.classList.toggle('is-drop-ready', receiving);
  const label = receiving ? `加入篮子，${drag.items.length} 只基金` : `基金篮子，${store.get().length} 只；点击打开，拖动使用整篮`;
  trigger.setAttribute('aria-label', label);
  trigger.title = receiving ? label : '点击打开基金篮子，拖动使用整篮';
  if (receiving) {
    trigger.removeAttribute('aria-controls');
    trigger.removeAttribute('aria-expanded');
  } else {
    trigger.setAttribute('aria-controls', panel.id);
    trigger.setAttribute('aria-expanded', String(!panel.hidden));
  }
}
function render() {
  const items = store.get();
  const codes = new Set(items.map(item => item.code));
  for (const code of selected) if (!codes.has(code)) selected.delete(code);
  trigger.querySelector('.basket-count').textContent = items.length;
  syncTrigger();
  root.querySelector('#fund-basket-total').textContent = `${items.length} 只`;
  list.innerHTML = items.length ? items.map(item => `<div class="basket-fund-row" data-basket-row="${item.code}">
    <button type="button" class="basket-fund-name"><strong>${escapeHtml(item.name)}</strong><span>${item.code}</span></button>
    <button type="button" class="fund-drag-handle" data-basket-drag="${item.code}" aria-label="移动 ${escapeHtml(item.name)}" title="移动此基金；已选中时移动所选">移动基金</button>
    <button type="button" data-basket-remove="${item.code}" aria-label="移除 ${escapeHtml(item.name)}">×</button></div>`).join('') : '<div class="basket-empty">篮子还是空的<p>选择基金后点击“加入篮子”，<br>或用鼠标把基金行拖到顶栏篮子。</p></div>';
  syncBasketSelection(items);
}
function syncBasketSelection(items) {
  for (const row of list.querySelectorAll('[data-basket-row]')) {
    const active = selected.has(row.dataset.basketRow);
    row.classList.toggle('is-selected', active);
    row.querySelector('.basket-fund-name').ariaPressed = String(active);
  }
  syncSelectAll(root.querySelector('#basket-select-all'), selected.size, items.length);
  root.querySelector('[data-basket-action="remove-selected"]').disabled = !selected.size;
  root.querySelector('[data-basket-action="clear"]').disabled = !items.length;
  const handle = root.querySelector('#basket-drag-selected');
  handle.disabled = !selected.size; handle.textContent = `移动所选${selected.size ? ` ${selected.size} 只` : ''}`;
  refreshContext();
}
function refreshContext() {
  const incoming = getPageFundSelection();
  trigger.classList.toggle('has-selection', incoming.length > 0);
  const pending = root.querySelector('.basket-pending'); pending.hidden = !incoming.length;
  root.querySelector('#basket-pending-label').textContent = `${getPageFundSelection(true).length ? '已选中' : '当前页面'} ${incoming.length} 只基金`;
  const receiver = getFundReceiver();
  const detail = currentFundRoute() === 'fund';
  const pool = currentFundRoute() === 'list';
  const routeName = detail ? '基金详情' : pool ? '基金列表' : currentFundRoute() === 'nav' ? '净值比较' : currentFundRoute() === 'compare' ? '基金比较' : '计算器';
  root.querySelector('#basket-use-hint').textContent = pool ? `整篮 ${store.get().length} 只 → 基金列表（清除搜索与筛选）` : receiver ? `${selected.size ? '所选' : '整篮'} ${useItems().length} 只 → ${routeName}` : '切换到计算器、基金列表、基金比较、净值比较或基金详情后使用篮子';
  root.querySelectorAll('.basket-use-actions button').forEach(button => { button.disabled = busy || !receiver || !useItems().length; });
  root.querySelector('[data-basket-action="replace"]').hidden = detail || pool;
  root.querySelector('[data-basket-action="add"]').textContent = detail ? '查看基金详情' : pool ? '查看整篮基金池' : '添加到当前页';
  zones.classList.toggle('basket-pool-zones', pool);
  zones.querySelector('[data-basket-drop="replace"]').hidden = pool;
  zones.querySelector('[data-basket-drop="add"] strong').textContent = pool ? '查看整篮基金池' : '＋ 添加';
  zones.querySelector('[data-basket-drop="add"] small').textContent = pool ? `整篮 ${store.get().length} 只，清除搜索与筛选` : '保留当前基金，去重后加入';
  document.body.classList.toggle('basket-detail-drag', !!drag && detail && drag.origin === 'basket');
  if (drag) {
    zones.hidden = drag.origin !== 'basket' || !receiver || detail;
    picker.hidden = drag.origin !== 'basket' || !receiver || !detail;
    if (!picker.hidden && pickerItems !== drag.items) {
      pickerItems = drag.items;
      picker.dataset.basketDrop = drag.items.length === 1 ? `fund:${drag.items[0].code}` : '';
      root.querySelector('#basket-fund-picker-title').textContent = drag.items.length === 1 ? '松开查看基金详情' : '拖到基金行，松开查看详情';
      choices.innerHTML = drag.items.map(item => `<button type="button" data-basket-drop="fund:${item.code}"><span>${item.code}</span><strong>${escapeHtml(item.name)}</strong></button>`).join('');
      choices.scrollTop = 0;
    }
    positionPicker();
  }
}
function positionPicker() {
  if (picker.hidden) return;
  const bottom = panel.hidden ? 0 : panel.getBoundingClientRect().bottom;
  const narrow = window.innerWidth <= 768;
  picker.style.top = narrow && !panel.hidden ? `${bottom + 10}px` : '';
  picker.style.right = `${!narrow && !panel.hidden ? window.innerWidth - panel.getBoundingClientRect().left + 12 : 12}px`;
}
function openPanel(show = panel.hidden) {
  panel.hidden = !show; trigger.setAttribute('aria-expanded', String(show));
  if (show) { lastFocus = document.activeElement; render(); panel.querySelector('[data-basket-action="close"]').focus({ preventScroll: true }); }
  else if (panel.contains(document.activeElement)) (lastFocus?.isConnected ? lastFocus : trigger).focus({ preventScroll: true });
}
function collect(items) {
  try {
    const count = store.add(items);
    announce(`${count ? `已加入 ${count} 只基金` : '这些基金已在篮子中'}${basketStorageFailed() ? '；当前浏览器无法保存，仅本次会话有效' : ''}`);
  } catch (error) { announce(error.message); }
}
async function applyToPage(items, mode) {
  const receiver = getFundReceiver();
  if (!receiver || busy || !items.length) return;
  if (currentFundRoute() === 'fund' && items.length > 1) { startDrag({ node: trigger, items, origin: 'basket' }, true); return; }
  busy = true; refreshContext();
  const pool = currentFundRoute() === 'list';
  announce(pool ? '正在打开整篮基金池…' : `正在${mode === 'replace' ? '替换' : '添加'} ${items.length} 只基金…`);
  try {
    const count = await receiver(items, mode);
    announce(pool ? `已开启篮子基金池，范围 ${count} 只基金` : `已${mode === 'replace' ? '替换' : '添加'} ${count ?? items.length} 只基金`);
    openPanel(false);
  } catch (error) { announce(error.message || '基金操作失败，请重试'); }
  finally { busy = false; refreshContext(); }
}
function sourceAt(event) {
  const node = event.target.closest?.('#fund-basket-button, [data-basket-drag], [data-basket-row], [data-fund-drag]');
  if (!node) return null;
  if (event.target.closest('input, select, textarea, a, label') || event.target.closest('button') && !event.target.closest('.fund-drag-handle, #fund-basket-button, [data-basket-drag], .basket-fund-name, .index-picker-fund-main')) return null;
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
const dragOptics = { rim: 8, scale: 15, outset: rimOutset, edgeOnly: true };
function dragMotion(element) {
  return createGlassMotion(element, { rim: attachGlassRim(element, { rim: dragOptics.rim, strength: .68 }) });
}
let ghostMotion, dropGlass;
let ghostWidth = 0, ghostHeight = 0, ghostRadius = 0;
const dropResize = new ResizeObserver(() => {
  if (drag?.point) highlightDrop(drag.point.x, drag.point.y);
});
function measureGhost() {
  if (ghost.hidden) return;
  ghostMotion ??= dragMotion(ghost);
  // Measure the wrapped label independently of the last dragged fund's width.
  ghost.style.removeProperty('width');
  ghost.style.removeProperty('height');
  ghostWidth = ghost.offsetWidth;
  ghostHeight = ghost.offsetHeight;
  ghostRadius = glassCornerRadius(ghost, ghostWidth, ghostHeight);
  applyGlassRefraction(ghost, ghostWidth, ghostHeight, { ...dragOptics, radius: ghostRadius });
}
function positionGhost(x, y) {
  const left = Math.max(8, Math.min(window.innerWidth - ghostWidth - 8, x + 12));
  const top = Math.max(8, Math.min(window.innerHeight - ghostHeight - 8, y + 18));
  ghostMotion.moveTo({ x: left, y: top, width: ghostWidth, height: ghostHeight }, { radius: ghostRadius, pointerX: x, pointerY: y });
  ghostMotion.setPressed(true);
}
function clearDropGlass() {
  if (!dropGlass) return;
  dropResize.disconnect();
  dropGlass.motion.reset();
  removeGlassRefraction(dropGlass.lens);
  dropGlass.host.classList.remove('has-drop-lens');
  dropGlass.lens.remove();
  dropGlass = null;
}
function positionDropGlass(host, x, y) {
  if (host !== dropGlass?.host) clearDropGlass();
  if (!host) return;
  if (!dropGlass) {
    const lens = document.createElement('span');
    lens.className = 'glass-hover-frame basket-drop-lens';
    lens.setAttribute('aria-hidden', 'true');
    host.append(lens);
    host.classList.add('has-drop-lens');
    dropGlass = { host, lens, motion: dragMotion(lens) };
    dropResize.observe(host, { box: 'border-box' });
  }
  const { lens, motion } = dropGlass;
  const box = host.getBoundingClientRect();
  const width = host.offsetWidth, height = host.offsetHeight;
  const radius = glassCornerRadius(host, width, height);
  lens.style.borderRadius = `${radius}px`;
  applyGlassRefraction(lens, width, height, { ...dragOptics, radius });
  motion.moveTo({ x: -host.clientLeft, y: -host.clientTop, width, height },
    { radius, pointerX: x - box.left - host.clientLeft, pointerY: y - box.top - host.clientTop });
  motion.setPressed(true);
}

function startDrag(source, keyboard = false) {
  const surface = source.node.closest('.fund-card, tr, .basket-fund-row, .fund-stats-detail-row') || source.node;
  drag = { ...source, keyboard, surface };
  surface.classList.add('is-basket-drag-source');
  document.body.classList.add('basket-dragging');
  syncTrigger();
  fundTab.classList.toggle('is-fund-drop-ready', source.items.length === 1);
  if (source.items.length === 1) fundTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  ghost.hidden = keyboard;
  ghost.querySelector('.basket-ghost-label').textContent = `${source.items.length} 只基金 · ${source.items[0].name}${source.items.length > 1 ? ' 等' : ''}`;
  measureGhost();
  refreshContext();
  if (keyboard) {
    if (!picker.hidden) choices.querySelector('[data-basket-drop]').focus();
    else if (!zones.hidden) zones.querySelector('[data-basket-drop]').focus();
    else if (source.origin === 'page') trigger.focus({ preventScroll: true });
    else { announce('请先切换到计算器、基金列表、净值比较或基金详情'); stopDrag(); }
  }
}
function dropAt(element) {
  // Native hit testing respects the capsule corners, scrolling and clipped tabs.
  if (drag?.origin === 'page' && trigger.contains(element)) return 'basket';
  if (drag?.items.length === 1 && fundTab.contains(element)) return `fund:${drag.items[0].code}`;
  if (element?.closest('[data-basket-action="cancel"], #basket-drag-cancel')) return null;
  return element?.closest('[data-basket-drop]')?.dataset.basketDrop || null;
}
function highlightDrop(x, y) {
  const element = document.elementFromPoint(x, y);
  const mode = dropAt(element);
  trigger.classList.toggle('is-drop-over', mode === 'basket');
  fundTab.classList.toggle('is-fund-drop-over', drag?.items.length === 1 && fundTab.contains(element));
  const area = mode === 'basket' ? trigger : mode && element?.closest('[data-basket-drop]');
  root.querySelectorAll('[data-basket-drop]').forEach(node => node.classList.toggle('is-over', node === area));
  positionDropGlass(area, x, y);
}
function scrollChoices() {
  scrollFrame = 0;
  if (!drag?.point || picker.hidden) return;
  const { x, y } = drag.point, box = choices.getBoundingClientRect();
  if (x < box.left || x > box.right || y < box.top || y > box.bottom) return;
  const dy = y < box.top + 40 ? -8 : y > box.bottom - 40 ? 8 : 0;
  const previous = choices.scrollTop;
  choices.scrollTop += dy;
  if (choices.scrollTop !== previous) { highlightDrop(x, y); scrollFrame = requestAnimationFrame(scrollChoices); }
}
function stopDrag() {
  const source = drag;
  source?.surface.classList.remove('is-basket-drag-source');
  if (source?.pointerId != null) { cancelledPointer = source.pointerId; suppressClickUntil = performance.now() + 350; }
  drag = null; candidate = null; clearTimeout(hoverTimer); hoverRoute = null;
  document.body.classList.remove('basket-dragging', 'basket-detail-drag');
  cancelAnimationFrame(scrollFrame); scrollFrame = 0;
  fundTab.classList.remove('is-fund-drop-ready', 'is-fund-drop-over');
  picker.hidden = true; pickerItems = null;
  syncTrigger();
  trigger.classList.remove('is-drop-over');
  zones.hidden = true; ghost.hidden = true;
  ghostMotion?.reset();
  clearDropGlass();
  removeGlassRefraction(ghost);
  root.querySelectorAll('[data-basket-drop]').forEach(node => node.classList.remove('is-over'));
  if (source?.keyboard) (source.node?.isConnected ? source.node : trigger).focus({ preventScroll: true });
}
function finishDrop(mode) {
  const items = drag?.items || [];
  stopDrag();
  const code = detailDropCode(mode, items);
  if (code) { openPanel(false); window.location.hash = `#/fund/${code}`; }
  else if (mode === 'basket') collect(items);
  else if (mode === 'add' || mode === 'replace') void applyToPage(items, mode);
}
trigger.addEventListener('click', () => {
  if (drag?.origin === 'page') finishDrop('basket');
  else openPanel();
});
root.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.basketDrop) { finishDrop(button.dataset.basketDrop); return; }
  if (button.id === 'basket-drag-cancel') { stopDrag(); return; }
  if (button.dataset.basketRemove) { store.remove([button.dataset.basketRemove]); return; }
  const action = button.dataset.basketAction;
  if (action === 'close') { openPanel(false); if (drag) positionPicker(); }
  if (action === 'cancel') stopDrag();
  if (action === 'collect') collect(getPageFundSelection());
  if (action === 'clear') store.clear();
  if (action === 'remove-selected') store.remove([...selected]);
  if (action === 'add' || action === 'replace') void applyToPage(useItems(), action);
});
list.addEventListener('click', event => {
  if (event.target.closest('button:not(.basket-fund-name)')) return;
  const row = event.target.closest('[data-basket-row]');
  if (!row) return;
  const code = row.dataset.basketRow;
  if (selected.has(code)) selected.delete(code);
  else selected.add(code);
  syncBasketSelection(store.get());
});
root.querySelector('#basket-select-all').addEventListener('click', event => {
  const items = store.get();
  if (event.currentTarget.ariaPressed === 'true') selected.clear();
  else items.forEach(item => selected.add(item.code));
  syncBasketSelection(items);
});
// 触屏正文继续自然滚动；可用篮子的收集/应用按钮完成转移。
document.addEventListener('pointerdown', event => {
  suppressClickUntil = 0; cancelledPointer = null;
  if (event.button !== 0 || drag || busy) return;
  const source = sourceAt(event);
  if (!source) { if (!panel.hidden && !root.contains(event.target) && !trigger.contains(event.target)) openPanel(false); return; }
  if (event.pointerType !== 'mouse' && !event.target.closest('.fund-drag-handle, #fund-basket-button, [data-basket-drag]')) return;
  const rail = source.node.closest('.fund-card-stage')?.querySelector('.fund-cards');
  const deckPan = rail && !event.target.closest('.fund-drag-handle') && rail.children.length > Number(rail.dataset.frontCount || 1);
  candidate = { ...source, deckPan, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
});
document.addEventListener('pointermove', event => {
  if (!candidate || candidate.pointerId !== event.pointerId) return;
  if (!drag && Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) < 8) return;
  // 画廊横向手势仍用于翻卡；从卡片正文纵向拖动可直接转移到篮子。
  if (!drag && candidate.deckPan && Math.abs(event.clientX - candidate.x) >= Math.abs(event.clientY - candidate.y)) { candidate = null; return; }
  if (!drag) { startDrag(candidate); candidate.node.setPointerCapture(event.pointerId); }
  event.preventDefault();
  positionGhost(event.clientX, event.clientY);
  drag.point = { x: event.clientX, y: event.clientY };
  highlightDrop(event.clientX, event.clientY);
  if (!scrollFrame) scrollFrame = requestAnimationFrame(scrollChoices);
  const tab = document.elementFromPoint(event.clientX, event.clientY)?.closest('.top-rail-tab');
  const route = tab?.dataset.route;
  if (route !== hoverRoute) {
    clearTimeout(hoverTimer); hoverRoute = route;
    if (route && route !== currentFundRoute() && !(route === 'fund' && drag.items.length === 1)) hoverTimer = setTimeout(() => { window.location.hash = `#/${route}`; }, 600);
  }
}, { passive: false });
document.addEventListener('pointerup', event => {
  if (event.pointerId === cancelledPointer) { cancelledPointer = null; suppressClickUntil = performance.now() + 350; return; }
  if (event.pointerId !== candidate?.pointerId) return;
  if (drag) { const mode = dropAt(document.elementFromPoint(event.clientX, event.clientY)); suppressClickUntil = performance.now() + 350; finishDrop(mode); }
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
  if (drag?.items.length === 1 && event.target.closest('.top-rail-tab[data-route="fund"]')) { event.preventDefault(); event.stopImmediatePropagation(); finishDrop(`fund:${drag.items[0].code}`); return; }
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
function updateDragLayout() {
  if (!drag) return;
  positionPicker();
  measureGhost();
  if (drag.point) {
    positionGhost(drag.point.x, drag.point.y);
    highlightDrop(drag.point.x, drag.point.y);
  }
}
window.addEventListener('resize', updateDragLayout);
reducedGlassTransparency.addEventListener('change', updateDragLayout);
new ResizeObserver(() => { if (drag) positionPicker(); }).observe(panel);
window.addEventListener('blur', () => { if (drag && !drag.keyboard) stopDrag(); });
// NAV 全屏隐藏顶栏时，保留同一个篮子入口；退出后归位。
const triggerSlot = document.createComment('fund-basket-slot');
trigger.before(triggerSlot);
const syncFullscreen = () => {
  const full = document.body.classList.contains('is-fullscreen-nav');
  if (trigger.classList.contains('basket-fullscreen') === full) return;
  trigger.classList.toggle('basket-fullscreen', full);
  if (full) root.append(trigger); else triggerSlot.after(trigger);
};
new MutationObserver(syncFullscreen).observe(document.body, { attributes: true, attributeFilter: ['class'] });
syncFullscreen();
store.subscribe(render);
render();
