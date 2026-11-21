// AGPL-3.0-or-later. Headless Chrome against the REAL VB6 server for the combat-items package (wave 3).
// Usage: AO_WEB_PORT=5784 AO_EMAIL=.. AO_PASSWORD=.. [AO_CHAR=..] node tools/combat-items-real-shot.mjs paralysed|revive|cards
//   paralysed: login of a character with user.is_paralyzed=1 (DB): status shows, a walk key does nothing, the paralysis expires ~20 s later.
//   revive:    login dead next to the priest (DB): left-click the priest, the character is revived (status, body, HP bar).
//   cards:     GM (Aotest): /CI a collectible card and an item with elemental tags, screenshot the inventory icons and the card viewer.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
const mode = process.argv[2] ?? 'paralysed';
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5784}/`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = [], sent = [];
page.on('pageerror', e => problems.push(e.message));
const t0 = Date.now(), got = [];
page.on('websocket', ws => ws.on('framereceived', f => { const b = Buffer.from(f.payload); if (b.length >= 4 && [97, 2].includes(b.readUInt16LE(2))) got.push(`${b.readUInt16LE(2)}@${Math.round((Date.now() - t0) / 1000)}s`); }));
page.on('websocket', ws => ws.on('framesent', f => { const b = Buffer.from(f.payload); if (b.length >= 4) sent.push(b.readUInt16LE(2)); }));
await page.goto(base);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD'));
await page.locator('#connect').click();
// The account screen: cards at x = 247 + 132 * (n - 1), y = 291 (AO_CARD = n, default 1); a double click plays.
await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30_000 }); await page.waitForTimeout(2000);
await page.mouse.dblclick(247 + 132 * (Number(process.env.AO_CARD ?? 1) - 1), 291);
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
await page.waitForTimeout(2500);
mkdirSync('artifacts/screenshots', { recursive: true });
const shot = name => page.screenshot({ path: `artifacts/screenshots/combat-items-${name}.png` });
const lines = async n => (await page.locator('#messages').innerText()).split('\n').slice(-n);
const pos = async () => (await page.locator('#position').innerText());
const rect = await page.locator('#viewport').boundingBox();
const tilePx = (dx, dy) => [rect.x + rect.width / 2 + dx * 32, rect.y + rect.height / 2 + dy * 32];
if (mode === 'paralysed') {
  await shot('paralysed-login');
  const before = await pos(); await page.keyboard.down('ArrowRight'); await page.waitForTimeout(700); await page.keyboard.up('ArrowRight');
  console.log('position before/after a walk key while paralysed', before, await pos()); await shot('paralysed-walk-blocked');
  await page.waitForTimeout(23_000);
  const free = await pos(); await page.keyboard.down('ArrowRight'); await page.waitForTimeout(700); await page.keyboard.up('ArrowRight');
  console.log('after expiry, before/after a walk', free, await pos()); await shot('paralysed-expired');
} else if (mode === 'revive') {
  await shot('dead-at-login');
  const [x, y] = tilePx(Number(process.env.AO_PRIEST_DX ?? -1), Number(process.env.AO_PRIEST_DY ?? 3));
  await page.mouse.click(x, y); await page.waitForTimeout(1800);
  console.log('after clicking the priest:', JSON.stringify(await lines(3))); await shot('revived');
}
console.log(JSON.stringify({ problems, sentIds: [...new Set(sent)], got }));
await browser.close();
