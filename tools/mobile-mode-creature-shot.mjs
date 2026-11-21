// AGPL-3.0-or-later. Mobile mode against the REAL VB6 server, the creature half: a GM (desktop page) walks to the test character,
// spawns ONE chicken (/ACC 501), the phone page taps it and long-presses it, then the GM removes it (click + /RMATA) and goes back.
// Usage: AO_WEB_PORT=5848 AO_EMAIL=.. AO_PASSWORD=.. AO_CHAR=Name AO_GM_EMAIL=.. AO_GM_PASSWORD=.. node tools/mobile-mode-creature-shot.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { FrameDecoder, decodeClientPacket } from '../packages/protocol/dist/index.js';
const need = n => process.env[n] ?? (() => { throw new Error(`Set ${n}`); })();
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5848}/?debug`;
const out = 'artifacts/screenshots';
mkdirSync(out, { recursive: true });
const log = (n, v) => console.log(n, JSON.stringify(v));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const login = async (page, email, password) => {
  await page.goto(base); await page.waitForTimeout(2500);
  await page.locator('#email').fill(email); await page.locator('#password').fill(password); await page.locator('#connect').click();
  await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30000 }).catch(async error => {
    await page.screenshot({ path: `${out}/mobile-real-login-failed.png` }); console.log('login screen text', await page.locator('body').innerText()); throw error;
  });
  await page.waitForTimeout(1200);
  await page.locator('.cs-slot-hit').first().dblclick();
  await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 90_000 }).catch(async error => {
    await page.screenshot({ path: `${out}/mobile-real-enter-failed-${email.split('@')[0]}.png` }); console.log('enter failed, messages:', await page.locator('#messages').textContent(), await page.locator('.vb-window, [role="alertdialog"]').allTextContents().catch(() => [])); throw error;
  });
  await page.waitForTimeout(2500);
};
const say = async (page, line) => { await page.keyboard.press('Enter'); await page.locator('#chat').fill(line); await page.keyboard.press('Enter'); await page.waitForTimeout(1500); };
let gm, spawned, gmHome;
try {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await phone.addInitScript(() => { try { localStorage.setItem('ao.layout', 'mobile'); } catch { /* no storage */ } });
  const page = await phone.newPage();
  const sent = [], problems = [];
  page.on('pageerror', e => problems.push(e.message));
  page.on('websocket', ws => { const f = new FrameDecoder(); ws.on('framesent', ({ payload }) => { for (const b of f.push(Buffer.from(payload))) { const p = decodeClientPacket(b); sent.push('unknown' in p ? { id: 'unknown' } : p); } }); });
  await login(page, need('AO_EMAIL'), need('AO_PASSWORD'));
  log('phone at', await page.locator('#position').textContent());

  let chicken;
  if (!process.env.AO_GM_EMAIL) {
    // No GM: walk (with the joystick) towards the nearest native hostile creature until it is a few tiles away.
    const zone = await page.locator('#mobile-joystick').boundingBox(), jx = zone.x + zone.width / 2, jy = zone.y + zone.height / 2;
    // Dat/npcs.dat (the hostility table) loads when the mobile layout opens; give it a moment on a busy machine.
    for (let i = 0; i < 20 && !(await page.evaluate(() => window.aoMobile.chars())).some(c => c.kind === 'hostile'); i++) await page.waitForTimeout(500);
    for (let step = 0; step < 60; step++) {
      const all = await page.evaluate(() => window.aoMobile.chars()), me = all.find(c => c.kind === 'self');
      const prey = all.filter(c => c.kind === 'hostile').sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
      if (!prey) { log('no hostile creature in range', all.map(c => [c.name, c.kind, c.npcNumber, c.x, c.y])); break; }
      const dx = prey.x - me.x, dy = prey.y - me.y;
      if (Math.abs(dx) + Math.abs(dy) <= 3) { chicken = prey; break; }
      const [mx, my] = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx) * 45, 0] : [0, Math.sign(dy) * 45];
      await page.mouse.move(jx, jy); await page.mouse.down(); await page.mouse.move(jx + mx, jy + my, { steps: 2 }); await page.waitForTimeout(260); await page.mouse.up(); await page.waitForTimeout(150);
    }
    log('walked to', await page.locator('#position').textContent());
  } else {
  const desk = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  await desk.addInitScript(() => { try { localStorage.setItem('ao.layout', 'classic'); } catch { /* no storage */ } });
  gm = await desk.newPage();
  await login(gm, need('AO_GM_EMAIL'), need('AO_GM_PASSWORD'));
  const home = { map: await gm.locator('#map-number').innerText(), pos: await gm.locator('#position').innerText() };
  log('gm home', home); gmHome = `${home.map} ${home.pos.replace(',', ' ').replace(/\s+/g, ' ').trim()}`;
  await say(gm, `/IRA ${need('AO_CHAR')}`);
  const before = new Set((await gm.evaluate(() => window.aoMobile.chars())).map(c => c.charIndex));
  await say(gm, '/ACC 501');
  chicken = (await gm.evaluate(() => window.aoMobile.chars())).find(c => !before.has(c.charIndex) && c.npcNumber === 501);
  spawned = chicken;
  log('spawned', chicken && { charIndex: chicken.charIndex, at: [chicken.x, chicken.y] });
  }
  if (!chicken) throw new Error('no creature to tap');
  log('creature', { name: chicken.name, npcNumber: chicken.npcNumber, at: [chicken.x, chicken.y] });
  await page.waitForTimeout(1000);
  const find = async () => (await page.evaluate(() => window.aoMobile.chars())).find(c => c.charIndex === chicken.charIndex);
  let c = await find();
  log('phone sees', c && { kind: c.kind, rule: c.rule, at: [c.x, c.y] });
  await page.screenshot({ path: `${out}/mobile-real-creature-before.png` });
  for (let i = 0; i < 2 && c; i++) {
    const mark = sent.length;
    await page.touchscreen.tap(c.clientX, c.clientY - 18); await page.waitForTimeout(1600);
    log(`tap ${i + 1} sent`, sent.slice(mark).map(p => ({ id: p.id, ...('x' in p ? { x: p.x, y: p.y } : {}), ...('slot' in p ? { slot: p.slot } : {}), ...('skill' in p ? { skill: p.skill } : {}) })));
    log('button', { text: await page.locator('#m-act').innerText(), rule: await page.locator('#m-act').getAttribute('data-rule') });
    log('console', (await page.locator('#messages').innerText()).split('\n').slice(-3));
    if (i === 0) await page.screenshot({ path: `${out}/mobile-real-tap.png` });
    c = await find();
  }
  if (c) {
    await page.mouse.move(c.clientX, c.clientY - 18); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); await page.waitForTimeout(400);
    log('picker', await page.locator('#mobile-picker').isVisible() ? await page.locator('#mobile-picker').innerText() : 'hidden');
    await page.screenshot({ path: `${out}/mobile-real-picker.png` });
    await page.locator('#mobile-picker .m-close').tap().catch(() => undefined);
  } else log('chicken gone after the taps (killed)', true);
  // Potions: one tap keeps drinking (paced) until the bar is full; a second tap stops.
  if (await page.locator('#m-potion-hp').isVisible()) {
    const count = from => sent.slice(from).filter(p => p.id === 288).length;
    const mark = sent.length; await page.locator('#m-potion-hp').tap(); await page.waitForTimeout(3000);
    const during = count(mark); await page.locator('#m-potion-hp').tap(); const stop = sent.length; await page.waitForTimeout(1500);
    log('red potion: UseItemU in 3 s', during); log('after the second tap', count(stop));
    log('hp', await page.locator('#m-hp-text').textContent());
  } else log('red potion button hidden (HP full or no potion)', true);
  log('problems', problems);
} finally {
  if (gm) {
    // Remove the chicken if it is still there (click it, /RMATA), then the GM goes back home.
    const left = spawned && (await gm.evaluate(() => window.aoMobile.chars())).find(c => c.charIndex === spawned.charIndex);
    if (left) { await gm.mouse.click(left.clientX, left.clientY); await gm.waitForTimeout(600); await say(gm, '/RMATA'); }
    const still = spawned && (await gm.evaluate(() => window.aoMobile.chars())).find(c => c.charIndex === spawned.charIndex);
    log('chicken removed', !still);
    if (gmHome) { await say(gm, `/TELEP YO ${gmHome}`); log('gm back at', `${await gm.locator('#map-number').innerText()} ${await gm.locator('#position').innerText()}`); }
  }
  await browser.close();
}
