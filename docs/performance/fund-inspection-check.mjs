/** Isolated browser regression. No public DB reads/writes or upstream requests.
 * PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROME_PATH=/path/to/chrome \
 *   node docs/performance/fund-inspection-check.mjs
 * Use BROWSER_ENGINE=webkit with an installed Playwright WebKit to exercise label projection.
 */
import assert from 'node:assert/strict';
import { createStaticServer } from '../../scripts/serve-static.js';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER_ENGINE || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine));
const server = createStaticServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = engine === 'webkit' ? await webkit.launch() :
  await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const funds = Array.from({ length: 10 }, (_, i) => ({ code: String(i + 1).padStart(6, '0'), name: `测试基金${i + 1}` }));
const raw = code => ({ ...funds.find(fund => fund.code === code), fundType: code === '000003' ? 'FOF' : '混合型',
  fundManager: '测试公司', annualFee: .012, buyFee: 0, operationFees: { managementFee: .01, custodyFee: .002, salesServiceFee: 0 },
  redeemSegments: [{ to: 7, rate: .015 }, { to: null, rate: 0 }], stageReturns: [], updatedAt: '2026-10-30', trackingIndexes: [] });

function lensAligned(selector) {
  const target = document.querySelector(selector);
  const frame = target?.parentElement.querySelector(':scope > .glass-hover-frame');
  if (!target?.offsetWidth || !frame?.offsetWidth) return false;
  const a = target.getBoundingClientRect(), b = frame.getBoundingClientRect();
  return ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < 1);
}

// Measure rendered pixels rather than CSS transforms. A filter can be present and still
// sample an empty layer, or leave the original label visible underneath the enlarged one.
async function screenshotPixels(page, clip) {
  const png = await page.screenshot({ clip });
  return page.evaluateHandle(async data => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, image.width, image.height);
  }, png.toString('base64'));
}

async function sampleLabelInk(page, clip) {
  const ink = await screenshotPixels(page, clip);
  const sample = await ink.evaluate(image => {
    const pixels = image.data;
    let left = image.width, right = -1, sharpness = 0, colored = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = pixels.subarray(i, i + 3);
      if (Math.max(r, g, b) - Math.min(r, g, b) > 15) colored++;
      const x = i / 4 % image.width;
      if (x > image.width * .3 && x < image.width * .7) {
        sharpness = Math.max(sharpness, Math.abs(g - pixels[i - 3]));
      }
      if (g <= 145) continue;
      left = Math.min(x, left);
      right = Math.max(x, right);
    }
    return { width: right - left + 1, sharpness, colored };
  });
  await ink.dispose();
  return sample;
}

async function waitForSettledLens(lens) {
  const settled = await lens.evaluate(async el => {
    const edge = el.querySelector('.glass-contour-outline');
    let previous, stable = 0;
    for (let i = 0; i < 150 && stable < 4; i++) {
      await new Promise(requestAnimationFrame);
      const key = edge.getAttribute('d') + el.style.transform;
      stable = key === previous ? stable + 1 : 0;
      previous = key;
    }
    return stable === 4;
  });
  assert.ok(settled, 'lens settles before the pixel comparison');
}

async function checkSurfaceLight(page, selector) {
  const panel = page.locator(selector);
  await page.evaluate(() => document.fonts.ready);
  await panel.scrollIntoViewIfNeeded();
  const box = await panel.boundingBox();
  const x = Math.round(box.x + box.width * .2), y = Math.floor(box.y);
  const edge = { x, y, width: 12, height: 2 };
  const inside = { x, y: y + 5, width: 12, height: 2 };
  const track = async fraction => {
    await page.mouse.move(box.x + box.width * fraction, y + 2);
    await page.waitForFunction(({ selector, fraction }) => {
      const el = document.querySelector(selector);
      return el.classList.contains('surface-lit') &&
        Math.abs(parseFloat(el.style.getPropertyValue('--surface-light-at')) / 100 - fraction) < .01;
    }, { selector, fraction });
  };
  await track(.2);
  const lit = await page.screenshot({ clip: edge }), face = await page.screenshot({ clip: inside });
  // Hold the pointer and the underlying hover state still. Disable only the
  // new border background to test whether any light enters the face.
  const off = await page.addStyleTag({ content: '.surface-lit { --surface-glint: none !important; }' });
  try {
    assert.ok(face.equals(await page.screenshot({ clip: inside })), selector + ' interior remains clear');
  } finally { await off.evaluate(el => el.remove()); }
  await track(.8);
  assert.ok(!lit.equals(await page.screenshot({ clip: edge })), selector + ' border reflects the moving pointer');
}

