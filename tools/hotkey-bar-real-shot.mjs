// AGPL-3.0-or-later. Headless Chrome against the REAL VB6 server: bind a potion and a spell to the hotkey bar with real right-button drags,
// record the packets. Usage: AO_WEB_PORT=5868 AO_EMAIL=.. AO_PASSWORD=.. [AO_CHAR=Name to create the account+character first] node tools/hotkey-bar-real-shot.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const need = n => process.env[n] ?? (() => { throw new Error(`Set ${n}`); })();
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5868}/`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = [], sent = [], received = [];
page.on('pageerror', e => problems.push(e.message));
page.on('websocket', ws => { ws.on('framereceived', f => { const b = Buffer.from(f.payload); if (b.length >= 4) received.push({ id: b.readInt16LE(2), hex: b.subarray(2).toString('hex') }); }); ws.on('framesent', f => { const b = Buffer.from(f.payload); if (b.length >= 4) sent.push({ id: b.readInt16LE(2), hex: b.subarray(2).toString('hex') }); }); });
mkdirSync('artifacts/screenshots', { recursive: true });
const shot = n => page.screenshot({ path: `artifacts/screenshots/hotkey-bar-${n}.png` });
await page.goto(base); await page.waitForTimeout(2500);
if (process.env.AO_CHAR) {
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  const win = page.locator('#new-account-window'); await win.waitFor();
  const [, , email, pass, captcha] = await win.locator('input').all();
  const sum = (await win.locator('.vb-label').first().innerText()).split('+').map(Number).reduce((a, b) => a + b);
  await email.fill(need('AO_EMAIL')); await pass.fill(need('AO_PASSWORD')); await captcha.fill(String(sum));
  await win.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(1500);
  await page.mouse.click(330, 728); await page.waitForTimeout(2000);
  await page.locator('.cs-name').fill(process.env.AO_CHAR);
  await page.getByRole('button', { name: 'Raza siguiente' }).click(); await page.getByRole('button', { name: 'Genero siguiente' }).click();
  await page.locator('.cs-create').getByRole('button', { name: 'Crear personaje' }).click();
} else {
  await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
}
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 }); await page.waitForTimeout(3500);
const log = (n, v) => console.log(n, JSON.stringify(v));
log('char', await page.locator('#character-name').innerText());
log('toggle packet 195 received', received.filter(p => p.id === 195).map(p => p.hex));
log('hotkey bar visible', await page.locator('#hotkeys').isVisible());
log('inventory', await page.locator('#inventory .inventory-slot').evaluateAll(n => n.map((b, i) => `${i + 1}:${b.getAttribute('aria-label')}`).filter(s => !/vac|empty|^\d+:null/i.test(s)).slice(0, 12)));
log('ChangeInventorySlot (id 14?) bindable bytes', received.filter(p => p.id === 14 || p.id === 15).slice(0, 3).map(p => p.hex));
await shot('start');
const bar = page.locator('#hotkeys .hk-slot');
const dragTo = async (box, n) => { const t = await bar.nth(n).boundingBox(); await page.mouse.move(box.x + 16, box.y + 12); await page.mouse.down({ button: 'right' }); await page.mouse.move(t.x + 16, t.y + 16, { steps: 8 }); await shot(`dragging-${n}`); await page.mouse.up({ button: 'right' }); await page.waitForTimeout(600); };
let mark = sent.length;
// Potion: the first inventory slot with a potion-ish name, else slot 2.
const slots = await page.locator('#inventory .inventory-slot').evaluateAll(n => n.map(b => b.getAttribute('aria-label') ?? ''));
const potion = slots.findIndex(l => /poci|pocion|potion/i.test(l));
log('potion slot', potion + 1);
const item = page.locator(`#inventory .inventory-slot:nth-child(${(potion >= 0 ? potion : 1) + 1})`);
await dragTo(await item.boundingBox(), 0);
log('after item drag: SetHotkeySlot sent', sent.slice(mark).filter(p => p.id === 190 || true).map(p => `${p.id}:${p.hex}`));
mark = sent.length;
await page.getByRole('tab', { name: 'Hechizos', exact: true }).click(); await page.waitForTimeout(500);
log('spell rows', await page.locator('#spells .spell').allInnerTexts());
await dragTo(await page.locator('#spell-1').boundingBox(), 1);
log('after spell drag sent', sent.slice(mark).map(p => `${p.id}:${p.hex}`));
log('selection after drags', await page.evaluate(() => window.getSelection()?.toString()));
await shot('end');
console.log(JSON.stringify({ problems }));
await browser.close();
