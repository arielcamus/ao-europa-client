// AGPL-3.0-or-later. Headless Chrome against the REAL VB6 server for WP-C (render): log in, optionally run chat/GM lines, screenshot the viewport at 2x.
// Usage: AO_WEB_PORT=5796 AO_EMAIL=.. AO_PASSWORD=.. AO_NAME=<file label> [AO_CMDS="/TELEP Aotest 1 60 50;;/ACC 501"] [AO_KEYS="ArrowLeft"] node tools/wpc-render-shot.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const need = n => process.env[n] ?? (() => { throw new Error(`Set ${n}`); })();
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5796}/`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2 });
const problems = []; page.on('pageerror', e => problems.push(e.message));
mkdirSync('artifacts/screenshots', { recursive: true });
await page.goto(base);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD'));
await page.locator('#connect').click();
await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30_000 }); await page.waitForTimeout(1500);
await page.mouse.dblclick(247 + 132 * (Number(process.env.AO_CARD ?? 1) - 1), 291);
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 }); await page.waitForTimeout(2500);
// A stale server session shows "Alguien está ingresando con tu personaje" (a modal that eats the keys): dismiss it.
await page.getByRole('button', { name: 'Aceptar' }).click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(500);
const say = async text => { await page.keyboard.press('Enter'); await page.keyboard.type(text); await page.keyboard.press('Enter'); await page.waitForTimeout(1200); };
for (const cmd of (process.env.AO_CMDS ?? '').split(';;').filter(Boolean)) await say(cmd);
// AO_GOTO="x,y;x,y": walk (arrow keys held until the HUD position matches), screenshot at each stop.
const here = async () => (await page.locator('#position').innerText()).split(',').map(n => Number(n.trim()));
for (const stop of (process.env.AO_GOTO ?? '').split(';').filter(Boolean)) {
  const [tx, ty] = stop.split(',').map(Number);
  let stuck = 0;
  for (let i = 0; i < 150; i++) {
    const [x, y] = await here(); if (x === tx && y === ty) break;
    const horizontal = x !== tx && (stuck < 2 || y === ty);
    const key = horizontal ? (x < tx ? 'ArrowRight' : 'ArrowLeft') : y !== ty ? (y < ty ? 'ArrowDown' : 'ArrowUp') : (x < tx ? 'ArrowRight' : 'ArrowLeft');
    await page.keyboard.down(key); await page.waitForTimeout(230); await page.keyboard.up(key); await page.waitForTimeout(120);
    const [nx, ny] = await here(); stuck = nx === x && ny === y ? stuck + 1 : 0; if (stuck > 5) stuck = 0;
  }
  await page.getByRole('button', { name: 'Aceptar' }).click({ timeout: 800 }).catch(() => {}); await page.waitForTimeout(1500); await page.locator('#viewport').screenshot({ path: `artifacts/screenshots/wpc-${process.env.AO_NAME}-at-${tx}-${ty}.png` });
}
const name = process.env.AO_NAME ?? 'login';
const shot = suffix => page.locator('#viewport').screenshot({ path: `artifacts/screenshots/wpc-${name}-${suffix}.png` });
await page.waitForTimeout(1500); await shot('start');
// AO_KEYS: one step per key, a screenshot after each (walk there and back to leave the character where it started).
for (const key of (process.env.AO_KEYS ?? '').split(',').filter(Boolean)) {
  await page.keyboard.down(key); await page.waitForTimeout(60); await page.keyboard.up(key); await page.waitForTimeout(900); await shot(key);
}
if (process.env.AO_FRAMES) {
  // Average rAF interval over AO_FRAMES seconds at the current spot (headless software GL: relative numbers, not absolute).
  const ms = await page.evaluate(sec => new Promise(done => { let n = 0; const t0 = performance.now(); const tick = t => { n++; if (t - t0 >= sec * 1000) done((t - t0) / n); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }), Number(process.env.AO_FRAMES));
  console.log(`frameMs ${ms.toFixed(2)}`);
}
console.log(JSON.stringify({ problems, pos: await page.locator('#position').innerText().catch(() => '?') }));
await page.locator('#disconnect').click({ force: true, timeout: 2000 }).catch(() => {}); await page.waitForTimeout(1500);
await browser.close();
