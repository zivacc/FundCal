/**
 * 计算器页 —— 单只基金卡片（fund-card）的创建 / 增删生命周期。
 *
 * 一张卡片包含：
 * - 名称输入框（带 typeahead 联想下拉、键盘选择、点外侧关闭）
 * - 「买入」「年化」两个百分比输入
 * - 「卖出费率」分段表（行操作交给 ./segment-table.js）
 * - 移除按钮
 *
 * 设计：因 createFundCard / addFundCard / removeCardByFundCode 都需要触发图表重算 + 持久化，
 * 而这两个动作的实现位于 calc/index.js（涉及大量页面级状态），通过工厂 `createFundCardFactory(deps)`
 * 注入：
 *   - updateChart()        ：重算并重绘主图
 *   - saveState()          ：把当前 DOM 状态写入 localStorage
 *   - ensureSearchIndex()  ：返回（必要时拉取）全局基金搜索索引，用于名称联想
 *
 * 这样卡片模块对页面全局只暴露三条注入函数，既能访问页面状态，又不会反向 import 父模块。
 */

import { defaultSegments } from '../../domain/calc-defaults.js';
import { fetchFundFeeFromAPI } from '../../data/fund-api.js';
import { filterSearchIndex, SEARCH_DEBOUNCE_MS } from '../../utils/search.js';
import { getColorForIndex } from '../../utils/color.js';
import { renderSegmentRow, sortSegmentRows, updateQuickButtons } from './segment-table.js';

/**
 * @typedef {Object} FundCardDeps
 * @property {() => void} updateChart                重算主图
 * @property {() => void} saveState                  持久化当前状态
 * @property {() => Promise<Array<{code:string,name:string}>>} ensureSearchIndex
 */

/**
 * @typedef {Object} FundCardInitial
 * @property {string} [name]
 * @property {string|number} [code]
 * @property {number} [buyFee]
 * @property {number} [annualFee]
 * @property {Array<{to:number|null,rate:number}>} [sellFeeSegments]
 */

/**
 * 构造卡片三联：createFundCard / addFundCard / removeCardByFundCode。
 * 之所以走工厂：updateChart / saveState 都是页面级闭包，通过 deps 注入避免循环 import。
 *
 * @param {FundCardDeps} deps
 */
