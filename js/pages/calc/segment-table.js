/**
 * 计算器页 —— 卖出费率「分段表」工具集（per-card）。
 *
 * 表格语义：
 * - 每行是一段持有天数 → 该段对应的卖出费率。
 * - 普通段：`{ to: <天数>, rate: <小数> }`，表示"持有 ≤ to 天时"用此费率。
 * - 永久段：`{ to: null, rate: <小数> }`，表示"持有 > 上一段 to"的兜底费率，
 *   同时锁定 days 列显示「永久」标签，避免用户误编辑。
 *
 * 兼容：旧版 ziva 快照里用 `{ days, unbounded }` 字段；renderSegmentRow 会自动迁移。
 *
 * 所有函数都接受 tbody / 容器 + 回调，不持有自己的全局状态；
 * 调用方（createFundCard）通过 `onUpdate` 触发图表重算 + saveState，
 * 通过 `onRowChange` 触发"快捷按钮"重渲染。
 */

import { parseRate, formatRate } from '../../utils/format.js';
import { QUICK_SEGMENT_DAYS } from '../../domain/calc-defaults.js';

/**
 * 据持有天数 + 卖出费率换算年化费率，写入行的 title 作悬浮提示。
 * 无效输入时清空 title。
 * @param {HTMLTableRowElement} row
 */
export function updateSegmentRowTitle(row) {
  const daysInput = row.querySelector('.input-days');
  const rateInput = row.querySelector('.input-rate');
  const days = parseInt(daysInput?.value, 10);
  const rate = parseRate(rateInput?.value);
  if (!isNaN(days) && days > 0) {
    const annualized = rate * (365 / days);
    row.title = `折合年化约 ${formatRate(annualized)}`;
  } else {
    row.title = '';
  }
}

/**
 * 在 tbody 中追加一行分段，并绑定输入 / 删除事件。
 *
 * @param {HTMLElement} container       目标 <tbody>
 * @param {{ to:number|null, rate:number, days?:number, unbounded?:boolean }} [seg]
 *        段配置；可传旧版 {days, unbounded} 自动迁移
 * @param {() => void} [onUpdate]       值变化时调用（debounced 重算）
 * @param {() => void} [onRowChange]    行数变化时调用（重渲染快捷按钮）
 * @returns {HTMLTableRowElement}
 */
export function renderSegmentRow(container, seg = { to: 7, rate: 0 }, onUpdate, onRowChange) {
  // 兼容旧 ziva 快照
  if (!('to' in seg) && (seg.days !== undefined || seg.unbounded)) {
    seg = { to: seg.unbounded ? null : (seg.days ?? null), rate: seg.rate };
  }
  const row = document.createElement('tr');
  row.className = 'segment-row';
  const isUnbounded = seg.to === null;
  const daysVal = seg.to != null ? seg.to : '';
  const rateVal = seg.rate != null && seg.rate > 0 ? (seg.rate * 100).toFixed(2) : '';
  if (isUnbounded) {
    row.dataset.unbounded = 'true';
    row.innerHTML = `
      <td class="unbounded-days-cell">永久</td>
      <td><input type="text" class="input-rate" value="${rateVal}" placeholder="0.00"></td>
      <td class="segment-actions"><button type="button" class="segment-del-btn" title="删除该行" aria-label="删除该行">×</button></td>
    `;
  } else {
    row.innerHTML = `
      <td><input type="number" class="input-days" value="${daysVal}" min="1" placeholder="期限"></td>
      <td><input type="text" class="input-rate" value="${rateVal}" placeholder="0.00"></td>
      <td class="segment-actions"><button type="button" class="segment-del-btn" title="删除该行" aria-label="删除该行">×</button></td>
    `;
  }
  container.appendChild(row);

  if (!isUnbounded) {
    updateSegmentRowTitle(row);
    row.addEventListener('mouseenter', () => updateSegmentRowTitle(row));
  }

  // 删除按钮：保留至少一行
  row.querySelector('.segment-del-btn').addEventListener('click', () => {
    if (container.querySelectorAll('.segment-row').length <= 1) return;
    row.remove();
    onRowChange?.();
    onUpdate?.();
  });

  // 天数变化：失焦后重排
  const daysInput = row.querySelector('.input-days');
  if (daysInput) {
    daysInput.addEventListener('blur', () => {
      sortSegmentRows(container);
      onRowChange?.();
      onUpdate?.();
    });
  }

  // 任意输入变化：刷新年化提示 + 通知更新
  row.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => {
      if (!isUnbounded) updateSegmentRowTitle(row);
      onUpdate?.();
    });
  });
  return row;
}

