import { syncSelectAll } from '../../components/selection.js';
import { registerFundSource, notifyFundSelection, fundDragHandle } from '../../core/fund-transfer.js';
/**
 * 基金费率计算器 - 指数选择弹窗模块
 */

import { escapeHtml } from '../../utils/format.js';
import { filterSearchIndex } from '../../utils/search.js';
import { openModal, closeModal } from '../../utils/dom.js';
import { fetchFundStatsFromAPI, fetchFundFeeFromAPI } from '../../data/fund-api.js';

let indexPickerStatsCache = null;
let indexPickerSelectedIndex = null;
const indexPickerSelectedCodes = new Set();

let _pickerToastTimer = null;
function showPickerToast(msg, duration = 3000) {
  let el = document.getElementById('fund-floating-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fund-floating-toast';
    el.className = 'fund-floating-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(_pickerToastTimer);
  _pickerToastTimer = setTimeout(() => el.classList.remove('visible'), duration);
}

/**
 * 初始化指数选择弹窗
 * @param {{ addFundCard: Function }} deps - 需要从 app 主模块传入的依赖
 */
export function setupIndexPickerModal({ addFundCard }) {
  const openBtn = document.getElementById('open-index-picker');
  const backdrop = document.getElementById('index-picker-modal');
  const closeBtn = document.getElementById('index-picker-close');
  const cancelBtn = document.getElementById('index-picker-cancel');
  const applyBtn = document.getElementById('index-picker-apply');
  const searchInput = document.getElementById('index-picker-search-input');
  const indexListEl = document.getElementById('index-picker-index-list');
  const fundListEl = document.getElementById('index-picker-fund-list');
  const selectedLabelEl = document.getElementById('index-picker-selected-index-label');
  const selectedCountEl = document.getElementById('index-picker-selected-count');
  const hintEl = document.getElementById('index-picker-hint');
  const selectAllBtn = document.getElementById('index-picker-select-all');
  const selectLinkedBtn = document.getElementById('index-picker-select-linked');
  const selectEnhancedBtn = document.getElementById('index-picker-select-enhanced');
  const invertBtn = document.getElementById('index-picker-invert-selection');

  if (!openBtn || !backdrop || !searchInput || !indexListEl || !fundListEl) return;

  registerFundSource('calc-index-modal', 'calc', () => backdrop.classList.contains('visible') || backdrop.getAttribute('aria-hidden') === 'false' ? [...fundListEl.querySelectorAll('.index-picker-fund-item-selected')].map(row => ({ code: row.dataset.code, name: row.dataset.fundName })) : [], 30);
  const selectionGroups = [
    [selectAllBtn, '.index-picker-fund-item'],
    [selectLinkedBtn, '[data-is-linked="1"]'],
    [selectEnhancedBtn, '[data-is-enhanced="1"]'],
  ];

  function syncGroupButtons() {
    for (const [button, selector] of selectionGroups) {
      if (!button) continue;
      const rows = fundListEl.querySelectorAll(selector);
      const count = [...rows].filter(row => indexPickerSelectedCodes.has(row.dataset.code)).length;
      syncSelectAll(button, count, rows.length);
    }
  }
  let groupFrame = 0;
  function scheduleGroupSync() {
    if (groupFrame) return;
    groupFrame = requestAnimationFrame(() => { groupFrame = 0; syncGroupButtons(); });
  }
  const updateHint = () => {
    for (const row of fundListEl.querySelectorAll('.index-picker-fund-item')) {
      const selected = indexPickerSelectedCodes.has(row.dataset.code);
      row.classList.toggle('index-picker-fund-item-selected', selected);
      row.querySelector('.index-picker-fund-main').ariaPressed = String(selected);
    }
    syncGroupButtons();
    notifyFundSelection();
    const count = indexPickerSelectedCodes.size;
    if (hintEl) hintEl.textContent = `已选择 ${count} 只基金。`;
    if (selectedCountEl) selectedCountEl.textContent = count ? `（已选 ${count} 只）` : '';
  };

  const renderIndexList = (items, query = '') => {
    indexListEl.innerHTML = '';
    const s = String(query || '').trim().toLowerCase();
    let filtered = items || [];
    if (s) {
      filtered = filterSearchIndex(items, s, { limit: Infinity });
    }
    filtered.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.ariaPressed = String(item === indexPickerSelectedIndex);
      button.className = 'index-picker-index-item';
      button.classList.toggle('index-picker-index-item-active', item === indexPickerSelectedIndex);
      button.dataset.label = item.label;
      button.innerHTML = `
        <span class="index-picker-index-name">${escapeHtml(item.label || '')}</span>
        <span class="index-picker-index-meta">${item.count} 只基金</span>
      `;
      button.addEventListener('click', () => {
        indexPickerSelectedIndex = item;
        indexListEl.querySelectorAll('.index-picker-index-item').forEach(el => {
          el.classList.toggle('index-picker-index-item-active', el === button);
          el.ariaPressed = String(el === button);
        });
        if (selectedLabelEl) {
          selectedLabelEl.textContent = item.label || '未选择指数';
        }
        indexPickerSelectedCodes.clear();
        renderFundListForIndex(item);
        updateHint();
      });
      indexListEl.appendChild(button);
    });
  };

  const renderFundListForIndex = (indexItem) => {
    fundListEl.innerHTML = '';
    if (!indexItem || !Array.isArray(indexItem.codes) || !indexItem.codes.length) {
      fundListEl.innerHTML = '<p class="modal-hint">当前指数暂无可用基金。</p>';
      return;
    }
    indexItem.codes.forEach(code => {
      const safeCode = String(code || '').trim();
      if (!safeCode) return;
      const row = document.createElement('div');
      row.className = 'index-picker-fund-item';
      row.dataset.code = safeCode; row.dataset.fundDrag = safeCode; row.dataset.fundName = safeCode;
      row.innerHTML = `
        ${fundDragHandle()}
        <button type="button" class="index-picker-fund-main" aria-pressed="false">
          <span class="index-picker-fund-name-line">
            <span class="index-picker-fund-name">基金 ${safeCode}</span>
            <span class="index-picker-fund-code">${safeCode}</span>
          </span>
          <span class="index-picker-fund-tags">
            <span class="index-picker-fund-tag index-picker-fund-tag-link" data-code="${safeCode}" hidden>联接基金</span>
            <span class="index-picker-fund-tag">跟踪：${escapeHtml(indexItem.label || '')}</span>
          </span>
        </button>
      `;
      row.addEventListener('click', event => {
        if (event.target.closest('.fund-drag-handle')) return;
        if (indexPickerSelectedCodes.has(safeCode)) indexPickerSelectedCodes.delete(safeCode);
        else indexPickerSelectedCodes.add(safeCode);
        updateHint();
      });
      (async () => {
        try {
          const data = await fetchFundFeeFromAPI(safeCode);
          if (data && data.name) {
            row.dataset.fundName = data.name; notifyFundSelection();
            const nameEl = row.querySelector('.index-picker-fund-name');
            if (nameEl) nameEl.textContent = data.name;
            const nameStr = String(data.name);
            const typeStr = String(data.fundType || '');
            const isLinked = nameStr.includes('联接') || typeStr.includes('联接');
            const isEnhanced = nameStr.includes('增强');
            const linkTagEl = row.querySelector('.index-picker-fund-tag-link');
            if (linkTagEl) linkTagEl.hidden = !isLinked;
            row.dataset.isLinked = isLinked ? '1' : '0';
            row.dataset.isEnhanced = isEnhanced ? '1' : '0';
            if (row.isConnected) scheduleGroupSync();
          }
        } catch {
          // 忽略单个基金失败
        }
      })();
      fundListEl.appendChild(row);
    });
  };

  openBtn.addEventListener('click', async () => {
    // 统一走 api-adapter 的封装：优先 API，失败回退静态 JSON
    if (!indexPickerStatsCache) {
      indexPickerStatsCache = await fetchFundStatsFromAPI();
    }
    const stats = indexPickerStatsCache;
    if (!stats || !Array.isArray(stats.tracking) || !stats.tracking.length) {
      alert([
        '未能加载指数统计数据。',
        '',
        '- 如果是本地开发，请确认后端 API 或静态文件 data/allfund/fund-stats.json 已生成；',
        '- 如果是 GitHub Pages 访问，当前仓库可能尚未提交该统计数据文件，此功能将暂时不可用。'
      ].join('\n'));
      return;
    }
    indexPickerSelectedIndex = null;
    indexPickerSelectedCodes.clear();
    if (searchInput) searchInput.value = '';
    if (selectedLabelEl) selectedLabelEl.textContent = '未选择指数';
    if (selectedCountEl) selectedCountEl.textContent = '';
    fundListEl.innerHTML = '<p class="modal-hint">请先在上方选择一个指数。</p>';
    renderIndexList(stats.tracking);
    updateHint();
    openModal(backdrop);
  });

  [closeBtn, cancelBtn].forEach(el => {
    if (!el) return;
    el.addEventListener('click', () => {
      closeModal(backdrop);
    });
  });

  if (searchInput) {
    let timer;
    searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const stats = indexPickerStatsCache;
        if (!stats || !Array.isArray(stats.tracking)) return;
        renderIndexList(stats.tracking, searchInput.value || '');
      }, 100);
    });
  }

  for (const [button, selector] of selectionGroups) {
    button?.addEventListener('click', () => {
      const select = button.ariaPressed !== 'true';
      for (const row of fundListEl.querySelectorAll(selector)) {
        if (select) indexPickerSelectedCodes.add(row.dataset.code);
        else indexPickerSelectedCodes.delete(row.dataset.code);
      }
      updateHint();
    });
  }
  invertBtn?.addEventListener('click', () => {
    for (const row of fundListEl.querySelectorAll('.index-picker-fund-item')) {
      const code = row.dataset.code;
      if (indexPickerSelectedCodes.has(code)) indexPickerSelectedCodes.delete(code);
      else indexPickerSelectedCodes.add(code);
    }
    updateHint();
  });

  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      if (!indexPickerSelectedCodes.size) return;
      const codes = Array.from(indexPickerSelectedCodes);
      applyBtn.disabled = true;
      applyBtn.textContent = '添加中…';
      try {
        for (const code of codes) {
          const data = await fetchFundFeeFromAPI(code);
          addFundCard(data || { code, name: `基金${code}` });
        }
        // 清空选中状态
        indexPickerSelectedCodes.clear();
        updateHint();
        showPickerToast(`已添加 ${codes.length} 只基金`);
      } finally {
        applyBtn.disabled = false;
        applyBtn.textContent = '添加';
      }
    });
  }
}