async function checkChoiceOptics(page, lens, { stripes = false } = {}) {
  // Keep the real glyphs and their layout, isolating them from theme colors and painted highlights.
  const fixture = await page.addStyleTag({ content: `.top-rail-tabs, .nav-fs-dock { background: #151515 !important; }
    .top-rail-tab, .nav-fs-tab, .glass-projection-scene > span { color: white !important; text-decoration-color: white !important; transition: none !important; }
    .glass-contour > use, .glass-contour .rim-reflection { visibility: hidden; }` });
  try {
    await waitForSettledLens(lens);
    const r = await lens.boundingBox();
    const clip = { x: Math.ceil(r.x + 4), y: Math.ceil(r.y + r.height * .27),
      width: Math.floor(r.width - 8), height: Math.floor(r.height * .46) };
    const sample = () => sampleLabelInk(page, clip);
    const glass = await sample();
    const hide = await page.addStyleTag({ content: '.glass-hover-frame { visibility: hidden !important; } .glass-label-cutout { clip-path: none !important; }' });
    const bare = await sample();
    await hide.evaluate(el => el.remove());
    assert.ok(bare.width > 10 && glass.width >= bare.width * 1.05,
      `lens enlarges the real label (glass ${glass.width}px, original ${bare.width}px)`);
    assert.ok(bare.sharpness > 50 && glass.sharpness >= bare.sharpness * .72,
      `enlarged glyph edges retain sharp local contrast (glass ${glass.sharpness}, original ${bare.sharpness})`);
    if (stripes && engine === 'chromium') {
      // A short tab bends the striped backdrop without separating RGB channels.
      const plate = await page.addStyleTag({ content: `.top-rail-tabs { background:
        repeating-linear-gradient(90deg,#151515 0px 3px,#eee 3px 6px) !important; }` });
      try {
        const lit = await lens.boundingBox();
        const middle = { x: Math.round(lit.x + lit.width / 2 - 10), y: Math.round(lit.y + lit.height / 2 - 4),
          width: 20, height: 8 };
        const shoulder = { x: Math.round(lit.x + 1), y: Math.round(lit.y + 1),
          width: Math.floor(lit.height * .5), height: Math.floor(lit.height - 2) };
        const core = await sampleLabelInk(page, middle);
        const rim = await sampleLabelInk(page, shoulder);
        assert.equal(core.colored, 0, 'the optical center stays free of color fringes');
        assert.equal(rim.colored, 0, 'the short lip keeps alternating neutral stripes achromatic');
      } finally { await plate.evaluate(el => el.remove()); }
    }
  } finally { await fixture.evaluate(el => el.remove()); }
}

