/**
 * 通用 DOM 操作工具
 */

export function openModal(backdrop) {
  if (!backdrop) return;
  backdrop.classList.add('modal-visible');
  backdrop.setAttribute('aria-hidden', 'false');
}

export function closeModal(backdrop) {
  if (!backdrop) return;
  backdrop.classList.remove('modal-visible');
  backdrop.setAttribute('aria-hidden', 'true');
}
