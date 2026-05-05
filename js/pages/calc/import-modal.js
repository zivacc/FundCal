/**
 * 计算器页 - 导入弹窗 + 导入结果确认弹窗
 *
 * 通过 deps 注入与主页面的耦合点，自身只持有"已解析的导入项"局部状态。
 */

import { escapeHtml } from '../../utils/format.js';
import { openModal, closeModal } from '../../utils/dom.js';
import { fetchFundFeeFromAPI } from '../../data/fund-api.js';
import { extractStateFromSnapshot } from './state.js';
import {
  normalizeImportText,
  parseImportFromText,
  parseImportFromLines,
  readFileAsText,
  readExcelFirstColumn,
} from './import-utils.js';

/**
 * @param {Object} deps
 * @param {(data: any) => void} deps.addFundCard
 * @param {(state: any) => void} deps.restoreState
 * @param {() => void} deps.saveState
 * @param {() => Promise<any[]>} deps.ensureSearchIndex
 */
export function setupImportModal(deps) {
  const { addFundCard, restoreState, saveState, ensureSearchIndex } = deps;

  const btn = document.getElementById('import-funds');
  const backdrop = document.getElementById('fund-import-modal');
  const confirmBackdrop = document.getElementById('fund-import-confirm-modal');
  const closeBtn = document.getElementById('fund-import-modal-close');
  const cancelBtn = document.getElementById('fund-import-modal-cancel');
  const startBtn = document.getElementById('fund-import-start');
  const textArea = document.getElementById('fund-import-text');
  const fileInput = document.getElementById('fund-import-file');
  const fileNameEl = document.getElementById('fund-import-file-name');
  const dropzone = document.getElementById('fund-import-dropzone');

  const confirmCloseBtn = document.getElementById('fund-import-confirm-close');
  const confirmCancelBtn = document.getElementById('fund-import-confirm-cancel');
  const confirmApplyBtn = document.getElementById('fund-import-confirm-apply');
  const resultListEl = document.getElementById('fund-import-result-list');
  const emptyHintEl = document.getElementById('fund-import-empty-hint');

  if (!btn || !backdrop || !textArea || !startBtn || !confirmBackdrop || !resultListEl) return;

  /** @type {Array<{ code?: string, name: string, source?: string }>} */
  let importParsedItems = [];

  function renderImportResultsList(container, items) {
    if (!container) return;
    container.innerHTML = '';
    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'fund-import-result-item';
      row.dataset.index = String(index);
      row.innerHTML = `
        <div class="fund-import-result-main">
          <div class="fund-import-result-line1">
            <span class="fund-import-result-name">${escapeHtml(item.name || (item.code ? '基金' + item.code : '未命名基金'))}</span>
            ${item.code ? `<span class="fund-import-result-code">${escapeHtml(item.code)}</span>` : ''}
            <span class="fund-import-result-badge">${item.code ? '按代码匹配' : '按名称匹配'}</span>
          </div>
          <div class="fund-import-result-source">来源：${escapeHtml(item.source || '')}</div>
        </div>
        <div class="fund-import-result-actions">
          <button type="button" class="btn btn-sm btn-secondary fund-import-remove-item">删除</button>
        </div>
      `;
      const removeBtn = row.querySelector('.fund-import-remove-item');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          importParsedItems.splice(index, 1);
          renderImportResultsList(container, importParsedItems);
          if (emptyHintEl) emptyHintEl.hidden = importParsedItems.length > 0;
        });
      }
      container.appendChild(row);
    });
  }

  async function applyImportedFunds(items) {
    for (const item of items) {
      if (item.code) {
        const data = await fetchFundFeeFromAPI(item.code);
        if (data) {
          addFundCard(data);
          continue;
        }
      }
      addFundCard({
        name: item.name || (item.code ? `基金${item.code}` : '未命名基金'),
        ...(item.code ? { code: item.code } : {})
      });
    }
  }

  function resetImportState() {
    importParsedItems = [];
    if (textArea) textArea.value = '';
    if (fileInput) fileInput.value = '';
    if (fileNameEl) fileNameEl.textContent = '';
    if (resultListEl) resultListEl.innerHTML = '';
    if (emptyHintEl) emptyHintEl.hidden = true;
  }

  btn.addEventListener('click', () => {
    resetImportState();
    openModal(backdrop);
    textArea.focus();
  });

  [closeBtn, cancelBtn].forEach(el => {
    if (!el) return;
    el.addEventListener('click', () => {
      closeModal(backdrop);
    });
  });

  if (confirmCloseBtn) {
    confirmCloseBtn.addEventListener('click', () => {
      closeModal(confirmBackdrop);
    });
  }

  if (confirmCancelBtn) {
    confirmCancelBtn.addEventListener('click', () => {
      // 返回导入弹窗：关闭确认弹窗，重新打开导入弹窗
      closeModal(confirmBackdrop);
      openModal(backdrop);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (confirmBackdrop.classList.contains('modal-visible')) {
        closeModal(confirmBackdrop);
      } else if (backdrop.classList.contains('modal-visible')) {
        closeModal(backdrop);
      }
    }
  });

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!fileNameEl) return;
      if (file) {
        fileNameEl.textContent = `已选择：${file.name}`;
      } else {
        fileNameEl.textContent = '';
      }
    });
  }

  if (dropzone) {
    ['dragenter', 'dragover'].forEach(evt => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('import-file-dragover');
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('import-file-dragover');
      });
    });
    dropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (!dt || !dt.files || dt.files.length === 0 || !fileInput) return;
      const file = dt.files[0];
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      if (fileNameEl) fileNameEl.textContent = `已选择：${file.name}`;
    });
  }

  startBtn.addEventListener('click', async () => {
    const file = fileInput && fileInput.files && fileInput.files[0];
    const rawText = textArea.value || '';
    startBtn.disabled = true;
    try {
      // 1) 优先处理 .ziva 快照导入：直接恢复整个页面状态
      if (file) {
        const nameLower = file.name.toLowerCase();
        if (nameLower.endsWith('.ziva')) {
          try {
            const txt = await readFileAsText(file);
            const parsed = JSON.parse(txt);
            const state = extractStateFromSnapshot(parsed);
            if (state && state.funds) {
              closeModal(backdrop);
              closeModal(confirmBackdrop);
              restoreState(state);
              saveState();
              return;
            }
          } catch (e) {
            // 若解析失败则继续按普通文本/表格逻辑处理
          }
        }
      }

      // 2) 常规导入：文本 / CSV / Excel
      let items = [];
      if (file) {
        const type = file.type || '';
        const nameLower = file.name.toLowerCase();
        if (type.startsWith('text/') || nameLower.endsWith('.txt') || nameLower.endsWith('.csv')) {
          const txt = await readFileAsText(file);
          const lines = normalizeImportText(txt).split('\n').map(line => {
            const first = line.split(/[,;\t]/)[0];
            return first;
          });
          items = await parseImportFromLines(lines, ensureSearchIndex);
        } else if (nameLower.endsWith('.xls') || nameLower.endsWith('.xlsx')) {
          const lines = await readExcelFirstColumn(file);
          items = await parseImportFromLines(lines, ensureSearchIndex);
        }
      }
      if (!file || items.length === 0) {
        const textItems = await parseImportFromText(rawText, ensureSearchIndex);
        if (textItems.length > 0) {
          items = textItems;
        }
      }
      importParsedItems = items;
      closeModal(backdrop);
      if (!items.length) {
        importParsedItems = [];
        resultListEl.innerHTML = '';
        if (emptyHintEl) emptyHintEl.hidden = false;
        openModal(confirmBackdrop);
        return;
      }
      renderImportResultsList(resultListEl, items);
      if (emptyHintEl) emptyHintEl.hidden = items.length > 0;
      openModal(confirmBackdrop);
    } finally {
      startBtn.disabled = false;
    }
  });

  confirmApplyBtn?.addEventListener('click', async () => {
    if (!importParsedItems.length) {
      closeModal(confirmBackdrop);
      return;
    }
    confirmApplyBtn.disabled = true;
    try {
      await applyImportedFunds(importParsedItems);
      importParsedItems = [];
      closeModal(confirmBackdrop);
    } finally {
      confirmApplyBtn.disabled = false;
    }
  });
}
