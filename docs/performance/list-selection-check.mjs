/** Isolated UI regression; uses fixture responses and an external Playwright installation.
 * PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROME_PATH=/path/to/chrome \
 *   node docs/performance/list-selection-check.mjs
 */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const funds = Array.from({ length: 120 }, (_, i) => ({
  code: String(i + 1).padStart(6, '0'), name: `测试基金${i + 1}`, needsCrawl: i === 2,
}));
try {
  for (const touch of [false, true]) {
    const context = await browser.newContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 960 }, hasTouch: touch });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/fund/list?*', route => {
      const params = new URL(route.request().url()).searchParams;
      const n = Number(params.get('page')), size = Number(params.get('size'));
      let list = params.get('sort').endsWith('desc') ? [...funds].reverse() : funds;
      if (params.get('q')) list = list.filter(f => f.code.includes(params.get('q')));
      return route.fulfill({ json: { total: list.length, page: n, size, rows: list.slice((n - 1) * size, n * size) } });
    });
    await page.route('**/api/fund/filter-options*', route => route.fulfill({ json: {} }));
    await page.goto(process.env.FUND_CAL_URL || 'http://localhost:3456/#/list');
    const row = n => page.locator(`#cached-funds-tbody tr[data-code="${String(n).padStart(6, '0')}"]`);
    const cell = n => row(n).locator('td').nth(2);
    const selection = () => page.locator('#cached-funds-tbody tr[aria-selected="true"]').evaluateAll(rows => rows.map(r => Number(r.dataset.code)));
    const choose = async (n, modifiers = []) => touch ? cell(n).tap() : cell(n).click({ modifiers });
    await row(1).waitFor();
    await choose(1); await choose(4, ['Meta']);
    assert.deepEqual(await selection(), [1, 4]);
    await choose(1, ['Meta']); assert.deepEqual(await selection(), [4]);
    if (!touch) {
      // macOS reserves native Control-click for menus; verify the Windows event path separately.
      await cell(5).dispatchEvent('click', { ctrlKey: true });
      assert.deepEqual(await selection(), [4, 5]);
      await cell(5).dispatchEvent('click', { ctrlKey: true });
      await choose(2); await choose(6, ['Shift']);
      assert.deepEqual(await selection(), [2, 4, 5, 6]);
      await choose(4, ['Shift']); assert.deepEqual(await selection(), [2, 4]);
      await choose(1, ['Shift']); assert.deepEqual(await selection(), [1, 2]);
      assert.equal(await page.evaluate(() => String(getSelection())), '');
      await choose(6, ['Meta']); await choose(8, ['Meta', 'Shift']);
      assert.deepEqual(await selection(), [1, 2, 6, 7, 8]);
      await choose(7, ['Meta', 'Shift']); assert.deepEqual(await selection(), [1, 2, 6, 7]);
      await row(9).focus(); await page.keyboard.press('Space');
      assert.deepEqual(await selection(), [1, 2, 6, 7, 9]);
    }
    const before = await selection();
    await cell(3).click(); assert.deepEqual(await selection(), before);
    await row(4).locator('.fund-drag-handle').click();
    await page.locator('#basket-drop-target').waitFor();
    assert.deepEqual(await selection(), before);
    await page.keyboard.press('Escape');
    await choose(10, ['Meta']);
    const selectedCount = (await selection()).length;
    await page.locator('#fund-basket-button').click();
    await page.locator('[data-basket-action="collect"]').click();
    assert.equal(await page.locator('#fund-basket-list [data-basket-row]').count(), selectedCount);
    await page.locator('[data-basket-action="close"]').click();
    // Drag an already selected row: the entire selection must remain intact.
    await row(10).locator('.fund-drag-handle').scrollIntoViewIfNeeded();
    const box = await row(10).locator('.fund-drag-handle').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + 50, box.y + 30, { steps: 5 });
    await page.locator('#basket-drop-target').waitFor();
    assert.ok((await page.locator('#basket-drag-ghost').textContent()).includes(String(selectedCount)));
    await page.keyboard.press('Escape'); await page.mouse.up();
    assert.equal((await selection()).length, selectedCount);
    if (!touch) {
      await page.locator('#cached-funds-next').click(); await row(101).waitFor();
      assert.equal(await page.locator('#cached-funds-compare-btn').textContent(), `去比较 (${selectedCount})`);
      await choose(104, ['Meta', 'Shift']); assert.deepEqual(await selection(), [104]);
      await page.locator('#cached-funds-prev').click(); await row(1).waitFor();
      assert.equal((await selection()).length, selectedCount);
      await page.locator('#cached-funds-sort').selectOption('code-desc'); await row(120).waitFor();
      await choose(117, ['Shift']); assert.deepEqual(await selection(), [117]);
      await choose(114, ['Shift']); assert.deepEqual(await selection(), [117, 116, 115, 114]);
      await page.locator('#cached-funds-search').fill('00011'); await row(119).waitFor();
      await choose(116, ['Shift']); assert.deepEqual(await selection(), [116]);
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${touch ? 'touch' : 'desktop'} selection, basket, drag${touch ? '' : ', page/sort/search anchor reset'}`);
    await context.close();
  }
} finally { await browser.close(); }
