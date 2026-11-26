/** Browser regression for the footprint of resting glass lenses and nested surfaces.
 * PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROME_PATH=/path/to/chrome \
 *   node docs/performance/glass-radius-check.mjs
 */
import assert from 'node:assert/strict';
import { createStaticServer } from '../../scripts/serve-static.js';

const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = process.env.BROWSER_ENGINE === 'webkit'
  ? await webkit.launch() : await chromium.launch({ executablePath: process.env.CHROME_PATH });
const server = createStaticServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const fund = { code: '000001', name: '测试基金', annualFee: .014, buyFee: .015 };

async function checkLens(page, targetSelector, lensSelector, clipRow = false) {
  const lens = page.locator(lensSelector);
  await lens.locator('.glass-contour-outline[d]').waitFor({ state: 'attached' });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const geometry = await lens.evaluate((el, { selector, clipRow }) => {
    const target = document.querySelector(selector);
    const box = target.getBoundingClientRect().toJSON();
    if (clipRow) {
      const wrap = target.closest('.cached-funds-table-wrap');
      const viewport = wrap.getBoundingClientRect();
      const left = Math.max(box.x, viewport.left + wrap.clientLeft);
      box.width = Math.min(box.right, viewport.left + wrap.clientLeft + wrap.clientWidth) - left;
      box.x = left;
    }
    const overlay = el.getBoundingClientRect();
    const raw = getComputedStyle(target).borderTopLeftRadius;
    const half = Math.min(box.width, box.height) / 2;
    const radius = Math.min(half, parseFloat(raw) * (raw.endsWith('%') ? half / 50 : 1));
    // Sample the actual SVG used for the outline. Compare it with the CSS
    // rounded rectangle at the seam's inset, including the four curved ends.
    const path = el.querySelector('.glass-contour-outline');
    const inset = path.getPointAtLength(0).y;
    const inside = Math.max(0, radius - inset);
    const length = path.getTotalLength();
    let deviation = 0;
    for (let i = 0; i < 360; i++) {
      const point = path.getPointAtLength(length * i / 360);
      const dx = Math.abs(point.x - box.width / 2) - (box.width / 2 - inset - inside);
      const dy = Math.abs(point.y - box.height / 2) - (box.height / 2 - inset - inside);
      const distance = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - inside;
      deviation = Math.max(deviation, Math.abs(distance));
    }
    return { deviation, boxError: Math.max(...['x', 'y', 'width', 'height'].map(k => Math.abs(overlay[k] - box[k]))) };
  }, { selector: targetSelector, clipRow });
  assert.ok(geometry.boxError <= 1, targetSelector + ' border box misses the lens by ' + geometry.boxError + 'px');
  assert.ok(geometry.deviation <= 1.3, targetSelector + ' resting outline misses the corner by ' + geometry.deviation + 'px');
}