// Compare a held, deformed lens with the same exposed lettering. The independent
// mask follows the actual spring spline, including its nonuniform transform.
async function checkLensBoundary(page, lens) {
  const fixture = await page.addStyleTag({ content: `.top-rail-tabs, .nav-fs-dock { background: #181818 !important; }
    .top-rail-tab, .nav-fs-tab, .glass-projection-scene > span { color: white !important; text-decoration-color: white !important; transition: none !important; }
    .glass-contour > use, .glass-contour .rim-reflection { visibility: hidden; }` });
  try {
    await waitForSettledLens(lens);
    const rim = await lens.evaluate(el => {
      const edge = el.querySelector('.glass-contour-outline');
      const m = el.querySelector('.glass-contour').getScreenCTM();
      const r = el.getBoundingClientRect();
      return { d: edge.getAttribute('d'), matrix: [m.a, m.b, m.c, m.d, m.e, m.f],
        clip: { x: Math.floor(r.x - 4), y: Math.floor(r.y - 4), width: Math.ceil(r.width + 9), height: Math.ceil(r.height + 9) } };
    });
    const glass = await screenshotPixels(page, rim.clip);
    const hide = await page.addStyleTag({ content: '.glass-hover-frame { visibility: hidden !important; } .glass-label-cutout { clip-path: none !important; }' });
    const bare = await screenshotPixels(page, rim.clip);
    await hide.evaluate(el => el.remove());
    const { changedInside, coloredInside, coloredOutside } = await page.evaluate(({ rim, glass, bare }) => {
      const canvas = document.createElement('canvas');
      canvas.width = glass.width;
      canvas.height = glass.height;
      const ctx = canvas.getContext('2d'), scale = glass.width / rim.clip.width;
      const [a, b, c, d, e, f] = rim.matrix;
      ctx.setTransform(scale * a, scale * b, scale * c, scale * d, scale * (e - rim.clip.x), scale * (f - rim.clip.y));
      const outline = new Path2D(rim.d);
      ctx.fill(outline);
      // Include half a device pixel for antialiasing at the physical surface.
      ctx.lineWidth = 1 / scale;
      ctx.stroke(outline);
      const mask = ctx.getImageData(0, 0, glass.width, glass.height).data;
      let changedInside = 0, coloredInside = 0, coloredOutside = 0;
      for (let i = 0; i < mask.length; i += 4) {
        const dr = glass.data[i] - bare.data[i];
        const dg = glass.data[i + 1] - bare.data[i + 1];
        const db = glass.data[i + 2] - bare.data[i + 2];
        if (mask[i + 3] === 255 && Math.abs(dg) > 16) changedInside++;
        if (Math.max(dr, dg, db) - Math.min(dr, dg, db) <= 16) continue;
        if (mask[i + 3] === 255) coloredInside++;
        if (mask[i + 3] === 0) coloredOutside++;
      }
      return { changedInside, coloredInside, coloredOutside };
    }, { rim, glass, bare });
    await Promise.all([glass.dispose(), bare.dispose()]);
    assert.ok(changedInside > 0, 'the held lens still refracts the crossing label');
    assert.equal(coloredInside, 0, 'a held short lens also keeps its lettering achromatic');
    assert.equal(coloredOutside, 0, 'color stays inside the moving physical outline');
  } finally { await fixture.evaluate(el => el.remove()); }
}

// Measure the bow between the shoulders in the outline's own coordinates. Moving or scaling
// a rectangular capsule as a single piece leaves these edges straight.
async function sampleRimBending(frame) {
  const path = frame.querySelector('.glass-contour-outline');
  const glint = frame.querySelector('.rim-shine-line');
  const glintWidth = () => Number(glint.getAttribute('stroke-width'));
  const curves = new Set();
  let bow = 0, minGlint = Infinity, maxGlint = 0;
  for (let sample = 0; sample < 24; sample++) {
    await new Promise(requestAnimationFrame);
    minGlint = Math.min(minGlint, glintWidth());
    maxGlint = Math.max(maxGlint, glintWidth());
    const curve = path.getAttribute('d');
    if (curves.has(curve)) continue;
    curves.add(curve);
    const bounds = path.getBBox(), length = path.getTotalLength();
    const upper = [], lower = [];
    for (let i = 0; i < 120; i++) {
      const p = path.getPointAtLength(length * i / 120);
      const x = (p.x - bounds.x) / bounds.width, y = (p.y - bounds.y) / bounds.height;
      if (x >= .3 && x <= .7) (y < .5 ? upper : lower).push({ x, y });
    }
    for (const side of [upper, lower]) {
      if (side.length < 3) continue;
      side.sort((a, b) => a.x - b.x);
      const a = side[0], b = side.at(-1);
      for (const p of side) {
        const t = (p.x - a.x) / (b.x - a.x);
        bow = Math.max(bow, Math.abs(p.y - (a.y + t * (b.y - a.y))));
      }
    }
  }
  return { curves: curves.size, bow, glintChange: maxGlint - minGlint };
}

