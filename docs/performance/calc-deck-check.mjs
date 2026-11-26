/** Isolated gallery/light/gesture regression.
 * PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROME_PATH=/path/to/chrome \
 *   node docs/performance/calc-deck-check.mjs
 */
import assert from 'node:assert/strict';
import { createStaticServer } from '../../scripts/serve-static.js';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const useWebKit = process.env.BROWSER_ENGINE === 'webkit';
const browser = useWebKit ? await webkit.launch() : await chromium.launch({ executablePath:process.env.CHROME_PATH, headless:true });
const server = createStaticServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
 const ctx = await browser.newContext({viewport:{width:1440,height:1000}});
 await ctx.route('https://**',route=>route.abort());
 const page = await ctx.newPage(); const errors=[];
 page.on('pageerror', e=>errors.push(e.message));
 await page.route('**/api/fund/*/morningstar',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({periods:[]})}));
 await page.addInitScript(()=>localStorage.setItem('fundCalState',JSON.stringify({calcDaysMax:365,funds:Array.from({length:5},(_,i)=>({name:'测试基金 '+i,code:String(i+1).padStart(6,'0'),annualFee:.005,buyFee:0,sellFeeSegments:[{to:null,rate:0}]}))})));
 await page.goto(`${base}/#/calc`,{waitUntil:'domcontentloaded'});
 await page.waitForSelector('.fund-card.is-deck-active'); await page.waitForTimeout(350);
 const activeCard = page.locator('.fund-card.is-deck-active').first();
 const optics = locator => locator.evaluate(el => {
   const lip = el.querySelector('.deck-card-rim') || el;
   const id = lip.style.getPropertyValue('--glass-refraction').match(/#([^"]+)/)?.[1];
   const rays = document.getElementById(id)?.querySelectorAll('feDisplacementMap').length ?? 0;
   const seam = lip.querySelector('.rim-shine-line');
   return { rays, line: Number(seam?.getAttribute('stroke-width')), filter: getComputedStyle(el).backdropFilter,
     edge: getComputedStyle(lip, '::before').backdropFilter, foreground: getComputedStyle(el).filter };
 });
 const initialOptics = await optics(activeCard);
 assert.equal(initialOptics.filter, 'none');
 if (!useWebKit) assert.match(initialOptics.edge, /^url\(/);
 assert.equal(initialOptics.foreground, 'none');
 const stripes = await page.addStyleTag({ content: '#fund-cards { background:repeating-linear-gradient(90deg,#484875 0 1px,#f5f5d0 1px 3px); }' });
 async function checkClearFace() {
   await activeCard.scrollIntoViewIfNeeded();
   const box = await activeCard.locator('.input-annual-fee').boundingBox();
   const clip = { x: Math.ceil(box.x + 3), y: Math.ceil(box.y + 3), width: Math.floor(box.width - 6), height: Math.floor(box.height - 6) };
   const surface = await page.screenshot({ clip });
   // An identity filter keeps text on the same compositor layer for a pixel-exact comparison.
   const off = await page.addStyleTag({ content: '#fund-cards .deck-card-rim { visibility: hidden !important; } #fund-cards .fund-card::before { backdrop-filter:opacity(1)!important; }' });
   try {
     assert.ok(surface.equals(await page.screenshot({ clip })), 'central content and underlying stripes stay pixel-identical without optics');
   } finally { await off.evaluate(el => el.remove()); }
 }
 await checkClearFace();
 // Moving between editable cards transfers the same rim, including when an input has focus.
 const annualFee = activeCard.locator('.input-annual-fee');
 await annualFee.click();
 await annualFee.fill('0.89');
 await annualFee.press('Tab');
 assert.equal(await annualFee.inputValue(), '0.89');
 const rim = page.locator('#fund-cards .deck-card-rim');
 const firstEdge = activeCard.locator('.deck-card-rim .glass-contour-outline');
 await firstEdge.waitFor({ state: 'attached' });
 const edgeId = await firstEdge.getAttribute('id');
 const hover = await optics(activeCard);
 if (!useWebKit) {
   assert.match(hover.edge, /^url\(/);
   assert.equal(hover.rays, 3, 'the interactive edge separates three optical samples');
 }
 assert.equal(await rim.locator('.glass-contour > use').count(), 1, 'hover draws one visible rim');
 await annualFee.hover();
 await page.mouse.down();
 await page.waitForFunction(width => +document.querySelector('.deck-card-rim .rim-shine-line').getAttribute('stroke-width') > width, hover.line);
 assert.equal(await annualFee.evaluate(el => el === document.activeElement), true, 'pressing the fee field still focuses the native input');
 await page.mouse.up();
 await annualFee.press('Tab');
 const frontBox = await activeCard.boundingBox();
 await page.mouse.move(frontBox.x + 8, frontBox.y + 100);
 await annualFee.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {}))));
 await checkClearFace();
 await stripes.evaluate(el => el.remove());
 const otherCard = page.locator('.fund-card.is-deck-active').nth(1);
 await otherCard.locator('.input-annual-fee').hover();
 const nextEdge = otherCard.locator('.deck-card-rim .glass-contour-outline');
 await nextEdge.waitFor({ state: 'attached' });
 assert.equal(await nextEdge.getAttribute('id'), edgeId);
 assert.equal(await rim.count(), 1);
 await page.mouse.move(-20, -20);
 await rim.waitFor({ state: 'detached', timeout: 3000 });
 await annualFee.hover();
 await firstEdge.waitFor({ state: 'attached' });
 await page.evaluate(() => window.dispatchEvent(new Event('blur')));
 await rim.waitFor({ state: 'detached', timeout: 3000 });
 const light=()=>page.locator('#fund-card-stage').evaluate(el=>({x:el.style.getPropertyValue('--light-x'),y:el.style.getPropertyValue('--light-y')}));
 const stage=await page.locator('#fund-card-stage').boundingBox();
 await page.mouse.move(stage.x+stage.width*.25,stage.y+stage.height*.3); await page.waitForTimeout(80);
 const inside=await light();
 const glide = await page.locator('#fund-card-stage').evaluate(async el => {
   const start = parseFloat(el.style.getPropertyValue('--light-x'));
   const bounds = el.getBoundingClientRect();
   const end = (10 - bounds.left) / bounds.width * 100;
   window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 10, clientY: 75 }));
   for (let i = 0; i < 12; i++) {
     await new Promise(requestAnimationFrame);
     const x = parseFloat(el.style.getPropertyValue('--light-x'));
     if (x < start - .1 && x > end + .1) return true;
   }
   return false;
 });
 assert.ok(glide, 'rim light travels through intermediate positions');
 await page.mouse.move(10,75);
 await page.waitForFunction(() => {
   const el = document.getElementById('fund-card-stage'), bounds = el.getBoundingClientRect();
   return Math.abs(parseFloat(el.style.getPropertyValue('--light-x')) - (10 - bounds.left) / bounds.width * 100) < .00001;
 });
 const outside=await light(); assert.notDeepEqual(inside,outside);
 assert.ok(parseFloat(outside.x)<0,'global x must continue outside stage');
 await page.dispatchEvent('#fund-card-stage','pointerleave',{pointerType:'mouse'}); await page.waitForTimeout(80); assert.equal((await light()).x,outside.x); assert.ok(parseFloat((await light()).y)<0);
 await page.mouse.move(200,80); await page.waitForTimeout(80); assert.notDeepEqual(await light(),outside);
 // Chart interaction should not measure offscreen cards; re-entry uses the last pointer.
 await page.evaluate(() => scrollTo({ top: document.getElementById('fund-card-stage').getBoundingClientRect().bottom + scrollY + 20, behavior: 'instant' }));
 await page.waitForFunction(() => document.getElementById('fund-card-stage').getBoundingClientRect().bottom < 0);
 await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
 const finishMeasurement = await page.locator('.fund-card').first().evaluateHandle(card => {
   let reads = 0;
   const measure = card.getBoundingClientRect;
   card.getBoundingClientRect = () => { reads++; return measure.call(card); };
   return () => {
     delete card.getBoundingClientRect;
     return reads;
   };
 });
 // A scroll can generate a native pointer event. Keep the actual cursor at the
 // last tested position so WebKit's hit testing uses the same coordinates.
 await page.mouse.move(205, 85, { steps: 5 });
 await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
 assert.equal(await finishMeasurement.evaluate(finish => finish()), 0);
 await finishMeasurement.dispose();
 await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
 await page.waitForFunction(() => {
   const el = document.getElementById('fund-card-stage'), bounds = el.getBoundingClientRect();
   return Math.abs(parseFloat(el.style.getPropertyValue('--light-x')) - (205 - bounds.left) / bounds.width * 100) < .00001;
 });
 const clipped=await page.locator('.fund-card.is-deck-active .fund-drag-handle').first().evaluate(el=>({clip:getComputedStyle(el).clipPath,width:el.getBoundingClientRect().width,text:el.textContent}));
 assert.equal(clipped.clip,'inset(50%)'); assert.equal(clipped.width,1); assert.equal(clipped.text,'移动基金');
 await page.locator('.fund-card.is-deck-active .fund-drag-handle').first().focus();
 assert.equal(await page.locator('.fund-card.is-deck-active .fund-drag-handle').first().evaluate(el=>getComputedStyle(el).clipPath),'none');
 await page.keyboard.press('Enter'); assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('basket-dragging')),true); await page.keyboard.press('Escape');
 await page.locator('#fund-cards').focus(); await page.keyboard.press('End'); await page.waitForTimeout(450); await page.keyboard.press('Home'); await page.waitForTimeout(450);
 let card=await page.locator('.fund-card.is-deck-active').first().boundingBox();
 // Grab an in-flight transition. The first drag sample is measured from the visible card.
 await page.mouse.move(card.x+8,card.y+110);
 await page.locator('#fund-cards').evaluate(rail => {
   const readX = () => parseFloat(rail.children[1].style.transform.match(/translate3d\(([^,]+)/)[1]);
   window.addEventListener('pointerdown', () => rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' })), { capture: true, once: true });
   rail.addEventListener('pointermove', () => {
     const start = readX();
     requestAnimationFrame(() => { window.firstDeckDragDistance = Math.abs(readX() - start); });
   }, { once: true });
 });
 await page.mouse.down();
 await page.mouse.move(card.x-12,card.y+110);
 await page.waitForFunction(() => Number.isFinite(window.firstDeckDragDistance));
 assert.ok(await page.evaluate(() => window.firstDeckDragDistance < 100), '20px drag must not jump to the previous destination');
 // Continue the same horizontal drag and then transfer the settled card vertically.
 await page.mouse.move(card.x-50,card.y+110,{steps:5});
 const draggedCard = page.locator('.fund-card.is-deck-drag-surface');
 await draggedCard.waitFor();
 const draggedOptics = await optics(draggedCard);
 assert.equal(draggedOptics.filter, 'none');
 assert.ok(draggedOptics.line > hover.line, 'the pressed material follows the dragged card');
 await page.mouse.move(card.x-210,card.y+110,{steps:10}); await page.mouse.up(); await page.waitForTimeout(400);
 assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('basket-dragging')),false); assert.ok(Number(await page.locator('#fund-cards').getAttribute('data-active-index'))>0);
 card=await page.locator('.fund-card.is-deck-active').first().boundingBox();
 await page.mouse.move(card.x+8,card.y+100); await page.mouse.down(); await page.mouse.move(card.x+8,card.y+70,{steps:3});
 assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('basket-dragging')),true);
 const source = page.locator('.fund-card.is-basket-drag-source');
 assert.equal(await source.count(), 1);
 assert.equal((await optics(source)).filter, 'none');
 const ghost = page.locator('#basket-drag-ghost');
 if (!useWebKit) assert.match(await ghost.evaluate(el => getComputedStyle(el, '::before').backdropFilter), /^url\(/);
 const target=await page.locator('#fund-basket-button').boundingBox();
 await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:10}); await page.mouse.up(); await page.waitForTimeout(100);
 assert.equal(await page.locator('#fund-basket-button .basket-count').textContent(),'1');
 assert.equal(await page.locator('.fund-card.is-basket-drag-source').count(), 0);
 await page.emulateMedia({reducedMotion:'reduce'}); await page.waitForTimeout(100); const fixed=await light(); await page.mouse.move(1000,20); await page.waitForTimeout(80); assert.deepEqual(await light(),fixed); assert.equal(fixed.x,'42%');
 await page.emulateMedia({reducedMotion:'no-preference'}); await page.waitForTimeout(100); assert.notDeepEqual(await light(),fixed);
 assert.deepEqual(errors,[]);
 console.log('PASS: outside pointer tracking/preserved exit, invisible grip + keyboard transfer, horizontal deck drag, vertical basket transfer, reduced motion.');
 await ctx.close();
 const mobile=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
 await mobile.route('https://**',route=>route.abort());
 const mp=await mobile.newPage();
 await mp.route('**/api/fund/*/morningstar',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({periods:[]})}));
 await mp.addInitScript(()=>localStorage.setItem('fundCalState',JSON.stringify({calcDaysMax:365,funds:Array.from({length:5},(_,i)=>({name:'测试基金 '+i,code:String(i+1).padStart(6,'0'),annualFee:.005,buyFee:0,sellFeeSegments:[{to:null,rate:0}]}))})));
 await mp.goto(`${base}/#/calc`,{waitUntil:'domcontentloaded'}); await mp.waitForSelector('.fund-card.is-deck-active'); await mp.waitForTimeout(300);
 await mp.evaluate(()=>scrollTo(0,200)); await mp.waitForTimeout(100);
 if (!useWebKit) {
   const mb=await mp.locator('.fund-card.is-deck-active').first().boundingBox();
   const cdp=await mobile.newCDPSession(mp);
   const swipe=async(x,y,dx,dy)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/12,y:y+dy*i/12}]});await mp.waitForTimeout(12);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await mp.waitForTimeout(300);};
   await swipe(mb.x+mb.width-8,mb.y+100,-180,0);
   assert.ok(Number(await mp.locator('#fund-cards').getAttribute('data-active-index'))>0,'touch horizontal swipe navigates');
   const scrollBefore=await mp.evaluate(()=>scrollY); const mb2=await mp.locator('.fund-card.is-deck-active').first().boundingBox();
   await swipe(mb2.x+8,Math.max(160,mb2.y+180),0,-100); assert.ok(await mp.evaluate(()=>scrollY)>scrollBefore,'touch scrolls');
 }
 assert.equal(await mp.locator('body').evaluate(el=>el.classList.contains('basket-dragging')),false);
 await mp.locator('#fund-basket-button').tap(); await mp.waitForTimeout(300); await mp.locator('[data-basket-action=collect]').tap({timeout:3000});
 assert.equal(await mp.locator('#fund-basket-button .basket-count').textContent(),'5');
 assert.equal(await mp.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 console.log('PASS: mobile collection and width' + (useWebKit ? '.' : ', horizontal gallery swipe and vertical scroll.'));
 await mobile.close();
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