/** 按持有天数升序重排；永久段排最后。 */
export function sortSegmentRows(tbody) {
  const rows = Array.from(tbody.querySelectorAll('.segment-row'));
  const withDays = rows.map(row => {
    if (row.dataset.unbounded === 'true') return { row, days: Infinity };
    const days = parseInt(row.querySelector('.input-days')?.value, 10);
    return { row, days: !isNaN(days) && days > 0 ? days : Infinity };
  });
  withDays.sort((a, b) => a.days - b.days);
  withDays.forEach(({ row }) => tbody.appendChild(row));
}

/** 当前表中已存在的、有效的持有天数列表（不含永久段）。 */
export function getExistingDays(tbody) {
  return Array.from(tbody.querySelectorAll('.segment-row'))
    .filter(r => r.dataset.unbounded !== 'true')
    .map(r => parseInt(r.querySelector('.input-days')?.value, 10))
    .filter(d => !isNaN(d) && d > 0);
}

/** 是否已存在永久段。 */
export function hasUnboundedRow(tbody) {
  return !!tbody.querySelector('.segment-row[data-unbounded="true"]');
}

/**
 * 重渲染卡片下方的"快捷天数"按钮：
 * - 把 QUICK_SEGMENT_DAYS 中尚未在表格出现过的天数显示为按钮；
 * - 若尚无永久段，再补一颗「永久」按钮。
 * 点击按钮时调用 addQuickSegment / 直接 renderSegmentRow。
 *
 * @param {HTMLElement} tbody
 * @param {HTMLElement} quickContainer
 * @param {() => void} [onUpdate]
 * @param {() => void} [onRowChange]
 */
export function updateQuickButtons(tbody, quickContainer, onUpdate, onRowChange) {
  if (!quickContainer) return;
  const existing = getExistingDays(tbody);
  quickContainer.innerHTML = '';
  QUICK_SEGMENT_DAYS.forEach(days => {
    if (existing.includes(days)) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm';
    btn.dataset.days = days;
    btn.textContent = `${days}天`;
    btn.addEventListener('click', () => {
      addQuickSegment(tbody, days, onUpdate, onRowChange);
    });
    quickContainer.appendChild(btn);
  });
  if (!hasUnboundedRow(tbody)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm';
    btn.textContent = '永久';
    btn.title = '添加永久（无上限）段：(上一段, +∞)';
    btn.addEventListener('click', () => {
      renderSegmentRow(tbody, { to: null, rate: 0 }, onUpdate, onRowChange);
      sortSegmentRows(tbody);
      onRowChange?.();
      onUpdate?.();
    });
    quickContainer.appendChild(btn);
  }
}

/**
 * 添加一个快捷分段：若该天数已存在则忽略；新行只预填天数，费率留空让用户填写。
 * @param {HTMLElement} tbody
 * @param {number} days
 * @param {() => void} [onUpdate]
 * @param {() => void} [onRowChange]
 */
export function addQuickSegment(tbody, days, onUpdate, onRowChange) {
  const existing = getExistingDays(tbody);
  if (existing.includes(days)) return;
  renderSegmentRow(tbody, { to: days, rate: '' }, onUpdate, onRowChange);
  sortSegmentRows(tbody);
  onRowChange?.();
  onUpdate?.();
}
