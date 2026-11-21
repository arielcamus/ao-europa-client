// AGPL-3.0-or-later. Headless Chrome against the REAL VB6 server (through tools/fx-inject-proxy.mjs for the packets the server only
// sends in events): the sign (ShowSignal), Esc during the logout countdown (CancelarExit), and CharacterTranslate / UpdateTagAndStatus /
// UpdateFlag / UpdateCharValue rendering. Shots go to artifacts/screenshots/npcs-chat-*.png.
// Usage: AO_WEB_PORT=5783 AO_CONTROL=7796 AO_EMAIL=.. AO_PASSWORD=.. node tools/npcs-chat-shot.mjs sign|exit|inject
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const mode = process.argv[2] ?? 'sign';
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5783}/`, control = `http://127.0.0.1:${process.env.AO_CONTROL ?? 7796}`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = [], sent = [];
page.on('pageerror', e => problems.push(e.message));
page.on('websocket', ws => ws.on('framesent', f => { const b = Buffer.from(f.payload); if (b.length >= 4) sent.push(b.readUInt16LE(2)); }));
await page.goto(base);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30_000 }); await page.waitForTimeout(2000);
// The account screen: slot 1 (AO_SLOT=2 picks the next one, 70 px lower on the 1024x768 window).
await page.mouse.dblclick(247, 291 + (Number(process.env.AO_SLOT ?? 1) - 1) * 70);
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
await page.waitForTimeout(2500);
mkdirSync('artifacts/screenshots', { recursive: true });
const shot = name => page.screenshot({ path: `artifacts/screenshots/npcs-chat-${name}.png` });
const say = async text => { await page.keyboard.press('Enter'); await page.keyboard.type(text); await page.keyboard.press('Enter'); await page.waitForTimeout(700); };
const inject = body => fetch(`${control}/packet`, { method: 'POST', body: JSON.stringify(body) });
const position = async () => (await page.locator('#position').innerText()).split(', ').map(Number);
const tilePx = async (tx, ty) => { const r = await page.locator('#viewport').boundingBox(); const [px, py] = await position(); return { x: r.x + r.width / 2 + (tx - px) * 32, y: r.y + r.height / 2 + (ty - py) * 32 }; };
const messages = async () => (await page.locator('#messages').innerText()).split('\n').slice(-8);
if (mode === 'sign') {
  const [sx, sy] = (process.env.AO_SIGN ?? '69,37').split(',').map(Number);
  await say(`/TELEP ${process.env.AO_CHAR ?? 'Aotest'} 1 ${sx} ${sy + 1}`); await page.waitForTimeout(2500);
  const p = await tilePx(sx, sy);
  await page.mouse.click(p.x, p.y); await page.waitForTimeout(1200);
  await shot('sign-open');
  console.log('sign visible', await page.locator('#sign-cartel').isVisible(), (await page.locator('#sign-cartel .sign-text').innerText().catch(() => '')).slice(0, 80));
  await page.keyboard.down('ArrowDown'); await page.waitForTimeout(150); await page.keyboard.up('ArrowDown'); await page.waitForTimeout(400);
  console.log('sign visible after a step', await page.locator('#sign-cartel').isVisible());
  await shot('sign-closed');
} else if (mode === 'exit') {
  // /SALIR counts down only outside safe maps (and for non-GMs): a GM page (AO_GM_EMAIL / AO_GM_PASSWORD) summons this character to the GM (who stands on map 2).
  if (process.env.AO_GM_EMAIL) {
    const gm = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await gm.goto(base);
    await gm.locator('#email').fill(process.env.AO_GM_EMAIL); await gm.locator('#password').fill(need('AO_GM_PASSWORD')); await gm.locator('#connect').click();
    await gm.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30_000 }); await gm.waitForTimeout(2000);
    await gm.mouse.dblclick(247, 291);
    await gm.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 }); await gm.waitForTimeout(2000);
    await gm.keyboard.press('Enter'); await gm.keyboard.type(`/SUM ${process.env.AO_CHAR}`); await gm.keyboard.press('Enter'); await gm.waitForTimeout(2500);
    console.log('GM console', (await gm.locator('#messages').innerText()).split('\n').slice(-4)); await gm.screenshot({ path: 'artifacts/screenshots/npcs-chat-gm.png' });
    await gm.close(); await page.waitForTimeout(2000);
  }
  await shot('exit-before');
  // This server's IntervaloCerrarConexion is short (it disconnects within about a second), so Esc follows /SALIR at once.
  await page.keyboard.press('Enter'); await page.keyboard.type('/SALIR'); await page.keyboard.press('Enter'); await page.waitForTimeout(40);
  sent.length = 0;
  await page.keyboard.press('Escape'); await page.waitForTimeout(500); await shot('exit-cancelled');
  console.log('after Esc', await messages(), 'client ids sent', sent.join(','), 'CancelarExit(247) sent:', sent.includes(247));
} else if (mode === 'chat') {
  // Regression: a speech bubble over the player and the NPC dialog window after the tracker/locale refactor (click Seraphia on map 1, 77,32).
  await say('hola mundo'); await page.waitForTimeout(500); await shot('chat-bubble');
  await say(`/TELEP ${process.env.AO_CHAR ?? 'Aotest'} 1 77 34`); await page.waitForTimeout(500);
  const [nx, ny] = [77, 32]; const p = await tilePx(nx, ny);
  await page.mouse.click(p.x, p.y); await page.waitForTimeout(2500); await shot('chat-npc-dialog');
  console.log('npc dialog visible', await page.locator('#npc-dialog').isVisible());
} else if (mode === 'inject') {
  const [px, py] = await position();
  const base = { id: 42, body: 1, head: 1, heading: 3, weapon: 0, shield: 0, helmet: 0, cart: 0, backpack: 0, fx: 0, fxLoops: 0, status: 1, privileges: 0, particleFx: 0,
    headAura: '', weaponAura: '', bodyAura: '', damageAura: '', resistanceAura: '', otherAura: '', shieldAura: '', speeding: 1, npc: 0, appear: 0, groupIndex: 0, clanIndex: 0, clanLevel: 0,
    minHp: 100, maxHp: 100, minMana: 0, maxMana: 0, symbol: 0, flags: 0, userType: 0, team: 0, flag: 0, npcNumber: 0, clanAlignment: 0 };
  await inject({ ...base, charIndex: 3001, x: px - 2, y: py - 2, name: 'Neutral <Clan>', clanIndex: 7, clanAlignment: 0 });
  await inject({ ...base, charIndex: 3002, x: px, y: py - 2, name: 'Ciudadano <Clan>', clanIndex: 8, clanAlignment: 3 });
  await inject({ ...base, charIndex: 3003, x: px + 2, y: py - 2, name: 'Criminal <Clan>', clanIndex: 9, clanAlignment: 4, status: 0 });
  await inject({ ...base, charIndex: 3004, x: px - 2, y: py + 2, name: 'Equipo', team: 3, flag: 1 });
  await inject({ ...base, charIndex: 3005, x: px + 2, y: py + 2, name: 'Equipo2', team: 5, flag: 2 });
  await inject({ ...base, charIndex: 3006, x: px, y: py + 2, name: 'Sin tag' });
  await page.waitForTimeout(800); await shot('inject-before');
  await inject({ id: 101, charIndex: 3006, status: 2, tag: 'Con tag <Nuevo>', groupIndex: 0, clanIndex: 11, clanAlignment: 1 });
  await inject({ id: 181, charIndex: 3001, flag: 1 }); // flag without a team: not drawn
  await inject({ id: 181, charIndex: 3006, flag: 2 });
  await inject({ id: 194, charIndex: 3002, valueType: 1, value: 1 });
  await inject({ id: 45, charIndex: 3002, x: px + 4, y: py - 2, time: 3000 });
  await page.waitForTimeout(1200); await shot('inject-translate-mid');
  await page.waitForTimeout(2500); await shot('inject-after');
}
console.log(JSON.stringify({ mode, problems }));
await browser.close();