try {
  for (const touch of [false, true]) {
    const viewport = touch ? { width: 390, height: 844 } : { width: 1440, height: 960 };
    const context = await browser.newContext({ viewport, hasTouch: touch, reducedMotion: 'reduce' });
    await context.route('https://**', route => route.abort());
    await context.addInitScript(fund => {
      window.FUND_FEE_API_BASE = location.origin + '/api/fund';
      localStorage.setItem('fundcal-basket-v1', JSON.stringify({ v: 1, items: [fund] }));
      localStorage.setItem('fundCalState', JSON.stringify({ funds: [fund], calcDaysMax: 365 }));
    }, fund);
    await context.route(base + '/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      const data = path.endsWith('/list') ? { page: 1, size: 100, total: 1, rows: [fund] }
        : path.endsWith('/filter-options') ? { fundType: [{ label: '混合型', count: 1 }] }
        : { total: 1, tracking: [{ label: '测试指数', count: 1 }] };
      return route.fulfill({ json: data });
    });
    const page = await context.newPage();
    await page.goto(base + '/#/stats');
    await page.locator('.fund-stats-card').first().waitFor();
    await checkLens(page, '.fund-stats-toggle-btn[aria-selected="true"]', '.fund-stats-toggle .control-choice-lens');
    const selected = '.fund-stats-toggle-btn[data-key="manager"][aria-selected="true"]';
    // A non-capsule target exposes layers that still use a fixed pill radius.
    await page.addStyleTag({ content: '.fund-stats-toggle-btn { border-radius: 8px; }' });
    await page.locator('.fund-stats-toggle-btn[data-key="manager"]').click();
    await page.locator(selected).waitFor();
    await checkLens(page, selected, '.fund-stats-toggle .control-choice-lens');
    await page.goto(base + '/#/list');
    await page.locator('#cached-funds-tbody tr[data-code]').waitFor();
    if (touch) {
      await page.locator('#cf-filter-toggle-btn').click();
      const corners = await page.locator('.cf-sidebar').evaluate(el => {
        const style = getComputedStyle(el);
        const footer = getComputedStyle(el.querySelector('.cf-sidebar-footer'));
        return [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius,
          style.borderBottomRightRadius, footer.borderRadius];
      });
      assert.ok(parseFloat(corners[0]) > 0);
      assert.deepEqual(corners.slice(1), [corners[0], '0px', '0px', '0px']);
    } else {
      const row = page.locator('#cached-funds-tbody tr[data-code] td').nth(2);
      await row.click();
      const selectedRow = '.cached-fund-row[aria-selected="true"]';
      await page.locator(selectedRow).waitFor();
      const rowCorners = await page.locator(selectedRow).evaluate(el => {
        const radius = getComputedStyle(el).borderTopLeftRadius;
        const first = getComputedStyle(el.firstElementChild);
        const last = getComputedStyle(el.lastElementChild);
        return { radius, outer: [first.borderTopLeftRadius, first.borderBottomLeftRadius,
          last.borderTopRightRadius, last.borderBottomRightRadius],
        inner: [first.borderTopRightRadius, last.borderTopLeftRadius, getComputedStyle(el.children[1]).borderRadius] };
      });
      assert.ok(parseFloat(rowCorners.radius) > 0);
      assert.deepEqual(rowCorners.outer, Array(4).fill(rowCorners.radius));
      assert.deepEqual(rowCorners.inner, Array(3).fill('0px'));
      await row.hover();
      await checkLens(page, selectedRow, '.glass-table-frame', true);
      await page.mouse.down();
      const box = await row.boundingBox();
      await page.mouse.move(box.x + 10, box.y + 35, { steps: 5 });
      const target = '#fund-basket-button.is-drop-ready';
      await page.locator(target).waitFor();
      const basket = await page.locator(target).boundingBox();
      await page.mouse.move(basket.x + basket.width / 2, basket.y + basket.height / 2);
      await checkLens(page, target, target + ' .basket-drop-lens');
      await checkLens(page, '#basket-drag-ghost', '#basket-drag-ghost');
      // The old circular target reached this empty strip below the top rail.
      await page.mouse.move(basket.x + basket.width / 2, basket.y + basket.height + 64);
      assert.equal(await page.locator(target + '.is-drop-over').count(), 0);
      await page.mouse.up();
      assert.equal(await page.locator('#basket-live-status').isVisible(), false);
      await page.goto(base + '/#/calc');
      const card = '.fund-card.is-deck-active';
      await page.locator(card).hover();
      await checkLens(page, card, card + ' .deck-card-rim');
      const trigger = page.locator('#fund-basket-button');
      await trigger.hover();
      await page.mouse.down();
      const start = await trigger.boundingBox();
      await page.mouse.move(start.x + 25, start.y + start.height + 20, { steps: 5 });
      const add = '#basket-drop-zones [data-basket-drop="add"]';
      const drop = page.locator(add);
      await drop.waitFor();
      const bounds = await drop.boundingBox();
      assert.ok(bounds.y > viewport.height * .70, 'basket actions share a compact bottom bar');
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await checkLens(page, add, add + ' .basket-drop-lens');
      // Keep the pointer still while a change in label metrics resizes the drop button.
      await drop.locator('strong').evaluate(label => { label.style.lineHeight = '40px'; });
      await checkLens(page, add, add + ' .basket-drop-lens');
      await page.keyboard.press('Escape');
      await page.mouse.up();
    }
    await context.close();
  }
  console.log('Glass corner geometry passed on desktop and mobile.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