export function createFundCardFactory({ updateChart, saveState, ensureSearchIndex }) {

  /**
   * 渲染并返回一张卡片节点（不挂载到 DOM）。
   * @param {number} index               卡片序号，用于占位名「基金 N」
   * @param {string} color               主题色（顶部小圆点）
   * @param {FundCardInitial} [initialData]  恢复 / 预填用初始数据
   * @returns {HTMLElement}
   */
  function createFundCard(index, color, initialData) {
    const card = document.createElement('div');
    card.className = 'fund-card';
    card.dataset.index = index;
    card.innerHTML = `
      <h3>
        <span class="color-dot" style="background:${color}"></span>
        <div class="fund-name-wrap">
          <input type="text" class="fund-name" value="基金 ${index + 1}" placeholder="基金名称" data-min-ch="10" autocomplete="off" aria-autocomplete="list">
          <ul class="fund-name-dropdown" role="listbox" aria-hidden="true"></ul>
          <span class="fund-code" aria-hidden="true"></span>
        </div>
        <button type="button" class="remove-btn" title="移除该基金" aria-label="移除该基金">×</button>
      </h3>
      <div class="form-row form-row-fee">
        <span class="segment-section-label">买入</span>
        <input type="text" class="input-buy-fee" placeholder="0.1">
        <span class="input-unit">%</span>
      </div>
      <div class="form-row form-row-annual form-row-fee">
        <span class="segment-section-label">年化</span>
        <input type="text" class="input-annual-fee" placeholder="1.5">
        <span class="input-unit">%</span>
      </div>
      <p class="segment-section-label">卖出费率</p>
      <table class="segments-table">
        <thead><tr><th>天数</th><th>费率 %</th><th class="segment-actions"></th></tr></thead>
        <tbody></tbody>
      </table>
      <div class="segment-toolbar">
        <button type="button" class="btn btn-sm segment-add-row">+ 添加</button>
        <div class="segment-quick-buttons"></div>
      </div>
    `;

    const tbody = card.querySelector('.segments-table tbody');
    const quickContainer = card.querySelector('.segment-quick-buttons');

    // 任意输入变化都走 update：300ms 防抖后重算 + 持久化
    const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
    const update = debounce(() => { updateChart(); saveState(); }, 300);
    const refreshQuickButtons = () => updateQuickButtons(tbody, quickContainer, update, refreshQuickButtons);

    /* ========== 名称联想下拉 ========== */

    const nameInput = card.querySelector('.fund-name');
    const nameDropdown = card.querySelector('.fund-name-dropdown');

    function resizeFundNameInput() {
      // 宽度由 CSS width:100% 控制，无需动态设置；保留函数避免历史调用点报错
    }

    function showNameDropdown(items) {
      nameDropdown.innerHTML = '';
      nameDropdown.setAttribute('aria-hidden', 'true');
      nameDropdown.classList.remove('fund-name-dropdown-visible');
      if (!items || items.length === 0) return;
      items.forEach((item) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.dataset.code = item.code;
        li.dataset.name = item.name;
        li.innerHTML = `<span class="fund-search-code">${item.code}</span> <span class="fund-search-name">${item.name}</span>`;
        // mousedown 而非 click：避免 input blur 先触发后 dropdown 已隐藏
        li.addEventListener('mousedown', (e) => { e.preventDefault(); selectNameItem(card, item); });
        nameDropdown.appendChild(li);
      });
      nameDropdown.setAttribute('aria-hidden', 'false');
      nameDropdown.classList.add('fund-name-dropdown-visible');
      card.dataset.nameHighlightIndex = '0';
      nameDropdown.querySelectorAll('[role="option"]').forEach((el, i) => el.classList.toggle('fund-search-item-active', i === 0));
    }

    /**
     * 用户选择某条联想结果：填名 / 填代码 / 异步拉费率覆盖三个输入。
     * @param {HTMLElement} cardEl
     * @param {{code:string,name:string}} item
     */
    function selectNameItem(cardEl, item) {
      const inp = cardEl.querySelector('.fund-name');
      const codeSpan = cardEl.querySelector('.fund-code');
      if (inp) inp.value = item.name || `基金${item.code}`;
      if (codeSpan) codeSpan.textContent = item.code || '';
      cardEl.dataset.fundCode = item.code || '';
      resizeFundNameInput();
      nameDropdown.classList.remove('fund-name-dropdown-visible');
      (async () => {
        const data = await fetchFundFeeFromAPI(item.code);
        if (data && cardEl.isConnected) {
          cardEl.querySelector('.input-buy-fee').value = data.buyFee != null ? (data.buyFee * 100).toFixed(2) : '';
          cardEl.querySelector('.input-annual-fee').value = data.annualFee != null ? (data.annualFee * 100).toFixed(2) : '';
          const innerTbody = cardEl.querySelector('.segments-table tbody');
          const segs = data.sellFeeSegments?.length ? data.sellFeeSegments : defaultSegments();
          innerTbody.innerHTML = '';
          segs.forEach(seg => renderSegmentRow(innerTbody, seg, update, refreshQuickButtons));
          refreshQuickButtons();
        }
        update();
      })();
    }

    let nameDebounceTimer;
    nameInput.addEventListener('focus', () => ensureSearchIndex());
    nameInput.addEventListener('input', () => {
      resizeFundNameInput();
      update();
      clearTimeout(nameDebounceTimer);
      nameDebounceTimer = setTimeout(async () => {
        const q = nameInput.value.trim();
        if (!q) { showNameDropdown([]); return; }
        const list = await ensureSearchIndex();
        const items = filterSearchIndex(list, q);
        showNameDropdown(items);
      }, SEARCH_DEBOUNCE_MS);
    });
    nameInput.addEventListener('keydown', (e) => {
      const list = nameDropdown.querySelectorAll('[role="option"]');
      if (e.key === 'Escape') {
        nameDropdown.classList.remove('fund-name-dropdown-visible');
        nameInput.blur();
        return;
      }
      if (list.length === 0) return;
      let idx = parseInt(card.dataset.nameHighlightIndex, 10);
      if (Number.isNaN(idx)) idx = 0;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        idx = idx < list.length - 1 ? idx + 1 : 0;
        card.dataset.nameHighlightIndex = String(idx);
        list.forEach((el, i) => el.classList.toggle('fund-search-item-active', i === idx));
        list[idx].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        idx = idx <= 0 ? list.length - 1 : idx - 1;
        card.dataset.nameHighlightIndex = String(idx);
        list.forEach((el, i) => el.classList.toggle('fund-search-item-active', i === idx));
        list[idx].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = { code: list[idx].dataset.code, name: list[idx].dataset.name };
        selectNameItem(card, item);
      }
    });

    // 点外侧收起下拉
    document.addEventListener('click', (e) => {
      if (!card.contains(e.target) && nameDropdown.classList.contains('fund-name-dropdown-visible')) {
        nameDropdown.classList.remove('fund-name-dropdown-visible');
      }
    });

    resizeFundNameInput();

    /* ========== 初始数据填充 ========== */

    if (initialData) {
      nameInput.value = initialData.name || '';
      const codeVal = (initialData.code != null ? String(initialData.code).trim() : '') || '';
      if (codeVal) {
        card.dataset.fundCode = codeVal;
        const codeEl = card.querySelector('.fund-code');
        if (codeEl) codeEl.textContent = `${codeVal}`;
      }
      resizeFundNameInput();
      card.querySelector('.input-buy-fee').value   = initialData.buyFee   != null ? (initialData.buyFee   * 100).toFixed(2) : '';
      card.querySelector('.input-annual-fee').value = initialData.annualFee != null ? (initialData.annualFee * 100).toFixed(2) : '';
      const segs = initialData.sellFeeSegments?.length ? initialData.sellFeeSegments : defaultSegments();
      tbody.innerHTML = '';
      segs.forEach(seg => renderSegmentRow(tbody, seg, update, refreshQuickButtons));
    } else {
      defaultSegments().forEach(seg => renderSegmentRow(tbody, seg, update, refreshQuickButtons));
    }
    refreshQuickButtons();

    /* ========== 卡片级按钮 ========== */

    card.querySelector('.segment-add-row').addEventListener('click', () => {
      renderSegmentRow(tbody, { to: '', rate: '' }, update, refreshQuickButtons);
      sortSegmentRows(tbody);
      refreshQuickButtons();
      update();
    });

    card.querySelector('.remove-btn').addEventListener('click', () => {
      card.remove();
      updateChart();
      saveState();
    });

    // 任意输入变化都触发 update（卡片级回退监听器，避免遗漏）
    card.querySelectorAll('input').forEach(inp => inp.addEventListener('input', update));

    return card;
  }

  /**
   * 把一张新卡片挂载到 #fund-cards 容器。按基金代码去重。
   * @param {FundCardInitial} [initialData]
   */
  function addFundCard(initialData) {
    const container = document.getElementById('fund-cards');
    if (!container) return;
    // 去重：同一代码只保留一张卡片（无代码则不校验）
    const code = initialData && (initialData.code ?? initialData.fundCode);
    if (code && String(code).trim()) {
      const target = String(code).trim();
      const exists = Array.from(container.querySelectorAll('.fund-card'))
        .some(c => (c.dataset.fundCode || '').trim() === target);
      if (exists) return;
    }
    const count = container.querySelectorAll('.fund-card').length;
    const color = getColorForIndex(count);
    container.appendChild(createFundCard(count, color, initialData));
    updateChart();
    saveState();
  }

  /**
   * 按基金代码移除卡片。
   * @param {string|number} code
   */
  function removeCardByFundCode(code) {
    const target = String(code || '').trim();
    if (!target) return;
    const card = document.querySelector(`.fund-card[data-fund-code="${target}"]`);
    if (card) {
      card.remove();
      updateChart();
      saveState();
    }
  }

  return { createFundCard, addFundCard, removeCardByFundCode };
}
