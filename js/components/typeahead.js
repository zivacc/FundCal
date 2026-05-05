/**
 * Typeahead（带下拉的搜索输入框）通用控件。
 *
 * 关注职责：
 *   - 输入防抖 → 调用 search() 拿到 items
 *   - 渲染下拉（renderItem 决定单条 HTML）
 *   - 键盘导航：↑/↓/Enter/Esc
 *   - 点击外部 / 选中后收起或清空（按 options 决定）
 *
 * 不关心：
 *   - 数据来源、缓存策略、选中后副作用（chip / 卡片 / API）→ 全部由调用方注入
 *
 * 用法：
 *   const ta = createTypeahead({
 *     inputEl: document.getElementById('xx'),
 *     dropdownEl: document.getElementById('xx-dropdown'),
 *     search: async (q) => filterMyIndex(q),
 *     renderItem: (item, { highlighted, rerender }) => `<span>${item.name}</span>`,
 *     onSelect: (item) => addFund(item),
 *   });
 *   ta.refresh();   // 强制重跑当前 query 的搜索
 *   ta.rerender();  // 不重跑 search，仅用上次 items 重新渲染（用于外部状态变更后刷新）
 *   ta.close();     // 收起下拉
 *   ta.destroy();   // 解绑事件
 *
 * renderItem 接收的 ctx 参数：
 *   - index: number
 *   - highlighted: boolean
 *   - rerender: () => void   方便子节点事件触发后立即刷新（如点击 +/✓ 按钮后切换状态）
 *
 * 阻止某 DOM 节点触发选中：在该节点（或其祖先）上加 `data-typeahead-skip`。
 */

const VISIBLE_CLASS = 'fund-search-dropdown-visible';
const ITEM_ACTIVE_CLASS = 'fund-search-item-active';

/**
 * @param {Object} options
 * @param {HTMLInputElement} options.inputEl
 * @param {HTMLUListElement} options.dropdownEl
 * @param {(query: string) => any[] | Promise<any[]>} options.search
 * @param {(item: any, ctx: { highlighted: boolean, index: number }) => string | HTMLElement} options.renderItem
 * @param {(item: any) => void} options.onSelect
 * @param {number} [options.debounceMs=150]
 * @param {boolean} [options.closeOnSelect=true]   选中后是否收起下拉
 * @param {boolean} [options.clearOnSelect=false]  选中后是否清空 input
 * @param {boolean} [options.openOnFocus=true]     聚焦时若有 query 立即触发搜索
 * @param {boolean} [options.enableKeyboard=true]  ↑↓ Enter Esc 支持
 * @returns {{ refresh: () => void, close: () => void, destroy: () => void }}
 */
export function createTypeahead(options) {
  const {
    inputEl,
    dropdownEl,
    search,
    renderItem,
    onSelect,
    debounceMs = 150,
    closeOnSelect = true,
    clearOnSelect = false,
    openOnFocus = true,
    enableKeyboard = true,
  } = options;

  if (!inputEl || !dropdownEl || typeof search !== 'function' || typeof renderItem !== 'function') {
    throw new Error('createTypeahead: inputEl / dropdownEl / search / renderItem 必填');
  }

  let items = [];
  let highlight = -1;
  let debounceTimer = null;
  let lastQueryToken = 0;

  function close() {
    items = [];
    highlight = -1;
    dropdownEl.innerHTML = '';
    dropdownEl.setAttribute('aria-hidden', 'true');
    dropdownEl.classList.remove(VISIBLE_CLASS);
  }

  function rerender() {
    renderInternal(items);
  }

  function renderInternal(list) {
    items = Array.isArray(list) ? list : [];
    highlight = -1;
    dropdownEl.innerHTML = '';
    if (!items.length) {
      dropdownEl.setAttribute('aria-hidden', 'true');
      dropdownEl.classList.remove(VISIBLE_CLASS);
      return;
    }
    items.forEach((item, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.index = String(i);
      const content = renderItem(item, { highlighted: false, index: i, rerender });
      if (content instanceof HTMLElement) li.appendChild(content);
      else li.innerHTML = String(content);
      li.addEventListener('click', (e) => {
        if (e.target instanceof HTMLElement && e.target.closest('[data-typeahead-skip]')) return;
        select(item);
      });
      dropdownEl.appendChild(li);
    });
    dropdownEl.setAttribute('aria-hidden', 'false');
    dropdownEl.classList.add(VISIBLE_CLASS);
  }

  function setHighlight(index) {
    if (!items.length) return;
    const opts = dropdownEl.querySelectorAll('[role="option"]');
    opts.forEach((el, i) => el.classList.toggle(ITEM_ACTIVE_CLASS, i === index));
    highlight = index;
    if (index >= 0 && opts[index]) opts[index].scrollIntoView({ block: 'nearest' });
  }

  function select(item) {
    if (!item) return;
    onSelect(item);
    if (clearOnSelect) inputEl.value = '';
    if (closeOnSelect) close();
  }

  async function runSearch() {
    const q = inputEl.value || '';
    const token = ++lastQueryToken;
    let result;
    try {
      result = await search(q);
    } catch (e) {
      console.error('[typeahead] search failed:', e);
      result = [];
    }
    // 抢占：只渲染最新一次请求
    if (token !== lastQueryToken) return;
    renderInternal(result);
  }

  function onInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, debounceMs);
  }

  function onFocus() {
    if (!openOnFocus) return;
    runSearch();
  }

  function onKeydown(e) {
    if (!enableKeyboard) return;
    const opts = dropdownEl.querySelectorAll('[role="option"]');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(highlight < opts.length - 1 ? highlight + 1 : 0);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(highlight <= 0 ? opts.length - 1 : highlight - 1);
      return;
    }
    if (e.key === 'Enter' && opts.length > 0) {
      e.preventDefault();
      const idx = highlight >= 0 ? highlight : 0;
      if (items[idx]) select(items[idx]);
      return;
    }
    if (e.key === 'Escape') {
      close();
      inputEl.blur();
    }
  }

  function onDocClick(e) {
    if (!dropdownEl.classList.contains(VISIBLE_CLASS)) return;
    if (inputEl.contains(e.target) || dropdownEl.contains(e.target)) return;
    close();
  }

  function onDropdownMouseDown(e) {
    // 阻止 input blur，避免 click 前下拉就消失
    e.preventDefault();
  }

  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('focus', onFocus);
  inputEl.addEventListener('keydown', onKeydown);
  dropdownEl.addEventListener('mousedown', onDropdownMouseDown);
  document.addEventListener('click', onDocClick);

  return {
    refresh: runSearch,
    rerender,
    close,
    destroy() {
      clearTimeout(debounceTimer);
      inputEl.removeEventListener('input', onInput);
      inputEl.removeEventListener('focus', onFocus);
      inputEl.removeEventListener('keydown', onKeydown);
      dropdownEl.removeEventListener('mousedown', onDropdownMouseDown);
      document.removeEventListener('click', onDocClick);
      close();
    },
  };
}
