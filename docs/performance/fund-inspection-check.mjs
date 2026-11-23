/** Isolated browser regression. No public DB reads/writes or upstream requests.
 * PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROME_PATH=/path/to/chrome \
 *   node docs/performance/fund-inspection-check.mjs
 */
import assert from 'node:assert/strict';
import { createStaticServer } from '../../scripts/serve-static.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = createStaticServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const funds = Array.from({ length: 10 }, (_, i) => ({ code: String(i + 1).padStart(6, '0'), name: `测试基金${i + 1}` }));
const raw = code => ({ ...funds.find(fund => fund.code === code), fundType: code === '000003' ? 'FOF' : '混合型',
  fundManager: '测试公司', annualFee: .012, buyFee: 0, operationFees: { managementFee: .01, custodyFee: .002, salesServiceFee: 0 },
  redeemSegments: [{ to: 7, rate: .015 }, { to: null, rate: 0 }], stageReturns: [], updatedAt: '2026-10-30', trackingIndexes: [] });
let fail = true;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(api => { window.FUND_FEE_API_BASE = api; }, `${base}/api/fund`);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), code = url.pathname.match(/\/fund\/(\d{6})/)?.[1];
    const json = body => route.fulfill({ json: body });
    if (url.pathname.endsWith('/search-index')) return json(funds);
    if (url.pathname.endsWith('/filter-options')) return json({});
    if (url.pathname.endsWith('/list')) return json({ page: 1, size: 100, total: 10, rows: funds.map(fund => raw(fund.code)) });
    if (url.pathname.endsWith('/morningstar')) return json({ periods: [
      { as_of_date: '2025-12-31', available: true, turnover_pct: code === '000001' ? 0 : 100, implicit_fee_pct: null, source_file: 'fixture.xlsx' },
      { as_of_date: '2024-12-31', available: code === '000001', turnover_pct: code === '000001' ? 20 : null, implicit_fee_pct: .2 },
    ] });
    if (url.pathname.endsWith('/fee')) {
      if (code === '000004') await new Promise(resolve => setTimeout(resolve, 350));
      if ((code === '000005' && fail) || code === '000006') return route.fulfill({ status: 503, json: {} });
      return json(raw(code));
    }
    if (url.pathname.endsWith('/related')) return json({ code, shareClasses: [{ code: '000002', name: '测试基金2', shareClass: 'C', available: true }],
      feederFunds: [], isFof: code === '000003', isFeeder: false, shareClassBasis: '测试关系', feederIndexAvailable: true });
    if (url.pathname.endsWith('/holdings')) return json({ code, status: 'available', asOfDate: '2026-09-30', source: '测试披露', coverage: 'top10',
      rows: [{ code: '000001', name: '测试基金1', weightPct: 9.5, available: true }, { code: '510310', name: '库外ETF', weightPct: 8, available: false }] });
    if (url.pathname.endsWith('/nav/compare')) return json({ series: [
      { ...funds[0], dates: ['20260907', '20260908'], navs: [1, 1.02], adjNavs: [1, 1.02] },
    ], stats: [], range: {} });
    if (url.pathname.endsWith('/compare')) return json({ series: [], stats: [], range: {} });
    if (url.pathname.endsWith('/stats/detail')) return json([]);
    return json({});
  });
  await page.route('**/data/allfund/funds/*.json', route => {
    const code = route.request().url().match(/(\d{6})\.json/)?.[1];
    return code === '000006' ? route.fulfill({ json: { ...raw(code), annualFee: 0 } }) : route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${base}/#/compare/000001,000002`);
  await page.locator('#fc-status').filter({ hasText: '已载入 2' }).waitFor();
  const navLens = page.locator('.top-rail-lens');
  const preview = page.locator('.top-rail-tab[data-route="list"]');
  await preview.hover();
  await page.waitForFunction(() => {
    const tab = document.querySelector('.top-rail-tab[data-route="list"]');
    const lens = document.querySelector('.top-rail-lens');
    return Math.abs(lens.getBoundingClientRect().left - tab.getBoundingClientRect().left) < 1;
  });
  assert.equal(await page.locator('.top-rail-tab[data-route="compare"]').getAttribute('aria-selected'), 'true');

  const metric = name => page.locator('#fc-table tr').filter({ has: page.locator('th[scope="row"]', { hasText: new RegExp(`^${name}$`) }) }).locator('td');
  const feeRow = metric('显性年化费率').first().locator('..');
  const surface = element => {
    const { backgroundColor, backgroundImage } = getComputedStyle(element);
    return [backgroundColor, backgroundImage];
  };
  const idle = await feeRow.evaluate(surface);
  await metric('显性年化费率').first().hover();
  await page.locator('#fc-table tr.has-table-lens').filter({ hasText: '显性年化费率' }).waitFor();
  assert.deepEqual(await feeRow.evaluate(surface), idle, 'hover preserves the row surface');
  const rowFrame = page.locator('.glass-table-frame');
  assert.equal(await rowFrame.count(), 1);
  for (const frame of [navLens, rowFrame]) {
    assert.deepEqual(await frame.evaluate(surface), ['rgba(0, 0, 0, 0)', 'none']);
    assert.equal(await frame.evaluate(el => getComputedStyle(el).maskComposite.split(',')[0]), 'exclude');
    assert.equal(await frame.evaluate(el => getComputedStyle(el).pointerEvents), 'none');
  }
  assert.match(await navLens.evaluate(el => getComputedStyle(el).backdropFilter), /blur\(0\.5px\)/);
  assert.deepEqual(await metric('显性年化费率').allTextContents(), ['1.20%', '1.20%']);
  assert.deepEqual(await metric('换手率').allTextContents(), ['0.00%', '100.00%']);
  await page.locator('#fc-period').selectOption('2024-12-31');
  assert.deepEqual(await metric('换手率').allTextContents(), ['20.00%', '—']);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow ${width}/${theme}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#fc-table .fund-drag-handle').first().focus();
  await page.keyboard.press('Enter');
  await page.locator('#basket-drop-target').waitFor();
  assert.match(await page.locator('#basket-drag-ghost').textContent(), /^1 只基金/);
  await page.keyboard.press('Escape');
  // An old response must never overwrite a newly selected comparison.
  await page.evaluate(() => { location.hash = '#/compare/000004'; });
  await page.locator('#fc-count').filter({ hasText: '1 / 8' }).waitFor();
  await page.evaluate(() => { location.hash = '#/compare/000001'; });
  await page.locator('#fc-status').filter({ hasText: '已载入 1' }).waitFor();
  await page.waitForTimeout(450);
  assert.equal(await page.locator('#fc-table thead [data-fund-drag]').getAttribute('data-fund-drag'), '000001');
  // One failed source/column is retryable without blanking other data.
  await page.evaluate(() => { location.hash = '#/compare/000001,000005'; });
  await page.locator('[data-retry="000005"]').waitFor();
  assert.deepEqual(await metric('显性年化费率').allTextContents(), ['1.20%', '—']);
  fail = false;
  await page.locator('[data-retry="000005"]').click();
  await page.locator('#fc-status').filter({ hasText: '已载入 2' }).waitFor();
  assert.deepEqual(await metric('显性年化费率').allTextContents(), ['1.20%', '1.20%']);
  await page.evaluate(() => { location.hash = '#/compare/000006'; });
  await page.locator('#fc-table').filter({ hasText: '备份资料' }).waitFor();
  assert.deepEqual(await metric('显性年化费率').allTextContents(), ['—']);
  // Oversized baskets leave the comparison untouched.
  await page.evaluate(async () => {
    const { basket } = await import('/js/data/basket.js');
    basket.add(Array.from({ length: 9 }, (_, i) => ({ code: String(i + 1).padStart(6, '0') })));
  });
  await page.locator('#fc-from-basket').click();
  await page.locator('#fc-status').filter({ hasText: '最多比较 8' }).waitFor();
  assert.equal(await page.locator('#fc-count').textContent(), '1 / 8');
  await page.locator('#fc-clear').click();
  await page.locator('#fc-empty').waitFor();
  await page.reload(); await page.locator('#fc-empty').waitFor();
  await page.locator('#fc-search').fill('000002'); await page.locator('#fc-add-code').click();
  await page.locator('#fc-status').filter({ hasText: '已载入 1' }).waitFor();
  // Related share links and FOF disclosure links keep code identity and report date.
  await page.evaluate(() => { location.hash = '#/fund/000003'; });
  await page.locator('[data-fof-holdings]').filter({ hasText: '2026-09-30' }).waitFor();
  assert.equal(await page.locator('[data-fof-holdings] a[href="#/fund/000001"]').count(), 1);
  assert.equal(await page.locator('[data-fof-holdings] a[href="https://fund.eastmoney.com/510310.html"]').count(), 1);
  await page.locator('a[href="#/compare/000003,000002"]').click();
  await page.locator('#fc-status').filter({ hasText: '已载入 2' }).waitFor();
  // The list now opens the dedicated comparison page.
  await page.evaluate(() => { location.hash = '#/list'; });
  const row = code => page.locator(`#cached-funds-tbody tr[data-code="${code}"]`);
  await row('000001').waitFor();
  await row('000001').locator('td').nth(2).click();
  await row('000002').locator('td').nth(2).click({ modifiers: ['Meta'] });
  await page.locator('#cached-funds-compare-btn').click();
  await page.locator('#fc-status').filter({ hasText: '已载入 2' }).waitFor();
  assert.ok(page.url().endsWith('#/compare/000001,000002'));

  // A hidden navigation rail must survive fullscreen resizing and restore its lens.
  await page.evaluate(fund => {
    localStorage.setItem('nav-compare-state', JSON.stringify({ v: 1, selected: [fund] }));
    location.hash = '#/nav';
  }, funds[0]);
  await page.locator('#nav-chart-canvas canvas').first().waitFor();
  await page.locator('#nav-chart-toolbar-fullscreen').click();
  await page.locator('.top-rail').waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.nav-fs-exit').click();
  await page.waitForFunction(() => {
    const tab = document.querySelector('.top-rail-tab[data-route="nav"]');
    const lens = document.querySelector('.top-rail-lens');
    return tab.offsetWidth > 0 && Math.abs(lens.getBoundingClientRect().left - tab.getBoundingClientRect().left) < 1;
  });
  assert.deepEqual(errors, []);
  console.log('Fund inspection browser checks passed: comparison, snapshots, failures, races, basket, links, responsive themes, NAV fullscreen.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
