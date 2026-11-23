/** Isolated gallery/light/gesture regression.
 * PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROME_PATH=/path/to/chrome \
 *   node docs/performance/calc-deck-check.mjs
 */
import assert from 'node:assert/strict';
import { createStaticServer } from '../../scripts/serve-static.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath:process.env.CHROME_PATH, headless:true });
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
   const id = el.style.getPropertyValue('--glass-refraction').match(/#([^"]+)/)?.[1];
   const scale = document.getElementById(id)?.querySelector('feDisplacementMap')?.getAttribute('scale');
   return { scale: Number(scale), filter: getComputedStyle(el).backdropFilter, foreground: getComputedStyle(el).filter };
 });
 const initialOptics = await optics(activeCard);
 assert.match(initialOptics.filter, /blur\(0\.5px\).*url\(/);
 assert.equal(initialOptics.foreground, 'none');
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
 const offscreenReads = await page.locator('.fund-card').first().evaluate(async card => {
   let reads = 0;
   const measure = card.getBoundingClientRect;
   card.getBoundingClientRect = () => { reads++; return measure.call(card); };
   try {
     for (let i = 0; i < 5; i++) {
       window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 201 + i, clientY: 85 }));
       await new Promise(requestAnimationFrame);
     }
     return reads;
   } finally { delete card.getBoundingClientRect; }
 });
 assert.equal(offscreenReads, 0);
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
 assert.ok((await optics(draggedCard)).scale > initialOptics.scale);
 await page.mouse.move(card.x-210,card.y+110,{steps:10}); await page.mouse.up(); await page.waitForTimeout(400);
 assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('basket-dragging')),false); assert.ok(Number(await page.locator('#fund-cards').getAttribute('data-active-index'))>0);
 card=await page.locator('.fund-card.is-deck-active').first().boundingBox();
 await page.mouse.move(card.x+8,card.y+100); await page.mouse.down(); await page.mouse.move(card.x+8,card.y+70,{steps:3});
 assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('basket-dragging')),true);
 assert.equal(await page.locator('.fund-card.is-basket-drag-source').count(), 1);
 const ghost = page.locator('#basket-drag-ghost');
 assert.match(await ghost.evaluate(el => getComputedStyle(el, '::before').backdropFilter), /blur\(0\.5px\).*url\(/);
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
 const mb=await mp.locator('.fund-card.is-deck-active').first().boundingBox();
 const cdp=await mobile.newCDPSession(mp);
 const swipe=async(x,y,dx,dy)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/12,y:y+dy*i/12}]});await mp.waitForTimeout(12);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await mp.waitForTimeout(300);};
 await swipe(mb.x+mb.width-8,mb.y+100,-180,0);
 assert.ok(Number(await mp.locator('#fund-cards').getAttribute('data-active-index'))>0,'touch horizontal swipe navigates');
 const scrollBefore=await mp.evaluate(()=>scrollY); const mb2=await mp.locator('.fund-card.is-deck-active').first().boundingBox();
 await swipe(mb2.x+8,Math.max(160,mb2.y+180),0,-100); assert.ok(await mp.evaluate(()=>scrollY)>scrollBefore,'touch scrolls');
 assert.equal(await mp.locator('body').evaluate(el=>el.classList.contains('basket-dragging')),false);
 await mp.locator('#fund-basket-button').tap(); await mp.waitForTimeout(300); await mp.locator('[data-basket-action=collect]').tap({timeout:3000});
 assert.equal(await mp.locator('#fund-basket-button .basket-count').textContent(),'5');
 assert.equal(await mp.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 console.log('PASS: mobile horizontal gallery swipe, vertical scroll, button-based collection and width.');
 await mobile.close();
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
