/**
 * 缓存基金列表页 —— 基金详情查看弹窗。
 *
 * 一只基金的「查看」按钮点开后，可在两种视图间切换：
 * - JSON 视图：把 detail 直接 JSON.stringify 后塞进 <pre>。
 * - 表格视图：递归把对象 / 数组渲染成嵌套 <table>，便于阅读。
 *
 * 同时提供两枚外链按钮，跳转到天天基金 / 搜狐对应的费率页面（场外公募 vs 中港互认 走不同 URL）。
 *
 * 调用方提供：
 * - tbody:          基金列表 <tbody>，弹窗通过事件委托监听 .cached-fund-json-btn 的点击
 * - fundDetailMap:  按代码索引的详情对象，传入时已包含从 allfund.json 的预加载数据；
 *                   若代码缺失会按需 fetch `data/allfund/funds/<code>.json` 并把结果写回该对象。
 */
import { openModal, closeModal } from '../../utils/dom.js';

/**
 * @param {Object} opts
 * @param {HTMLElement|null} opts.tbody
 * @param {Record<string, any>} opts.fundDetailMap  共享引用，会被本模块写入新拉取的详情
 */
export function setupJsonModal({ tbody, fundDetailMap }) {
  const jsonModal      = document.getElementById('fund-json-modal');
  const jsonContent    = document.getElementById('fund-json-content');
  const jsonTable      = document.getElementById('fund-json-table');
  const jsonCloseBtn   = document.getElementById('fund-json-close');
  const jsonCancelBtn  = document.getElementById('fund-json-cancel');
  const jsonToTableBtn = document.getElementById('fund-json-to-table');
  const jsonOpenEmBtn  = document.getElementById('fund-json-open-em');
  const jsonOpenSohuBtn = document.getElementById('fund-json-open-sohu');

  // 弹窗内部状态：当前展示的基金 + 视图模式
  /** @type {any|null} */
  let currentFundDetail = null;
  /** @type {'json'|'table'} */
  let currentFundViewMode = 'json';
  /** @type {string} */
  let currentFundCode = '';

  /** 把 JSON 转义后塞入单元格；交给浏览器 textContent 完成 HTML 转义 */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 把详情递归渲染为嵌套 <table>。
   * 内部维护 seen 集合避免循环引用导致栈溢出。
   * @param {any} detail
   */
  function renderFundDetailAsTable(detail) {
    if (!jsonTable) return;
    if (!detail) {
      jsonTable.innerHTML = '<div class="modal-json-table-empty">无可用数据</div>';
      return;
    }
    /** @type {Set<any>} */
    const seen = new Set();

    function renderValue(value) {
      if (value === null || value === undefined) return '';
      const t = typeof value;
      if (t === 'string' || t === 'number' || t === 'boolean') {
        return escapeHtml(String(value));
      }
      if (t === 'object') {
        if (seen.has(value)) {
          return '<span class="modal-json-circular">[Circular]</span>';
        }
        seen.add(value);
        const html = Array.isArray(value) ? renderArray(value) : renderObject(value, true);
        seen.delete(value);
        return html;
      }
      return escapeHtml(String(value));
    }

    function renderObject(obj, nested = false) {
      const entries = Object.entries(obj);
      if (!entries.length) return '<span class="modal-json-empty-object">{}</span>';
      const rows = entries.map(([key, value]) =>
        `<tr><th>${escapeHtml(key)}</th><td>${renderValue(value)}</td></tr>`
      );
      const cls = nested ? 'modal-json-table-inner modal-json-table-inner-nested' : 'modal-json-table-inner';
      return `<table class="${cls}"><tbody>${rows.join('')}</tbody></table>`;
    }

    function renderArray(arr) {
      if (!arr.length) return '<span class="modal-json-empty-array">[]</span>';
      const rows = arr.map((value, idx) =>
        `<tr><th>[${idx}]</th><td>${renderValue(value)}</td></tr>`
      );
      return `<table class="modal-json-table-inner modal-json-table-inner-nested"><tbody>${rows.join('')}</tbody></table>`;
    }

    jsonTable.innerHTML = renderObject(detail, false);
  }

  /* ========== 列表行 「查看」 按钮：拉取详情 + 打开弹窗 ========== */

  if (tbody && jsonModal && jsonContent && jsonTable) {
    tbody.addEventListener('click', async (e) => {
      const target = /** @type {HTMLElement|null} */ (
        e.target instanceof HTMLElement ? e.target.closest('.cached-fund-json-btn') : null
      );
      if (!target) return;
      const code = target.getAttribute('data-code') || '';
      if (!code) return;
      currentFundCode = code;

      // 内存中无该基金详情时，按需从分片文件加载（allfund.json 已被列表预加载部分覆盖）
      let detail = fundDetailMap[code] || null;
      if (!detail) {
        try {
          const res = await fetch(`data/allfund/funds/${code}.json`);
          if (res.ok) {
            detail = await res.json();
            fundDetailMap[code] = detail;
          }
        } catch (err) {
          console.error('加载基金详情失败:', err);
        }
      }

      currentFundDetail = detail;
      if (!detail) {
        currentFundViewMode = 'json';
        jsonContent.textContent = `无法加载代码为 ${code} 的详细数据。`;
        jsonContent.style.display = 'block';
        jsonTable.style.display = 'none';
        if (jsonToTableBtn) jsonToTableBtn.textContent = '转为表格';
      } else {
        // 默认以表格视图展示，更适合人眼
        currentFundViewMode = 'table';
        jsonContent.textContent = JSON.stringify(detail, null, 2);
        renderFundDetailAsTable(detail);
        jsonContent.style.display = 'none';
        jsonTable.style.display = 'block';
        if (jsonToTableBtn) jsonToTableBtn.textContent = '查看 JSON';
      }
      openModal(jsonModal);
    });
  }

  /* ========== 关闭：右上角 X / 取消按钮 / Esc ========== */

  [jsonCloseBtn, jsonCancelBtn].forEach(btn => {
    if (!btn || !jsonModal) return;
    btn.addEventListener('click', () => closeModal(jsonModal));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && jsonModal && jsonModal.classList.contains('modal-visible')) {
      closeModal(jsonModal);
    }
  });

  /* ========== 视图切换：JSON ↔ 表格 ========== */

  if (jsonToTableBtn && jsonModal && jsonContent && jsonTable) {
    jsonToTableBtn.addEventListener('click', () => {
      if (!currentFundDetail) return;
      if (currentFundViewMode === 'json') {
        renderFundDetailAsTable(currentFundDetail);
        jsonContent.style.display = 'none';
        jsonTable.style.display = 'block';
        jsonToTableBtn.textContent = '查看 JSON';
        currentFundViewMode = 'table';
      } else {
        jsonContent.textContent = JSON.stringify(currentFundDetail, null, 2);
        jsonContent.style.display = 'block';
        jsonTable.style.display = 'none';
        jsonToTableBtn.textContent = '转为表格';
        currentFundViewMode = 'json';
      }
    });
  }

  /* ========== 外链：天天基金 / 搜狐 ========== */

  /**
   * 跳转到外部费率页：
   * - em + 968xxx (中港互认 / 海外基金) → overseas.1234567.com.cn
   * - em + 其他                          → fundf10.eastmoney.com 的 jjfl 页
   * - sohu                               → q.fund.sohu.com
   * @param {'em'|'sohu'} type
   */
  const openExternalRatePage = (type) => {
    const code = (currentFundCode || '').trim();
    if (!code) return;
    let url = '';
    if (type === 'em') {
      if (/^968\d{3}$/.test(code)) {
        url = `https://overseas.1234567.com.cn/${code}`;
      } else {
        url = `https://fundf10.eastmoney.com/jjfl_${code}.html`;
      }
    } else if (type === 'sohu') {
      url = `https://q.fund.sohu.com/${code}/index.shtml?code=${code}`;
    }
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (jsonOpenEmBtn)   jsonOpenEmBtn.addEventListener('click', () => openExternalRatePage('em'));
  if (jsonOpenSohuBtn) jsonOpenSohuBtn.addEventListener('click', () => openExternalRatePage('sohu'));
}
