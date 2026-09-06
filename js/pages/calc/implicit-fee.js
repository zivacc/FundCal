import { fetchMorningstarHistory } from '../../data/morningstar-api.js';
import { latestImplicitReference, normalizeImplicitReference } from '../../domain/implicit-fee.js';

const controllers = new WeakMap();
export function readCardImplicitFee(card) { return controllers.get(card)?.read() || {}; }
export function disposeCardImplicitFee(card) { controllers.get(card)?.destroy(); }

export function setupCardImplicitFee(card, initial, onChange) {
  const root = card.querySelector('.card-implicit');
  const value = root.querySelector('.card-implicit-value');
  const action = root.querySelector('.card-implicit-refresh');
  let code = card.dataset.fundCode || '', version = 0, latest = null, failed = false;
  let reference = normalizeImplicitReference(initial?.implicitReference, code);
  function read() {
    return { includeImplicitFee: !!reference, implicitFee: reference?.rate ?? null, implicitReference: reference && { ...reference } };
  }
  function render(message) {
    value.textContent = reference ? (reference.rate * 100).toFixed(2) : '—';
    value.disabled = !reference && !failed;
    if (failed && !reference) value.textContent = '重试';
    root.title = message;
    value.setAttribute('aria-label', `隐性年化 ${reference ? `${(reference.rate * 100).toFixed(2)}%` : '暂无'}；${message}`);
    action.hidden = !(reference && (failed || latest && (reference.date !== latest.date || reference.rate !== latest.rate)));
    action.title = failed ? '重试加载晨星数据' : `使用最新晨星参考 ${latest?.date}`;
  }
  async function load(nextCode = code, reset = false, refresh = false) {
    const token = ++version;
    code = nextCode; failed = false; latest = null;
    if (reset) reference = null;
    render(reference ? `晨星 · ${reference.date} · 自动计入测算` : '正在加载晨星历史参考');
    if (!/^\d{6}$/.test(code)) { render('添加基金代码后可查看晨星数据'); return; }
    try {
      const data = await fetchMorningstarHistory(code, { refresh });
      if (token !== version || !card.isConnected) return;
      latest = latestImplicitReference(data, code);
      if (!reference) reference = latest;
      render(reference ? `晨星 · ${reference.date} · 自动计入测算；点击数值查看来源` : '晨星暂无有效隐性费率，当前测算未包含此项');
      onChange();
    } catch {
      if (token !== version || !card.isConnected) return;
      failed = true;
      render(reference ? `晨星 · ${reference.date} · 已计入保存值；最新数据加载失败` : '晨星数据加载失败，点击重试；当前测算未包含此项');
    }
  }
  value.addEventListener('click', () => { if (failed && !reference) void load(code, false, true); else window.location.hash = `#/fund/${code}`; });
  action.addEventListener('click', () => {
    if (failed) { void load(code, false, true); return; }
    reference = latest;
    render(`晨星 · ${reference.date} · 自动计入测算；点击数值查看来源`);
    onChange();
  });
  const controller = { read, load, destroy() { version++; controllers.delete(card); } };
  controllers.set(card, controller);
  void load();
  return controller;
}
