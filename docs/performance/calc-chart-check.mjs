/**
 * Optional isolated browser regression; does not modify the user's browser or DB.
 * Start npm run dev, then provide an external Playwright installation and Chrome:
 * PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROME_PATH=/path/to/chrome \
 *   node docs/performance/calc-chart-check.mjs
 */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const url = process.env.FUND_CAL_URL || 'http://localhost:3456/#/calc';
const cases = [
  [320,640,1,2], [390,844,1,3], [709,742,1,1], [844,390,1,2],
  [1440,500,1,1], [1440,900,1,2], [999,762,1.25,2],
  [1440,900,1.75,1], [709,742,.8,2], [1920,1080,1,1],
];

async function verifyLayout(page) {
  // Chart.js observes its parent asynchronously; wait for the resize to settle.
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    const chart = Chart.getChart('chart-canvas'), plot = document.querySelector('.chart-wrapper');
    const band = document.getElementById('optimal-band');
    return {
      container: box('.chart-container'), main: box('.chart-main'), plot: box('.chart-wrapper'),
      aside: box('.chart-main-right'), footer: box('.chart-footer'), canvas: box('#chart-canvas'),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      chart: chart && { width: chart.width, height: chart.height, area: chart.chartArea },
      logical: [plot.clientWidth, plot.clientHeight],
      band: band.offsetHeight ? [parseFloat(band.style.marginLeft), parseFloat(band.style.marginRight)] : null,
    };
  });
  assert.ok(r.footer.top >= r.main.bottom - 1, 'footer must not overlap plot/list');
  assert.ok(r.container.bottom >= r.footer.bottom - 1, 'footer must remain inside container');
  assert.ok(r.main.bottom >= Math.max(r.aside.bottom, r.plot.bottom) - 1);
  assert.ok(!r.overflow, 'page must not overflow horizontally');
  assert.ok(Math.abs(r.canvas.width - r.plot.width) < 2 && Math.abs(r.canvas.height - r.plot.height) < 2);
  if (r.chart) {
    assert.ok(Math.abs(r.chart.width - r.logical[0]) < 2 && Math.abs(r.chart.height - r.logical[1]) < 2);
    assert.ok(r.chart.area.width > 100 && r.chart.area.height > 100);
    if (r.band) {
      assert.ok(Math.abs(r.band[0] - r.chart.area.left) < 1);
      assert.ok(Math.abs(r.band[1] - (r.chart.width - r.chart.area.right)) < 1);
    }
  }
}

async function hoverPoint(page, curve = false) {
  return page.evaluate(curve => {
    const chart = Chart.getChart('chart-canvas'), rect = chart.canvas.getBoundingClientRect();
    const sample = chart.data.datasets[0].data.find(p => p.x > 200);
    const x = chart.scales.x.getPixelForValue(curve ? sample.x : 232.2);
    const y = curve ? chart.scales.y.getPixelForValue(sample.y) : chart.chartArea.top + 30;
    return { x: rect.x + x * rect.width / chart.width, y: rect.y + y * rect.height / chart.height };
  }, curve);
}

try {
  for (const [width, height, zoom, deviceScaleFactor] of cases) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor, hasTouch: width < 500 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('fundCalState', JSON.stringify({
      calcDaysMax: 465, showTooltip: true,
      funds: Array.from({ length: 25 }, (_, i) => ({
        name: '测试很长名称的基金混合发起式C' + i,
        annualFee: i === 0 ? .028 : .002 + i * .001,
        buyFee: i === 0 ? 0 : .004 + i * .001,
        sellFeeSegments: [{ to: 7, rate: .015 }, { to: 30, rate: .005 }, { to: null, rate: 0 }],
      })),
    })));
    await page.goto(url);
    await page.waitForFunction(() => window.Chart?.getChart('chart-canvas'));
    await page.evaluate(zoom => {
      document.documentElement.style.zoom = zoom;
      document.documentElement.dataset.theme = zoom === 1 ? 'dark' : 'light';
      dispatchEvent(new Event('fundcal-theme-change'));
    }, zoom);
    await verifyLayout(page);
    await page.locator('.chart-wrapper').evaluate(el => scrollTo(0, scrollY + el.getBoundingClientRect().top - 80));
    let point = await hoverPoint(page);
    if (width < 500) {
      await page.touchscreen.tap(point.x, point.y);
      await page.waitForTimeout(100);
      assert.ok(await page.locator('#chart-crosshair-overlay.visible').count(), 'touch tap persists after lifting finger');
      await page.touchscreen.tap(1, 70);
      assert.equal(await page.locator('#chart-crosshair-overlay.visible').count(), 0);
    }
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#chart-crosshair-label-x').textContent(), '232天');
    const info = page.locator('#chart-crosshair-info');
    assert.ok(await info.evaluate(el => el.scrollHeight > el.clientHeight));
    const rect = await info.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, { steps: 8 });
    await page.mouse.wheel(0, 160);
    await page.waitForTimeout(100);
    assert.ok(await info.evaluate(el => el.scrollTop > 0), 'fixed information window must be reachable and scrollable');
    await page.mouse.move(0, 0);
    await page.waitForTimeout(100);
    point = await hoverPoint(page, true);
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(200);
    assert.ok(await info.evaluate(el => getComputedStyle(el).visibility === 'visible' && getComputedStyle(el).display !== 'none'), 'tooltip must not steal hover and immediately disappear');
    assert.ok(await info.evaluate(el => {
      const r = el.getBoundingClientRect(), p = el.closest('.chart-wrapper').getBoundingClientRect();
      return r.left >= p.left - 1 && r.right <= p.right + 1 && r.top >= p.top - 1 && r.bottom <= p.bottom + 1;
    }));
    await page.locator('label[for="show-tooltip"]').click();
    point = await hoverPoint(page, true);
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(100);
    assert.ok(!await info.evaluate(el => getComputedStyle(el).visibility === 'visible' && getComputedStyle(el).display !== 'none'));
    await page.locator('#chart-fund-list-toggle').click();
    await verifyLayout(page);
    await page.locator('#chart-fund-list-toggle').click();
    await verifyLayout(page);
    await page.locator('#chart-fund-list-hide-all').click();
    assert.ok(!await page.locator('#optimal-band').isVisible());
    assert.ok(await page.locator('#chart-empty').isVisible());
    await verifyLayout(page);
    await page.locator('#chart-fund-list-show-all').click();
    await verifyLayout(page);
    if (width === 1440 && height === 900 && zoom === 1) {
      for (const [w, h] of [[709,742], [320,640], [844,390], [1440,900]]) {
        await page.setViewportSize({ width: w, height: h });
        await verifyLayout(page);
      }
      await page.evaluate(() => { location.hash = '#/stats'; });
      await page.waitForFunction(() => document.querySelector('.page-stats.active'));
      await page.evaluate(() => { location.hash = '#/calc'; });
      await page.waitForFunction(() => document.querySelector('.page-calc.active'));
      await verifyLayout(page);
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}×${height}, zoom ${zoom}, DPR ${deviceScaleFactor}`);
    await context.close();
  }
} finally {
  await browser.close();
}
