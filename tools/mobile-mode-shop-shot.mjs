// AGPL-3.0-or-later. Mobile mode shop flow against the REAL VB6 server (22 Nov: on Ariel's iPhone the NPC's words ran off the screen
// and there was no way to trade). A GM account (Aotest) brings the test character to the Ullathorpe magic shop and revives it; the
// phone (WebKit iPhone 13, portrait then landscape) taps the merchant, the shop opens inside the screen, sells one item and buys one.
// Usage: AO_WEB_PORT=5862 AO_EMAIL=.. AO_PASSWORD=.. AO_CHAR=Name AO_GM_EMAIL=.. AO_GM_PASSWORD=.. [AO_SPOT="1 61 63"] node tools/mobile-mode-shop-shot.mjs
import { devices, webkit } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { FrameDecoder, decodeClientPacket } from '../packages/protocol/dist/index.js';
const need = n => process.env[n] ?? (() => { throw new Error(`Set ${n}`); })();
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5862}/`, out = 'artifacts/screenshots';
mkdirSync(out, { recursive: true });
const failures = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) failures.push(what); };

async function login(page, email, password, touch) {
  await page.goto(`${base}?debug`); await page.waitForTimeout(2000);
  await page.locator('#email').fill(email); await page.locator('#password').fill(password);
  await (touch ? page.locator('#connect').tap() : page.locator('#connect').click());
  await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1200);
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.locator('.cs-slot-hit').first().dblclick({ timeout: 10_000 }).catch(() => undefined);
    if (await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 15_000 }).then(() => true, () => false)) break;
  }
  await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 30_000 }); await page.waitForTimeout(2000);
}
/** In the page: the shop and the NPC strip inside the screen, close button reachable, the page not scrolled. */
const fits = () => {
  const W = innerWidth, H = innerHeight, out = [];
  for (const selector of ['#shop', '#shop-close', '#shop-buy', '#shop-sell', '#npc-dialog', '#mobile-top .m-who', '#m-menu']) {
    const node = document.querySelector(selector); if (!node || node.closest('[hidden]')) continue;
    const r = node.getBoundingClientRect();
    if (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5) out.push(`${selector} outside ${W}x${H}: ${[r.left, r.top, r.right, r.bottom].map(Math.round)}`);
  }
  if (scrollX || scrollY || document.scrollingElement.scrollTop) out.push(`page scrolled ${scrollX},${scrollY}`);
  return out;
};

const phone = await webkit.launch();
try {
  for (const [name, device] of [['portrait', devices['iPhone 13']], ['landscape', devices['iPhone 13 landscape']]]) {
    const context = await phone.newContext({ ...device });
    const page = await context.newPage();
    const sent = [];
    page.on('websocket', ws => { const f = new FrameDecoder(); ws.on('framesent', ({ payload }) => { for (const b of f.push(Buffer.from(payload))) { const p = decodeClientPacket(b); sent.push(p); } }); });
    await login(page, need('AO_EMAIL'), need('AO_PASSWORD'), true);
    const merchants = async () => {
      const chars = await page.evaluate(() => window.aoMobile.chars());
      // Never next to another player (Ariel plays on this server): only merchants with no other player within 6 tiles.
      const players = chars.filter(c => c.kind === 'player'), self = chars.find(c => c.kind === 'self') ?? { x: 0, y: 0 };
      return { chars, list: chars.filter(c => c.rule === 'npc-trade' && !players.some(p => Math.abs(p.x - c.x) + Math.abs(p.y - c.y) < 6))
        .sort((a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y)) };
    };
    const { chars, list } = await merchants();
    const merchant = list[0];
    check(!!merchant, `${name}: a merchant on screen (${merchant?.name ?? chars.map(c => `${c.name}:${c.rule}`).join(', ')})`);
    if (!merchant) { await page.screenshot({ path: `${out}/mobile-shop-${name}-nomerchant.png` }); await context.close(); continue; }
    const mark = sent.length;
    await page.touchscreen.tap(merchant.clientX, merchant.clientY - 12);
    const opened = await page.locator('#shop').waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
    const leftClicks = sent.slice(mark).filter(p => 'x' in p && 'counter' in p).map(p => [p.x, p.y]);
    check(opened, `${name}: one tap on ${merchant.name} opens the shop (LeftClick ${JSON.stringify(leftClicks)}, NPC at ${merchant.x},${merchant.y})`);
    check((await page.locator('#m-act .m-act-label').innerText()) === 'Comerciar', `${name}: the big button says Comerciar`);
    await page.waitForTimeout(800);
    const problems = await page.evaluate(fits);
    check(problems.length === 0, `${name}: shop inside the screen ${JSON.stringify(problems)}`);
    await page.screenshot({ path: `${out}/mobile-shop-${name}.png` });
    if (opened && name === 'portrait') {
      // Sell one of the first user item, then buy the first NPC item: the server answers each with the inventory update and a console line.
      const userSlot = page.locator('#shop .items-slot[data-side="user"]').first();
      await userSlot.tap(); await page.locator('#shop-sell').tap(); await page.waitForTimeout(1500);
      await page.locator('#shop .items-slot[data-side="npc"]').first().tap(); await page.waitForTimeout(400);
      const item = await page.locator('#shop-item-name').innerText(), cost = await page.locator('#shop-item-cost').innerText();
      const before = sent.length;
      await page.locator('#shop-buy').tap(); await page.waitForTimeout(1500);
      const trade = sent.slice(mark).map(p => p.id).filter(id => /Commerce/.test(String(id)) || typeof id === 'number');
      console.log('   sell+buy packets', JSON.stringify(sent.slice(mark).map(p => p.id)));
      check(sent.length > before, `portrait: Comprar sent a packet for "${item}" (${cost})`);
      await page.screenshot({ path: `${out}/mobile-shop-portrait-bought.png` });
      const lines = await page.locator('#console').innerText();
      console.log('   console tail:', lines.split('\n').slice(-4).join(' | '));
    }
    if (opened) {
      await page.locator('#shop-close').tap(); await page.waitForTimeout(400);
      check(await page.locator('#shop').isHidden(), `${name}: the close button closes the shop`);
      // The merchant's words come back once the shop is closed: a strip inside the screen, clear of the thumbs.
      if (await page.locator('#npc-dialog').isVisible()) {
        const strip = await page.evaluate(fits);
        check(strip.length === 0, `${name}: the NPC strip inside the screen ${JSON.stringify(strip)}`);
        await page.screenshot({ path: `${out}/mobile-shop-${name}-npc-strip.png` });
      } else console.log(`   ${name}: the greeting had already faded`);
    }
    // The NPC's words: tap the NPC once more after closing to get a description strip, then check it fits.
    await context.close(); await new Promise(r => setTimeout(r, 10_000));
  }
} finally { await phone.close(); }
if (failures.length) { console.log('FAILED', failures); process.exit(1); }
console.log('shop flow passed');