async function checkRailScrub(page) {
  const listTab = '.top-rail-tab[data-route="list"]';
  const compareTab = '.top-rail-tab[data-route="compare"]';
  const list = await page.locator(listTab).boundingBox();
  const compare = await page.locator(compareTab).boundingBox();
  const y = list.y + list.height / 2;
  const listCenter = list.x + list.width / 2;
  const compareCenter = compare.x + compare.width / 2;
  const initialUrl = page.url();
  const waitForCenter = (min, max) => page.waitForFunction(([min, max]) => {
    const bounds = document.querySelector('.top-rail-lens').getBoundingClientRect();
    const center = bounds.left + bounds.width / 2;
    return center > min && center < max;
  }, [min, max], { timeout: 4000 });

  await page.mouse.move(listCenter, y);
  await page.waitForFunction(lensAligned, listTab);
  const deformation = page.locator('.top-rail-lens').evaluate(sampleRimBending);
  await page.mouse.move(list.x + list.width * .15, list.y + list.height * .3);
  await waitForCenter(list.x, listCenter - 2);
  await page.mouse.move(list.x + list.width * .85, list.y + list.height * .7);
  await waitForCenter(listCenter + 2, list.x + list.width);
  assert.deepEqual(await page.locator(listTab).boundingBox(), list, 'pointer attraction leaves the label stationary');
  const { curves, bow, glintChange } = await deformation;
  assert.ok(curves > 2 && bow > .003, 'the moving rim curves locally across the button');
  assert.ok(glintChange > .12, 'the specular highlight responds to the sweep');

  // Hold over the real gap long enough for the spring to settle.
  const seam = (list.x + list.width + compare.x) / 2;
  await page.mouse.move(seam, y);
  await page.waitForFunction(([left, right]) => new Promise(resolve => {
    let frames = 0, lastX = null;
    function sample() {
      const b = document.querySelector('.top-rail-lens').getBoundingClientRect();
      const x = b.x + b.width / 2;
      if (x <= left || x >= right || (lastX !== null && Math.abs(x - lastX) > .3)) return resolve(false);
      lastX = x;
      if (++frames === 8) resolve(true);
      else requestAnimationFrame(sample);
    }
    sample();
  }), [listCenter + 2, compareCenter - 2], { timeout: 4000 });
  assert.equal(page.url(), initialUrl);

  await page.mouse.move(compareCenter, y);
  await page.mouse.down();
  await page.mouse.move(seam, y + 3, { steps: 5 });
  await checkLensBoundary(page, page.locator('.top-rail-lens'));
  await page.mouse.move(listCenter, y, { steps: 6 });
  assert.equal(page.url(), initialUrl, 'scrubbing previews without navigating');
  await page.mouse.move(listCenter, y + 100, { steps: 3 });
  await page.mouse.up();
  await page.waitForFunction(lensAligned, compareTab);
  assert.equal(page.url(), initialUrl, 'release outside cancels');

  await page.mouse.move(compareCenter, y);
  await page.mouse.down();
  await page.mouse.move(listCenter, y, { steps: 6 });
  await page.mouse.up();
  await page.waitForURL('**/#/list');
  await page.goBack();
  assert.equal(page.url(), initialUrl, 'release navigates once to the destination');
}

async function checkTouchScrub(page) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const sendTouch = (type, points) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    async function slide(x, endX, y) {
      await sendTouch('touchStart', [{ x, y }]);
      for (let i = 1; i <= 8; i++) {
        await sendTouch('touchMove', [{ x: x + (endX - x) * i / 8, y }]);
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
    }
    const group = page.locator('#nav-value-mode');
    await group.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const start = await group.locator('[aria-pressed="true"]').boundingBox();
    const other = group.locator('[aria-pressed="false"]');
    const next = await other.getAttribute('data-value');
    const end = await other.boundingBox();
    await slide(start.x + start.width / 2, end.x + end.width / 2, start.y + start.height / 2);
    assert.equal(await other.getAttribute('data-value'), next, 'touch preview does not select');
    await sendTouch('touchEnd', []);
    await group.locator(`[data-value="${next}"][aria-pressed="true"]`).waitFor({ timeout: 4000 });

    const rail = page.locator('.top-rail-tabs');
    await rail.evaluate(el => { el.scrollLeft = 0; });
    const b = await rail.boundingBox();
    await slide(b.x + b.width - 25, b.x + 40, b.y + b.height / 2);
    await sendTouch('touchEnd', []);
    await page.waitForFunction(() => document.querySelector('.top-rail-tabs').scrollLeft > 60);
    assert.equal(await rail.locator('[aria-selected="true"]').getAttribute('data-route'), 'nav');
  } finally {
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await session.detach();
  }
}

