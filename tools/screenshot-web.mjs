// Local-only Chrome smoke test. Screenshots contain licensed artwork and are ignored by git.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const directory = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
await mkdir(directory, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.AO_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-webgl', '--enable-unsafe-swiftshader', '--disable-background-networking', '--no-first-run'],
});
const base = process.env.AO_WEB_URL ?? 'http://127.0.0.1:5173';
const errors = [];
const pages = [];
async function open(viewport) {
  const page = await browser.newPage();
  console.log(`Checking ${viewport.width}x${viewport.height}`);
  pages.push(page);
  await page.setViewport(viewport);
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.click('#connect');
  try {
    await page.waitForFunction(() => document.body.dataset.state === 'error' || (document.body.dataset.state === 'ready' && document.querySelector('#game')?.getAttribute('data-rendered') === 'true'), { timeout: 45_000 });
    assert.equal(await page.$eval('body', el => el.dataset.state), 'ready', await page.$eval('#message', el => el.textContent));
  } catch (error) {
    console.error(await page.$eval('#message', el => el.textContent), errors);
    throw error;
  }
  return page;
}
const position = page => page.$eval('#position', el => ({ x: Number(el.dataset.x), y: Number(el.dataset.y), walks: Number(el.dataset.walks), corrections: Number(el.dataset.corrections) }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const desktop = await open({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const initial = await position(desktop);
  assert.deepEqual([initial.x, initial.y], [50, 50], 'default map-1 spawn');
  // At map 1 (50,50), west is blocked and east is open. Exercise packet 31.
  await desktop.keyboard.press('ArrowLeft');
  await desktop.waitForFunction(() => Number(document.querySelector('#position').dataset.corrections) === 1);
  assert.equal((await position(desktop)).x, 50, 'wall correction');
  await pause(350);
  await desktop.keyboard.press('d');
  await desktop.waitForFunction(() => Number(document.querySelector('#position').dataset.x) === 51);
  await pause(350);
  assert.equal((await position(desktop)).x, 51, 'accepted prediction survives server interval');
  await desktop.keyboard.press('a');
  await desktop.waitForFunction(() => Number(document.querySelector('#position').dataset.x) === 50);
  await pause(350);
  assert.equal((await position(desktop)).x, 50);
  await desktop.waitForFunction(() => document.body.dataset.state === 'ready' && document.querySelector('#game').dataset.rendered === 'true');
  await desktop.screenshot({ path: join(directory, 'm2-desktop.png') });

  const mobile = await open({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  assert.equal(await mobile.$eval('#dpad', el => getComputedStyle(el).display), 'grid');
  const east = await mobile.$eval('[aria-label="Walk east"]', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height }; });
  assert.ok(east.width >= 44 && east.height >= 44, 'touch target size');
  await mobile.touchscreen.tap(east.x, east.y);
  await mobile.waitForFunction(() => Number(document.querySelector('#position').dataset.x) === 51);
  await pause(400);
  const afterTap = await position(mobile);
  await pause(400);
  assert.equal((await position(mobile)).walks, afterTap.walks, 'tap release stops repeated walks');
  // Exercise a real touch drag on the canvas, then release. No synthetic app calls.
  const cdp = await mobile.createCDPSession();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 240, y: 320 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 240, y: 360 }] });
  await mobile.waitForFunction(() => Number(document.querySelector('#position').dataset.y) > 50);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const afterDrag = await position(mobile);
  await pause(450);
  assert.equal((await position(mobile)).walks, afterDrag.walks, 'drag release stops walking');
  // DPR and viewport resize without reloading the session.
  await mobile.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await pause(300);
  const resolution = await mobile.$eval('canvas', canvas => ({ width: canvas.width, css: canvas.getBoundingClientRect().width, dpr: devicePixelRatio }));
  assert.equal(resolution.width, Math.round(resolution.css * resolution.dpr));
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await mobile.waitForFunction(() => document.body.dataset.state === 'ready' && document.querySelector('#game').dataset.rendered === 'true');
  await pause(350);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow');
  for (const page of pages) assert.equal(await page.$eval('body', el => el.dataset.state), 'ready', await page.$eval('#message', el => el.textContent));
  await mobile.screenshot({ path: join(directory, 'm2-mobile.png') });
  assert.deepEqual(errors, [], 'no browser errors or missing asset responses');
  console.log(JSON.stringify({ desktop: await position(desktop), mobile: await position(mobile), dprCheck: resolution, browser: await browser.version() }, null, 2));
  console.log(`${join(directory, 'm2-desktop.png')}\n${join(directory, 'm2-mobile.png')}`);
} finally { await browser.close(); }
