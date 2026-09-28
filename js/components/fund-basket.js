import { BASKET_DROP_DIAMETER, insideDropCircle, detailDropCode } from '../core/fund-drop.js';
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
    <div class="basket-list-tools"><label><input type="checkbox" id="basket-select-all"> 全选</label><button type="button" data-basket-action="remove-selected">移除所选</button><button type="button" data-basket-action="clear">清空</button></div>
    <div id="fund-basket-list"></div>
    <footer><button type="button" id="basket-drag-selected" data-basket-drag="selection">⠿ 拖出所选</button><p id="basket-use-hint"></p><div class="basket-use-actions"><button type="button" data-basket-action="add">添加到当前页</button><button type="button" data-basket-action="replace">替换当前页</button></div></footer>
  </section>
  <div id="basket-drop-zones" hidden><button type="button" data-basket-drop="add"><strong>＋ 添加</strong><span>保留当前基金，去重后加入</span></button><button type="button" data-basket-drop="replace"><strong>⇄ 替换</strong><span>替换当前基金，保留页面设置</span></button><button type="button" id="basket-drag-cancel" aria-label="取消拖动">取消 · Esc</button></div>
  <section id="basket-fund-picker" aria-label="选择要查看的基金" hidden><header><strong id="basket-fund-picker-title"></strong><button type="button" data-basket-action="cancel">取消 · Esc</button></header><div id="basket-fund-choices"></div></section>
  <button type="button" id="basket-drop-target" aria-label="加入基金篮子" hidden><span>加入篮子</span></button>
  <div id="basket-drag-ghost" hidden></div>
  <div id="basket-live-status" role="status" aria-live="polite" hidden></div>`;
document.body.append(root);
const panel = root.querySelector('#fund-basket-panel');
const list = root.querySelector('#fund-basket-list');
const zones = root.querySelector('#basket-drop-zones');
const target = root.querySelector('#basket-drop-target');
const ghost = root.querySelector('#basket-drag-ghost');
const picker = root.querySelector('#basket-fund-picker');
const choices = root.querySelector('#basket-fund-choices');
const fundTab = document.querySelector('.top-rail-tab[data-route="fund"]');
target.style.setProperty('--basket-drop-diameter', `${BASKET_DROP_DIAMETER}px`);
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
  const detail = currentFundRoute() === 'fund';
  const pool = currentFundRoute() === 'list';
  const routeName = detail ? '基金详情' : pool ? '基金列表' : currentFundRoute() === 'nav' ? '净值比较' : '计算器';
  root.querySelector('#basket-use-hint').textContent = pool ? `整篮 ${store.get().length} 只 → 基金列表（清除搜索与筛选）` : receiver ? `${selected.size ? '所选' : '整篮'} ${useItems().length} 只 → ${routeName}` : '切换到计算器、基金列表、净值比较或基金详情后使用篮子';
  root.querySelectorAll('.basket-use-actions button').forEach(button => { button.disabled = busy || !receiver || !useItems().length; });
  root.querySelector('[data-basket-action="replace"]').hidden = detail || pool;
  root.querySelector('[data-basket-action="add"]').textContent = detail ? '查看基金详情' : pool ? '查看整篮基金池' : '添加到当前页';
  zones.classList.toggle('basket-pool-zones', pool);
  zones.querySelector('[data-basket-drop="replace"]').hidden = pool;
  zones.querySelector('[data-basket-drop="add"] strong').textContent = pool ? '查看整篮基金池' : '＋ 添加';
  zones.querySelector('[data-basket-drop="add"] span').textContent = pool ? `限制为篮子中的全部 ${store.get().length} 只基金；清除搜索与筛选，可随时关闭模式` : '保留当前基金，去重后加入';
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
    positionTarget(); positionDropLabels();
  }
}
function positionDropLabels() {
  const bottom = panel.hidden ? 0 : panel.getBoundingClientRect().bottom;
  zones.style.setProperty('--basket-panel-offset', `${Math.max(0, bottom - 56)}px`);
  const narrow = window.innerWidth <= 768;
  picker.style.top = `${narrow && !panel.hidden ? bottom + 10 : 68}px`;
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
  fundTab.classList.toggle('is-fund-drop-ready', source.items.length === 1);
  if (source.items.length === 1) fundTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  target.hidden = source.origin === 'basket';
  ghost.hidden = keyboard;
  ghost.textContent = `${source.items.length} 只基金 · ${source.items[0].name}${source.items.length > 1 ? ' 等' : ''}`;
  refreshContext();
  if (keyboard) {
    if (!picker.hidden) choices.querySelector('[data-basket-drop]').focus();
    else if (!zones.hidden) zones.querySelector('[data-basket-drop]').focus();
    else if (!target.hidden) target.focus();
    else { announce('请先切换到计算器、基金列表、净值比较或基金详情'); stopDrag(); }
  }
}
function onFundTab(x, y) {
  const box = fundTab.getBoundingClientRect(), clip = fundTab.parentElement.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && x >= Math.max(box.left, clip.left) && x <= Math.min(box.right, clip.right) && y >= box.top && y <= box.bottom;
}
function dropAt(x, y) {
  // The enlarged basket circle may overlap this tab: explicit detail drops take priority.
  if (drag?.items.length === 1 && onFundTab(x, y)) return `fund:${drag.items[0].code}`;
  if (drag?.origin !== 'basket' && insideDropCircle(x, y, target.getBoundingClientRect())) return 'basket';
  const element = document.elementFromPoint(x, y);
  if (element?.closest('[data-basket-action="cancel"], #basket-drag-cancel')) return null;
  return element?.closest('[data-basket-drop]')?.dataset.basketDrop || null;
}
function highlightDrop(x, y) {
  const mode = dropAt(x, y);
  target.classList.toggle('is-over', mode === 'basket'); trigger.classList.toggle('is-drop-over', mode === 'basket');
  fundTab.classList.toggle('is-fund-drop-over', drag?.items.length === 1 && onFundTab(x, y));
  root.querySelectorAll('[data-basket-drop]').forEach(node => node.classList.toggle('is-over', node.dataset.basketDrop === mode));
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
  if (source?.pointerId != null) { cancelledPointer = source.pointerId; suppressClickUntil = performance.now() + 350; }
  drag = null; candidate = null; clearTimeout(hoverTimer); hoverRoute = null;
  document.body.classList.remove('basket-dragging', 'basket-detail-drag');
  cancelAnimationFrame(scrollFrame); scrollFrame = 0;
  fundTab.classList.remove('is-fund-drop-ready', 'is-fund-drop-over');
  picker.hidden = true; pickerItems = null;
  trigger.classList.remove('is-drop-ready', 'is-drop-over'); target.classList.remove('is-over');
  zones.hidden = true; target.hidden = true; ghost.hidden = true;
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
trigger.addEventListener('click', () => openPanel());
root.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.id === 'basket-drop-target') { finishDrop('basket'); return; }
  if (button.dataset.basketDrop) { finishDrop(button.dataset.basketDrop); return; }
  if (button.id === 'basket-drag-cancel') { stopDrag(); return; }
  if (button.dataset.basketRemove) { store.remove([button.dataset.basketRemove]); return; }
  const action = button.dataset.basketAction;
  if (action === 'close') { openPanel(false); if (drag) positionDropLabels(); }
  if (action === 'cancel') stopDrag();
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
  suppressClickUntil = 0; cancelledPointer = null;
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
  ghost.style.left = `${Math.max(8, Math.min(window.innerWidth - ghost.offsetWidth - 8, event.clientX + 12))}px`;
  ghost.style.top = `${Math.max(8, Math.min(window.innerHeight - ghost.offsetHeight - 8, event.clientY + 18))}px`;
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
window.addEventListener('resize', () => { if (drag) { positionTarget(); positionDropLabels(); } });
new ResizeObserver(() => { if (drag) positionDropLabels(); }).observe(panel);
window.addEventListener('blur', () => { if (drag && !drag.keyboard) stopDrag(); });
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
