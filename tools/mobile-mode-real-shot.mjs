// AGPL-3.0-or-later. Mobile mode (prototype) against the REAL VB6 server: phone emulation (touch, DPR 2), portrait and landscape,
// a tap on a creature and a long-press, with the packets the taps sent. Usage:
//   AO_WEB_PORT=5848 AO_EMAIL=.. AO_PASSWORD=.. [AO_CHAR=Name to create the account+character first] node tools/mobile-mode-real-shot.mjs
// Writes artifacts/screenshots/mobile-real-*.png and artifacts/screenshots/mobile-real-composite.png.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { FrameDecoder, decodeClientPacket } from '../packages/protocol/dist/index.js';
const need = n => process.env[n] ?? (() => { throw new Error(`Set ${n}`); })();
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5848}/`;
const out = 'artifacts/screenshots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const log = (n, v) => console.log(n, JSON.stringify(v));
try {
  if (process.env.AO_CHAR) {
    // Account + character on a desktop-sized page (the connect screens are classic in both layouts).
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await page.goto(base); await page.waitForTimeout(2500);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    const win = page.locator('#new-account-window'); await win.waitFor();
    const [, , email, pass, captcha] = await win.locator('input').all();
    const sum = (await win.locator('.vb-label').first().innerText()).split('+').map(Number).reduce((a, b) => a + b);
    await email.fill(need('AO_EMAIL')); await pass.fill(need('AO_PASSWORD')); await captcha.fill(String(sum));
    await win.getByRole('button', { name: 'Crear cuenta' }).click();
    await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(1500);
    await page.mouse.click(330, 728); await page.waitForTimeout(2000);
    await page.locator('.cs-name').fill(process.env.AO_CHAR);
    log('class', await page.locator('#connect-stage').evaluate(n => n.textContent?.match(/Mago|Clérigo|Guerrero/)?.[0]));
    await page.getByRole('button', { name: 'Raza siguiente' }).click(); await page.getByRole('button', { name: 'Genero siguiente' }).click();
    await page.locator('.cs-create').getByRole('button', { name: 'Crear personaje' }).click();
    await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 90_000 }); await page.waitForTimeout(2000);
    await page.close(); await new Promise(r => setTimeout(r, 4000));
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await context.addInitScript(() => { try { localStorage.setItem('ao.layout', 'mobile'); } catch { /* no storage */ } });
  const page = await context.newPage();
  const problems = [], sent = [];
  page.on('pageerror', e => problems.push(e.message));
  page.on('websocket', ws => {
    const framing = new FrameDecoder();
    ws.on('framesent', ({ payload }) => { for (const body of framing.push(Buffer.from(payload))) { const p = decodeClientPacket(body); sent.push('unknown' in p ? { id: 'unknown' } : p); } });
  });
  await page.goto(`${base}?debug`); await page.waitForTimeout(2500);
  await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').tap();
  await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
  await page.locator('.cs-slot-hit').first().dblclick();
  await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 90_000 }); await page.waitForTimeout(3500);
  log('mobile layer visible', await page.locator('#mobile-layer').isVisible());
  const vp = await page.locator('#viewport').boundingBox();
  log('px per tile (portrait)', vp.width / 23);
  log('top bar', await page.locator('#mobile-top').innerText());
  const chars = await page.evaluate(() => window.aoMobile.chars());
  log('characters', chars.map(c => ({ name: c.name, kind: c.kind, rule: c.rule, at: [c.x, c.y], screen: [Math.round(c.clientX), Math.round(c.clientY)] })));
  await page.screenshot({ path: `${out}/mobile-real-portrait.png` });
  // Tap the nearest creature (hostile first, else any NPC) that is on screen and above the deck.
  const deckTop = (await page.locator('#mobile-deck').boundingBox()).y;
  const onScreen = chars.filter(c => c.kind !== 'self' && c.clientX > 10 && c.clientX < 380 && c.clientY > 120 && c.clientY < deckTop - 10);
  const target = onScreen.find(c => c.kind === 'hostile') ?? onScreen[0];
  if (target) {
    let mark = sent.length;
    // The head tile (a sprite is two tiles tall): what a thumb would hit.
    await page.touchscreen.tap(target.clientX, target.clientY - 20); await page.waitForTimeout(1500);
    log(`tap on ${target.name} (${target.kind}, rule ${target.rule}) sent`, sent.slice(mark).map(p => ({ id: p.id, ...('x' in p ? { x: p.x, y: p.y } : {}), ...('slot' in p ? { slot: p.slot } : {}), ...('skill' in p ? { skill: p.skill } : {}) })));
    log('primary button', { text: await page.locator('#m-act').innerText(), rule: await page.locator('#m-act').getAttribute('data-rule') });
    await page.screenshot({ path: `${out}/mobile-real-tap.png` });
    // Long-press: the spell picker.
    const after = (await page.evaluate(() => window.aoMobile.chars())).find(c => c.charIndex === target.charIndex) ?? target;
    await page.mouse.move(after.clientX, after.clientY - 20); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
    await page.waitForTimeout(400);
    log('picker', await page.locator('#mobile-picker').isVisible() ? await page.locator('#mobile-picker').innerText() : 'hidden');
    await page.screenshot({ path: `${out}/mobile-real-picker.png` });
    await page.locator('#mobile-picker .m-close').tap().catch(() => undefined);
  } else log('no creature on screen', chars.length);
  await page.locator('#m-drawer-btn').tap(); await page.waitForTimeout(600);
  log('drawer spells', await page.locator('#mobile-drawer .m-spell').allInnerTexts());
  await page.screenshot({ path: `${out}/mobile-real-drawer.png` });
  await page.locator('#mobile-drawer .m-close').tap();
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(1500);
  log('px per tile (landscape)', (await page.locator('#viewport').boundingBox()).width / 23);
  await page.screenshot({ path: `${out}/mobile-real-landscape.png` });
  log('problems', problems);
  // One picture: portrait, tap, picker, drawer, then landscape underneath.
  const img = n => `data:image/png;base64,${readFileSync(`${out}/mobile-real-${n}.png`).toString('base64')}`;
  const names = ['portrait', 'tap', 'picker', 'drawer'].filter(n => { try { readFileSync(`${out}/mobile-real-${n}.png`); return true; } catch { return false; } });
  const sheet = await browser.newPage({ viewport: { width: 1700, height: 1400 } });
  await sheet.setContent(`<body style="margin:0;background:#222;color:#ddd;font:16px sans-serif;padding:12px">
    <div style="display:flex;gap:12px">${names.map(n => `<figure style="margin:0"><img src="${img(n)}" style="width:390px;height:844px;display:block"><figcaption>${n}</figcaption></figure>`).join('')}</div>
    <figure style="margin:12px 0 0"><img src="${img('landscape')}" style="width:844px;height:390px;display:block"><figcaption>landscape</figcaption></figure></body>`);
  await sheet.screenshot({ path: `${out}/mobile-real-composite.png`, fullPage: true });
  await context.close();
} finally { await browser.close(); }