let fail = true;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
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
    if (url.pathname.endsWith('/nav/compare')) {
      const dates = [7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 21, 22, 23].map(day => `202609${String(day).padStart(2, '0')}`);
      const navs = dates.map((_, i) => 1 + .02 * i);
      return json({ series: [{ ...funds[0], dates, navs, adjNavs: navs }], stats: [], range: {} });
    }
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
  const decoration = element => getComputedStyle(element).textDecorationLine;
  assert.equal(await preview.evaluate(decoration), 'none');
  await preview.hover();
  assert.equal(await preview.evaluate(decoration), 'underline');
  await page.waitForFunction(lensAligned, '.top-rail-tab[data-route="list"]');
  await checkChoiceOptics(page, navLens, { stripes: true });
  assert.equal(await page.locator('.top-rail-tab[data-route="compare"]').getAttribute('aria-selected'), 'true');
  await checkRailScrub(page);
  await page.locator('#fc-status').filter({ hasText: '已载入 2' }).waitFor();
  await checkSurfaceLight(page, '.fc-toolbar');
  await checkSurfaceLight(page, '.fc-table-wrap');

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
    assert.match(await frame.evaluate(el => getComputedStyle(el, '::before').clipPath), /url\(.*#.+\)/);
    assert.equal(await frame.locator('svg.glass-contour').getAttribute('fill'), 'none');
    assert.equal(await frame.evaluate(el => getComputedStyle(el).backdropFilter), 'none', 'the host has no whole-surface blur');
    assert.equal(await frame.evaluate(el => getComputedStyle(el).pointerEvents), 'none');
  }
  const stroke = navLens.locator('.glass-contour > use');
  assert.equal(await stroke.count(), 1, 'the optical surface has a single painted edge');
  assert.equal(await stroke.getAttribute('href'), '#' + await navLens.locator('.glass-contour-outline').getAttribute('id'));
  const rowBand = rowFrame.locator('clipPath path[clip-rule="evenodd"]');
  assert.equal((await rowBand.getAttribute('d')).match(/M/gi)?.length, 2, 'a row refracts only its hollow band');
  const rowInset = await rowFrame.evaluate(el =>
    el.querySelector('.rim-reflection').getBBox().y - el.querySelector('.glass-contour-outline').getBBox().y);
  assert.ok(rowInset > .5, 'the row reflection sits inside its physical outline');
  assert.equal(await rowFrame.locator('.glass-contour > use').count(), 1);
  assert.ok(await rowFrame.locator('.rim-reflection').evaluate(el => Number(el.getAttribute('opacity')) > 0));
  assert.equal(await rowFrame.evaluate(el => el.classList.contains('has-optical-lens')), false);
  const rate = metric('显性年化费率').first();
  const rateText = await rate.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
  });
  const framedFee = await page.screenshot({ clip: rateText });
  const hideRow = await page.addStyleTag({ content: '.glass-table-frame { visibility: hidden !important; }' });
  assert.ok(framedFee.equals(await page.screenshot({ clip: rateText })), 'table hover preserves the fee pixels');
  await hideRow.evaluate(el => el.remove());
  const optics = await navLens.evaluate(el => getComputedStyle(el, '::before').backdropFilter);
  if (engine === 'chromium') {
    assert.match(optics, /url\(.*#.+\)/, 'the optical aperture samples the live backdrop');
  } else {
    const projection = navLens.locator('.glass-choice-projection');
    assert.equal(await projection.getAttribute('aria-hidden'), 'true');
    assert.equal(await projection.evaluate(el => el.inert), true);
    assert.match(await projection.locator('.glass-projection-optics').evaluate(el => getComputedStyle(el).filter), /url\(.*#.+\)/);
    assert.equal(await page.getByRole('tab', { name: '基金列表', exact: true }).count(), 1);
  }
  assert.doesNotMatch(optics, /blur\(/);
  assert.deepEqual(await metric('显性年化费率').allTextContents(), ['1.20%', '1.20%']);
  assert.deepEqual(await metric('换手率').allTextContents(), ['0.00%', '100.00%']);
  await page.locator('#fc-period').selectOption('2024-12-31');
  assert.deepEqual(await metric('换手率').allTextContents(), ['20.00%', '—']);
  const coin = page.locator('.top-rail-brand button#theme-toggle');
  const compareUrl = page.url();
  assert.equal(await page.locator('.top-rail-name').getAttribute('href'), '#/calc');
  assert.equal(await page.locator('.top-rail-right button').count(), 1);
  await coin.click();
  for (const width of [1440, 692, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    if (width <= 1024) {
      const title = await page.locator('.top-rail-name').boundingBox();
      const rail = await page.locator('.top-rail').boundingBox();
      const actions = await page.locator('.top-rail-right').boundingBox();
      assert.ok(Math.abs(title.x + title.width / 2 - (rail.x + rail.width / 2)) <= 1 && title.x + title.width <= actions.x,
        `FundCal is centered with room for the basket at ${width}px`);
    }
    for (const theme of ['light', 'dark']) {
      await coin.press('Space');
      assert.equal(await page.evaluate(() => localStorage.getItem('fundcal-theme')), theme);
      assert.equal(await coin.locator(`.logo-${theme}`).isVisible(), true);
      assert.equal(await coin.getAttribute('aria-label'), theme === 'dark' ? '切换到浅色主题' : '切换到深色主题');
      assert.equal(page.url(), compareUrl);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow ${width}/${theme}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#fc-table .fund-drag-handle').first().focus();
  await page.keyboard.press('Enter');
  await page.locator('#fund-basket-button.is-drop-ready').waitFor();
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
  assert.equal(await coin.locator('.logo-dark').isVisible(), true, 'the coin restores the saved theme');
  await page.locator('#fc-search').fill('000002'); await page.locator('#fc-add-code').click();
  await page.locator('#fc-status').filter({ hasText: '已载入 1' }).waitFor();
  // Related share links and FOF disclosure links keep code identity and report date.
  await page.evaluate(() => { location.hash = '#/fund/000003'; });
  await page.locator('[data-fof-holdings]').filter({ hasText: '2026-09-30' }).waitFor();
  assert.equal(await page.locator('[data-fof-holdings] a[href="#/fund/000001"]').count(), 1);
  assert.equal(await page.locator('[data-fof-holdings] a[href="https://fund.eastmoney.com/510310.html"]').count(), 1);
  const sourceLink = page.locator('[data-fof-holdings] a[href="https://fund.eastmoney.com/510310.html"]');
  await sourceLink.hover();
  assert.equal(await sourceLink.evaluate(decoration), 'underline');
  await page.mouse.move(1, 1);
  assert.equal(await sourceLink.evaluate(decoration), 'none');
  await page.locator('a[href="#/compare/000003,000002"]').click();
  await page.locator('#fc-status').filter({ hasText: '已载入 2' }).waitFor();
  // A pending lazy import must neither delay nor reinitialize the newly selected page.
  const indexModule = '**/js/pages/index-picker/index.js';
  const gate = Promise.withResolvers();
  await page.route(indexModule, async route => {
    await gate.promise;
    await route.fulfill({ contentType: 'application/javascript', body: 'export function pageInit() { window.routeEvents.push("init:index"); }' });
  }, { times: 1 });
  const indexRequested = page.waitForRequest(indexModule);
  await page.evaluate(() => {
    window.routeEvents = [];
    window.addEventListener('fundcal-route-ready', event => window.routeEvents.push(event.detail.route));
    location.hash = '#/index';
  });
  try {
    await indexRequested;
    await page.evaluate(() => { location.hash = '#/list'; });
    await page.waitForFunction(() => window.routeEvents.includes('list'));
  } finally { gate.resolve(); }
  await page.evaluate(async () => { await import('/js/pages/index-picker/index.js'); await new Promise(requestAnimationFrame); });
  assert.deepEqual(await page.evaluate(() => window.routeEvents), ['list']);
  assert.equal(await page.locator('.page.active').getAttribute('data-route'), 'list');

  // The list opens the dedicated comparison page.
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
  const navValue = '#nav-value-mode [data-value="nav"]';
  await page.locator(navValue).hover();
  await page.waitForFunction(lensAligned, navValue);
  assert.equal(await page.locator(navValue).getAttribute('aria-pressed'), 'false');
  await page.locator(navValue).click();
  assert.equal(await page.locator(navValue).getAttribute('aria-pressed'), 'true');
  const logScale = '#nav-axis-scale [data-value="log"]';
  await page.locator(logScale).press('Space');
  await page.waitForFunction(lensAligned, logScale);
  assert.equal(await page.locator(logScale).getAttribute('aria-pressed'), 'true');

  await page.locator('#nav-chart-toolbar-fullscreen').click();
  await page.locator('.top-rail').waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 692, height: 753 });
  await page.locator('#nav-chart-canvas').press('Shift+F10');
  for (const edge of ['start', 'end']) {
    const handle = page.locator(`.nav-range-edge-${edge}`);
    await handle.waitFor();
    const box = await handle.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height * .77;
    const original = Number(await handle.getAttribute('aria-valuenow'));
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForFunction(edge => document.querySelector(`.nav-range-edge-${edge}`).classList.contains('is-dragging'), edge);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await page.locator('#nav-range-select-overlay .control-edge-lens').count(), 0, 'flat boundary handle while pressed');
    await page.mouse.move(x + 96, y, { steps: 4 });
    await page.mouse.up();
    const dragged = Number(await handle.getAttribute('aria-valuenow'));
    assert.ok(dragged > original, 'drag moves the boundary');
    await handle.press('ArrowLeft');
    assert.equal(Number(await handle.getAttribute('aria-valuenow')), dragged - 1, 'keyboard still adjusts the boundary');
  }
  await page.locator('.nav-range-ctrl-btn[data-action="close"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  const dock = page.locator('.nav-fs-dock');
  const panelButton = id => dock.locator(`[data-panel="${id}"]`);
  const dockLens = dock.locator('.glass-hover-frame');
  assert.equal(await dockLens.count(), 1);
  assert.equal(await dock.evaluate(el => getComputedStyle(el).backdropFilter), 'none');
  assert.equal(await dock.locator('[aria-pressed]').count(), 0, 'disclosures keep aria-expanded semantics');
  assert.ok((await dock.boundingBox()).y > 700, 'mobile controls are at the bottom');
  await panelButton('tools').hover();
  await page.waitForFunction(lensAligned, '.nav-fs-tab[data-panel="tools"]');
  await checkChoiceOptics(page, dockLens);
  await panelButton('period').click();
  await page.mouse.move(1, 1);
  await page.waitForFunction(lensAligned, '.nav-fs-tab[data-panel="period"]');
  const fundsTab = await panelButton('funds').boundingBox(), toolsTab = await panelButton('tools').boundingBox();
  await page.mouse.move(fundsTab.x + fundsTab.width / 2, fundsTab.y + fundsTab.height / 2);
  await page.mouse.down();
  const statsTab = await panelButton('stats').boundingBox();
  await page.mouse.move((statsTab.x + statsTab.width + toolsTab.x) / 2, toolsTab.y + toolsTab.height / 2 + 3, { steps: 6 });
  await checkLensBoundary(page, dockLens);
  await page.mouse.move(toolsTab.x + toolsTab.width / 2, toolsTab.y + toolsTab.height / 2, { steps: 8 });
  assert.equal(await panelButton('period').getAttribute('aria-expanded'), 'true', 'scrub previews without switching panels');
  await page.mouse.up();
  await page.locator('.nav-fs-pane[data-pane="tools"]').waitFor();
  await dock.locator('.nav-fs-fold').click();
  await page.locator('.nav-fs-unfold').click();
  assert.equal(await dock.locator('[aria-expanded="true"]').count(), 0, 'unfolding leaves all panels closed');
  await panelButton('stats').press('Enter');
  await page.locator('.nav-fs-pane[data-pane="stats"]').waitFor();
  await page.waitForFunction(lensAligned, '.nav-fs-tab[data-panel="stats"]');
  await page.locator('.nav-fs-exit').click();
  await page.waitForFunction(lensAligned, '.top-rail-tab[data-route="nav"]');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const maxPeriod = '.nav-period-btn[data-period="MAX"]';
  await page.locator(maxPeriod).hover({ position: { x: 6, y: 17 } });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.ok(await page.evaluate(lensAligned, maxPeriod), 'reduced-motion rim aligns by the next frame');
  const periodOutline = page.locator('.nav-period-group .glass-contour-outline');
  const still = await periodOutline.getAttribute('d');
  await page.locator(maxPeriod).hover({ position: { x: 24, y: 8 } });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await periodOutline.getAttribute('d'), still, 'reduced motion keeps the outline still during pointer travel');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  if (engine === 'chromium') {
    await page.emulateMedia({ forcedColors: 'active' });
    assert.equal(await navLens.evaluate(el => getComputedStyle(el, '::before').display), 'none');
    assert.equal(await page.getByRole('tab', { name: '净值比较', exact: true }).getAttribute('aria-selected'), 'true');
    await page.emulateMedia({ forcedColors: 'none' });
    await checkTouchScrub(page);
  }
  assert.deepEqual(errors, []);
  console.log('Fund inspection browser checks passed: comparison, snapshots, failures, route races, basket, links, responsive themes, NAV lenses and fullscreen.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
