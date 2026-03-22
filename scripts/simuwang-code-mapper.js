/**
 * 排排网 公募代码 → 内部代码 自动翻页提取脚本
 *
 * 使用方法：
 *   1. 浏览器打开 https://dc.simuwang.com/jjpm/ 并登录
 *   2. F12 → Console，粘贴本文件全部内容并回车
 *   3. 脚本自动开始逐页提取，完成后自动下载 JSON
 *
 * 基于实际 DOM 结构：
 *   - 每行: #table-wrap table > tbody > tr.relative
 *   - 内部代码: tr 内 a[href*="/product/MF"] 的 href
 *   - 公募代码: tr 内 div.c-black\/60 > span (6位数字)
 *   - 翻页: button.btn-next[aria-disabled="false"]
 */

(async function simuwangMapper() {
  'use strict';

  const DELAY_MS    = 1500;   // 翻页后等待渲染的时间（毫秒）
  const MAX_PAGES   = 9999;   // 安全上限，实际会在无数据时自动停止
  const LOG_EVERY   = 10;     // 每 N 页打印一次进度

  const mapping = {};         // { "161226": "MF00003TMH", ... }
  let totalExtracted = 0;
  let pageNum = 1;
  let consecutiveEmpty = 0;

  // ---- 从当前页面 DOM 提取映射 ----
  function extractCurrentPage() {
    let count = 0;
    const rows = document.querySelectorAll('#table-wrap table tbody tr.relative');

    rows.forEach(row => {
      // 1) 内部代码：从产品链接中提取
      const link = row.querySelector('a[href*="/product/MF"]');
      if (!link) return;
      const hrefMatch = link.getAttribute('href').match(/\/product\/(MF[A-Z0-9]+)\.html/i);
      if (!hrefMatch) return;
      const internalCode = hrefMatch[1].toUpperCase();

      // 2) 公募代码：code 区域的 span，或回退到行文本中匹配6位数字
      let publicCode = null;

      // 精确路径：div 内含 text-12 类的容器下的 span
      const codeSpans = row.querySelectorAll('td span');
      for (const sp of codeSpans) {
        const txt = sp.textContent.trim();
        if (/^\d{6}$/.test(txt)) {
          publicCode = txt;
          break;
        }
      }

      // 回退：从整行文本中找第一个独立6位数字
      if (!publicCode) {
        const m = row.textContent.match(/(?<!\d)(\d{6})(?!\d)/);
        if (m) publicCode = m[1];
      }

      if (publicCode && internalCode) {
        if (!mapping[publicCode]) count++;
        mapping[publicCode] = internalCode;
      }
    });

    return count;
  }

  // ---- 点击下一页 ----
  function clickNext() {
    const btn = document.querySelector('button.btn-next');
    if (!btn || btn.getAttribute('aria-disabled') === 'true' || btn.disabled) {
      return false;
    }
    btn.click();
    return true;
  }

  // ---- 等待页面数据更新 ----
  function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ---- 等待表格行出现变化 ----
  async function waitForTableUpdate(oldFirstCode, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await wait(300);
      const firstRow = document.querySelector('#table-wrap table tbody tr.relative');
      if (!firstRow) continue;
      const spans = firstRow.querySelectorAll('td span');
      for (const sp of spans) {
        const txt = sp.textContent.trim();
        if (/^\d{6}$/.test(txt) && txt !== oldFirstCode) return true;
      }
    }
    return false;
  }

  // ---- 获取当前页第一个公募代码（用于检测翻页是否完成） ----
  function getFirstCode() {
    const firstRow = document.querySelector('#table-wrap table tbody tr.relative');
    if (!firstRow) return null;
    const spans = firstRow.querySelectorAll('td span');
    for (const sp of spans) {
      const txt = sp.textContent.trim();
      if (/^\d{6}$/.test(txt)) return txt;
    }
    return null;
  }

  // ==================== 主流程 ====================

  console.log('%c🚀 排排网代码映射提取开始...', 'color: #00ff00; font-size: 16px; font-weight: bold');
  console.log('%c提示：提取过程中请勿手动操作页面', 'color: #ffcc00; font-size: 12px');

  // 提取第一页
  let newCount = extractCurrentPage();
  totalExtracted += newCount;
  console.log(`%c第 1 页: +${newCount} 条 (累计 ${Object.keys(mapping).length})`, 'color: #00ccff');

  // 自动翻页循环
  for (pageNum = 2; pageNum <= MAX_PAGES; pageNum++) {
    const oldFirst = getFirstCode();

    if (!clickNext()) {
      console.log('%c已到最后一页，翻页按钮不可用', 'color: #ffcc00');
      break;
    }

    // 等待表格数据刷新（通过检测首行代码变化）
    const updated = await waitForTableUpdate(oldFirst);
    if (!updated) {
      // 额外等待一下再试
      await wait(DELAY_MS);
    }

    newCount = extractCurrentPage();
    totalExtracted += newCount;

    if (newCount === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 3) {
        console.log('%c连续 3 页无新数据，停止', 'color: #ffcc00');
        break;
      }
    } else {
      consecutiveEmpty = 0;
    }

    if (pageNum % LOG_EVERY === 0) {
      console.log(
        `%c进度: 第 ${pageNum} 页 | 本页 +${newCount} | 累计 ${Object.keys(mapping).length} 条`,
        'color: #00ccff'
      );
    }

    // 固定间隔，避免请求过快
    await wait(DELAY_MS);
  }

  // ==================== 完成 ====================

  const total = Object.keys(mapping).length;
  console.log(
    `%c✅ 提取完成！共 ${pageNum - 1} 页，${total} 条映射`,
    'color: #00ff00; font-size: 16px; font-weight: bold'
  );

  // 存到全局变量，方便后续操作
  window.__simuwangMapping = mapping;

  // 自动下载
  const json = JSON.stringify(mapping, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `simuwang-code-mapping-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  console.log('%c📥 已自动下载 JSON 文件', 'color: #00ff00; font-size: 14px');

  // 打印使用提示
  console.log(`
%c后续操作：
  window.__simuwangMapping          // 查看全部映射
  window.__simuwangMapping['000001'] // 查单个代码
  
  // 重新下载
  (() => {
    const j = JSON.stringify(window.__simuwangMapping, null, 2);
    const b = new Blob([j], {type:'application/json'});
    const u = URL.createObjectURL(b);
    Object.assign(document.createElement('a'), {href:u, download:'mapping.json'}).click();
  })()
  
  // 复制到剪贴板
  navigator.clipboard.writeText(JSON.stringify(window.__simuwangMapping, null, 2))
`, 'color: #aaa; font-size: 11px');

  return mapping;
})();
