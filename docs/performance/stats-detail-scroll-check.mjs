/** Isolated browser regression for the statistics drawer and desktop side panel.
 * Set PLAYWRIGHT_MODULE and CHROME_PATH as in glass-radius-check.mjs.
 * BROWSER_ENGINE=webkit runs the same wheel and selection checks in WebKit.
 */
import assert from 'node:assert/strict';
import { createStaticServer } from '../../scripts/serve-static.js';

const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const useWebKit = process.env.BROWSER_ENGINE === 'webkit';
const browser = useWebKit ? await webkit.launch() : await chromium.launch({ executablePath: process.env.CHROME_PATH });
const server = createStaticServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const funds = Array.from({ length: 377 }, (_, i) => ({ code: String(100000 + i), name: '测试基金' + i, fundManager: '测试公司' }));
const benchmark = Array.from({ length: 120 }, (_, i) => ({
  label: '基准' + i, count: i ? 1 : funds.length, codes: i ? [funds[0].code] : funds.map(f => f.code),
}));

try {
  for (const width of [692, 1440]) {
    const compact = width <= 900;
    const page = await browser.newPage({ viewport: { width, height: 753 }, hasTouch: compact, reducedMotion: 'reduce' });
    await page.addInitScript(url => { window.FUND_FEE_API_BASE = url + '/api/fund'; }, base);
    await page.route('https://**', route => route.abort());
    await page.route('**/api/fund/stats', route => route.fulfill({ json: { total: funds.length, benchmark } }));
    await page.route('**/api/fund/stats/detail?**', route => route.fulfill({ json: funds }));
    await page.goto(base + '/#/stats');
    await page.getByRole('tab', { name: '按业绩基准统计' }).click();
    const card = page.locator('.fund-stats-card').first();
    await card.evaluate(async el => {
      await document.fonts.ready;
      el.scrollIntoView({ block: 'start', behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const pageTop = () => page.evaluate(() => scrollY);
    const beforeOpen = await pageTop();
    await card.click();
    const list = page.locator('.fund-stats-detail-list');
    const rows = list.locator('.fund-stats-detail-row');
    await rows.first().waitFor();
    assert.equal(await rows.count(), funds.length);
    const before = await pageTop();
    assert.ok(Math.abs(before - beforeOpen) <= 2, 'opening the panel preserves the background position');
    const pos = await list.boundingBox();
    const x = pos.x + pos.width / 2, y = pos.y + 90;
    const listTop = () => list.evaluate(el => el.scrollTop);
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, 220);
    await page.waitForFunction(() => document.querySelector('.fund-stats-detail-list').scrollTop > 0);
    assert.equal(await pageTop(), before, 'wheel scrolls only the detail rows');

    if (compact && !useWebKit) {
      const scrolled = await listTop();
      const session = await page.context().newCDPSession(page);
      const touch = (type, touchPoints) => session.send('Input.dispatchTouchEvent', { type, touchPoints });
      await touch('touchStart', [{ x, y: y + 160 }]);
      for (let i = 1; i <= 6; i++) {
        await touch('touchMove', [{ x, y: y + 160 - i * 20 }]);
        await page.waitForTimeout(40);
      }
      await touch('touchEnd', []);
      await page.waitForFunction(top => document.querySelector('.fund-stats-detail-list').scrollTop > top, scrolled);
      assert.equal(await pageTop(), before, 'touch panning keeps the background still');
      assert.equal(await page.locator('.basket-dragging').count(), 0);
      await session.detach();
    }

    await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.mouse.wheel(0, 380);
    // Wheel input is processed asynchronously; allow scroll chaining to take effect.
    await page.waitForTimeout(200);
    assert.equal(await pageTop(), before, 'wheel at the bottom stays in the panel');
    await rows.last().click();
    assert.equal(await rows.last().getAttribute('aria-selected'), 'true');
    const close = page.getByRole('button', { name: '关闭基金列表' });
    if (compact) {
      await close.hover();
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(200);
      assert.equal(await pageTop(), before, 'wheel on the drawer heading stays in the drawer');
    }
    await close.click();
    assert.equal(await pageTop(), before, 'closing restores the same position');
    await page.mouse.move(120, 400);
    await page.mouse.wheel(0, 300);
    await page.waitForFunction(top => scrollY > top, before);
    await card.click();
    await rows.first().locator('.fund-drag-handle').press('Enter');
    await page.locator('#fund-basket-button.is-drop-ready').waitFor();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#fund-basket-button .basket-count').innerText(), '1');
    await page.locator('.top-rail-tab[data-route="calc"]').click();
    await page.locator('.page-calc.active').waitFor();
    await page.waitForFunction(() => getComputedStyle(document.body).overflowY !== 'hidden');
    await page.close();
    console.log('Statistics detail scroll passed at ' + width + 'px');
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
