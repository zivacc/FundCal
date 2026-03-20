/**
 * 基金费率计算器 - 指数选择弹窗模块
 */

import { escapeHtml, openModal, closeModal } from './utils.js';
import { fetchFundStatsFromAPI, fetchFundFeeFromAPI } from './api-adapter.js';

let indexPickerStatsCache = null;
let indexPickerSelectedIndex = null;
let indexPickerSelectedCodes = new Set();

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

  let selectAllActive = false;
  let selectLinkedActive = false;
  let selectEnhancedActive = false;

  const updateHint = () => {
    const count = indexPickerSelectedCodes.size;
    const text = `已选择 ${count} 只基金。`;
    if (hintEl) hintEl.textContent = text;
    if (selectedCountEl) selectedCountEl.textContent = count ? `（已勾选 ${count} 只）` : '';
  };

  const renderIndexList = (items, query = '') => {
    indexListEl.innerHTML = '';
    const s = String(query || '').trim().toLowerCase();
    let filtered = items || [];
    if (s) {
      const numOnly = s.replace(/\D/g, '');
      filtered = items.filter(item => {
        const label = String(item.label || '').trim();
        const lower = label.toLowerCase();
        if (!lower) return false;
        if (numOnly && lower.includes(numOnly)) return true;
        if (lower.includes(s)) return true;
        if (item.initials && String(item.initials).toLowerCase().startsWith(s)) return true;
        return false;
      });
    }
    filtered.forEach(item => {
      const div = document.createElement('div');
      div.className = 'index-picker-index-item';
      div.dataset.label = item.label;
      div.innerHTML = `
        <div class="index-picker-index-name">${escapeHtml(item.label || '')}</div>
        <div class="index-picker-index-meta">${item.count} 只基金</div>
      `;
      div.addEventListener('click', () => {
        indexPickerSelectedIndex = item;
        indexListEl.querySelectorAll('.index-picker-index-item').forEach(el => {
          el.classList.toggle('index-picker-index-item-active', el === div);
        });
        if (selectedLabelEl) {
          selectedLabelEl.textContent = item.label || '未选择指数';
        }
        indexPickerSelectedCodes = new Set();
        selectAllActive = false;
        selectLinkedActive = false;
        selectEnhancedActive = false;
        if (selectAllBtn) selectAllBtn.classList.remove('index-picker-toggle-active');
        if (selectLinkedBtn) selectLinkedBtn.classList.remove('index-picker-toggle-active');
        if (selectEnhancedBtn) selectEnhancedBtn.classList.remove('index-picker-toggle-active');
        renderFundListForIndex(item);
        updateHint();
      });
      indexListEl.appendChild(div);
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
      row.dataset.code = safeCode;
      row.innerHTML = `
        <div class="index-picker-fund-main">
          <div class="index-picker-fund-name-line">
            <span class="index-picker-fund-name">基金 ${safeCode}</span>
            <span class="index-picker-fund-code">${safeCode}</span>
          </div>
          <div class="index-picker-fund-tags">
            <span class="index-picker-fund-tag index-picker-fund-tag-link" data-code="${safeCode}" hidden>联接基金</span>
            <span class="index-picker-fund-tag">跟踪：${escapeHtml(indexItem.label || '')}</span>
          </div>
        </div>
      `;
      row.addEventListener('click', () => {
        const code = row.dataset.code;
        if (!code) return;
        if (indexPickerSelectedCodes.has(code)) {
          indexPickerSelectedCodes.delete(code);
          row.classList.remove('index-picker-fund-item-selected');
        } else {
          indexPickerSelectedCodes.add(code);
          row.classList.add('index-picker-fund-item-selected');
        }
        selectAllActive = false;
        selectLinkedActive = false;
        updateHint();
      });
      (async () => {
        try {
          const data = await fetchFundFeeFromAPI(safeCode);
          if (data && data.name) {
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
    indexPickerSelectedCodes = new Set();
    selectAllActive = false;
    selectLinkedActive = false;
    selectEnhancedActive = false;
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

  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      if (!indexPickerSelectedIndex || !Array.isArray(indexPickerSelectedIndex.codes)) return;
      if (!selectAllActive) {
        indexPickerSelectedCodes = new Set(indexPickerSelectedIndex.codes.map(c => String(c).trim()).filter(Boolean));
        fundListEl.querySelectorAll('.index-picker-fund-item').forEach(row => {
          const code = row.dataset.code;
          if (code && indexPickerSelectedCodes.has(code)) {
            row.classList.add('index-picker-fund-item-selected');
          } else {
            row.classList.remove('index-picker-fund-item-selected');
          }
        });
        selectAllActive = true;
        selectLinkedActive = false;
        selectEnhancedActive = false;
      } else {
        indexPickerSelectedCodes = new Set();
        fundListEl.querySelectorAll('.index-picker-fund-item').forEach(row => {
          row.classList.remove('index-picker-fund-item-selected');
        });
        selectAllActive = false;
        selectLinkedActive = false;
        selectEnhancedActive = false;
      }
      if (selectAllBtn) selectAllBtn.classList.toggle('index-picker-toggle-active', selectAllActive);
      if (selectLinkedBtn) selectLinkedBtn.classList.remove('index-picker-toggle-active');
      if (selectEnhancedBtn) selectEnhancedBtn.classList.remove('index-picker-toggle-active');
      updateHint();
    });
  }

  if (selectLinkedBtn) {
    selectLinkedBtn.addEventListener('click', () => {
      if (!indexPickerSelectedIndex || !Array.isArray(indexPickerSelectedIndex.codes)) return;
      if (!selectLinkedActive) {
        fundListEl.querySelectorAll('.index-picker-fund-item').forEach(row => {
          const code = row.dataset.code;
          if (!code) return;
          if (row.dataset.isLinked === '1') indexPickerSelectedCodes.add(code);
        });
        fundListEl.querySelectorAll('.index-picker-fund-item').forEach(row => {
          const code = row.dataset.code;
          if (!code) return;
          row.classList.toggle('index-picker-fund-item-selected', indexPickerSelectedCodes.has(code));
        });
        selectLinkedActive = true;
      } else {
        fundListEl.querySelectorAll('.index-picker-fund-item').forEach(row => {
          const code = row.dataset.code;
          if (!code) return;
          if (row.dataset.isLinked === '1') indexPickerSelectedCodes.delete(code);
        });
        fundListEl.querySelectorAll('.index-picker-fund-item').forEach(row => {
          const code = row.dataset.code;
          if (!code) return;
          if (indexPickerSelectedCodes.has(code)) {
            row.classList.add('index-picker-fund-item-selected');
          } else {
            row.classList.remove('index-picker-fund-item-selected');
          }
        });
        selectLinkedActive = false;
      }
      if (selectLinkedBtn) selectLinkedBtn.classList.toggle('index-picker-toggle-active', selectLinkedActive);
      updateHint();
    });
  }

  if (selectEnhancedBtn) {
    selectEnhancedBtn.addEventListener('click', () => {
      if (!indexPickerSelectedIndex || !Array.isArray(indexPickerSelectedIndex.codes)) return;
      if (!selectEnhancedActive) {
        fundListEl.querySelectorAll('.index-picker-fund-item').forEach(row => {
          const code = row.dataset.code;
          if (!code) return;
          if (row.dataset.isEnhanced === '1') indexPickerSelectedCodes.add(code);
        });
        fundListEl.querySelectorAll('.index-picker-fund-item').forEach(row => {
          const code = row.dataset.code;
          if (!code) return;
          row.classList.toggle('index-picker-fund-item-selected', indexPickerSelectedCodes.has(code));
        });
        selectEnhancedActive = true;
      } else {
        fundListEl.querySelectorAll('.index-picker-fund-item').forEach(row => {
          const code = row.dataset.code;
          if (!code) return;
          if (row.dataset.isEnhanced === '1') indexPickerSelectedCodes.delete(code);
        });
        fundListEl.querySelectorAll('.index-picker-fund-item').forEach(row => {
          const code = row.dataset.code;
          if (!code) return;
          if (indexPickerSelectedCodes.has(code)) {
            row.classList.add('index-picker-fund-item-selected');
          } else {
            row.classList.remove('index-picker-fund-item-selected');
          }
        });
        selectEnhancedActive = false;
      }
      if (selectEnhancedBtn) selectEnhancedBtn.classList.toggle('index-picker-toggle-active', selectEnhancedActive);
      updateHint();
    });
  }

  if (invertBtn) {
    invertBtn.addEventListener('click', () => {
      fundListEl.querySelectorAll('.index-picker-fund-item').forEach(row => {
        const code = row.dataset.code;
        if (!code) return;
        if (indexPickerSelectedCodes.has(code)) {
          indexPickerSelectedCodes.delete(code);
          row.classList.remove('index-picker-fund-item-selected');
        } else {
          indexPickerSelectedCodes.add(code);
          row.classList.add('index-picker-fund-item-selected');
        }
      });
      updateHint();
    });
  }

  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      if (!indexPickerSelectedCodes.size) {
        closeModal(backdrop);
        return;
      }
      for (const code of indexPickerSelectedCodes) {
        const data = await fetchFundFeeFromAPI(code);
        if (data) {
          addFundCard(data);
        } else {
          addFundCard({ code, name: `基金${code}` });
        }
      }
      closeModal(backdrop);
    });
  }
}
