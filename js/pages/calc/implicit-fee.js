import { fetchMorningstarHistory } from '../../data/morningstar-api.js';
import { latestImplicitReference, normalizeImplicitReference, effectiveAnnualFee } from '../../domain/implicit-fee.js';
import { parseRate } from '../../utils/format.js';

const controllers = new WeakMap();
export function readCardImplicitFee(card) { return controllers.get(card)?.read() || {}; }
export function disposeCardImplicitFee(card) { controllers.get(card)?.destroy(); }

export function setupCardImplicitFee(card, initial, onChange) {
  const root = card.querySelector('.card-implicit');
  const check = root.querySelector('input');
  const value = root.querySelector('.card-implicit-value');
  const status = root.querySelector('.card-implicit-status');
  const action = root.querySelector('button');
  let code = card.dataset.fundCode || '', version = 0, latest = null, failed = false;
  let reference = normalizeImplicitReference(initial?.implicitReference, code);
  check.checked = initial?.includeImplicitFee === true && !!reference;
  function read() {
    return { includeImplicitFee: check.checked && !!reference, implicitFee: reference?.rate ?? null, implicitReference: reference && { ...reference } };
  }
  function render() {
    check.disabled = !reference;
    value.textContent = reference ? `${(reference.rate * 100).toFixed(2)}%` : '—';
    root.classList.toggle('is-included', check.checked && !!reference);
    const annual = effectiveAnnualFee({ annualFee: parseRate(card.querySelector('.input-annual-fee').value), ...read() });
    root.querySelector('.card-implicit-total').textContent = `测算年化 ${(annual * 100).toFixed(2)}%${check.checked ? ' · 含隐性估算' : ' · 未计隐性'}`;
    root.querySelector('a').href = `#/fund/${code}`;
    root.querySelector('a').hidden = !/^\d{6}$/.test(code);
    action.hidden = !(failed || reference && latest && (reference.date !== latest.date || reference.rate !== latest.rate));
    action.textContent = failed ? '重试' : '使用最新';
  }
  async function load(nextCode = code, reset = false, refresh = false) {
    const token = ++version;
    code = nextCode; failed = false; latest = null;
    if (reset) { reference = null; check.checked = false; }
    render();
    if (!/^\d{6}$/.test(code)) { status.textContent = '添加基金代码后可查看晨星数据'; return; }
    status.textContent = reference ? `晨星 · ${reference.date} · 已保存参考，正在核对` : '正在加载晨星历史参考…';
    try {
      const data = await fetchMorningstarHistory(code, { refresh });
      if (token !== version || !card.isConnected) return;
      latest = latestImplicitReference(data, code);
      if (!reference) reference = latest;
      status.textContent = reference ? `晨星 · ${reference.date}${latest && latest.date !== reference.date ? ` · 最新可用 ${latest.date}` : ''}` : '晨星暂无有效隐性费率，不按零值估算';
      render(); onChange();
    } catch {
      if (token !== version || !card.isConnected) return;
      failed = true;
      status.textContent = reference ? `晨星 · ${reference.date} · 已保存参考；最新数据加载失败` : '晨星数据加载失败，可重试';
      render();
    }
  }
  check.addEventListener('change', () => { render(); onChange(); });
  card.querySelector('.input-annual-fee').addEventListener('input', render);
  action.addEventListener('click', () => {
    if (failed) { void load(code, false, true); return; }
    reference = latest;
    status.textContent = `晨星 · ${reference.date}`;
    render(); onChange();
  });
  const controller = { read, load, destroy() { version++; controllers.delete(card); } };
  controllers.set(card, controller);
  void load();
  return controller;
}
