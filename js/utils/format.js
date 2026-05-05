/**
 * 格式化与基础类型解析工具
 */

/** 解析百分比输入为小数 */
export function parseRate(val) {
  if (val === '' || val == null) return 0;
  const n = parseFloat(String(val).replace('%', ''));
  return isNaN(n) ? 0 : n / 100;
}

/** 格式化为百分比显示 */
export function formatRate(rate) {
  return (rate * 100).toFixed(2) + '%';
}

/** 解析天数输入，空或无效返回 null */
export function parseDaysInput(val) {
  if (val == null || String(val).trim() === '') return null;
  const n = parseInt(String(val).trim(), 10);
  if (isNaN(n) || n < 0) return null;
  return n;
}

/** HTML 转义：依赖 DOM API（浏览器环境） */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/** 打乱数组（Fisher–Yates） */
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
