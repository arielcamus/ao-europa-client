// AGPL-3.0-or-later. Headless Chrome against the REAL VB6 server (wp04): item info label, right-drag item moving, delete button,
// key ring (needs rows in house_key for the account) and the papyrus form (a Cartelera at map 1 43,52).
// Usage: AO_WEB_PORT=5773 AO_EMAIL=.. AO_PASSWORD=.. node tools/items-2-real-shot.mjs
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5773}/`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = [], sent = [], received = [];
page.on('pageerror', e => problems.push(e.message));
page.on('websocket', ws => ws.on('framereceived', f => { const b = Buffer.from(f.payload); if (b.length >= 4) received.push(b.readUInt16LE(2)); }));
page.on('websocket', ws => ws.on('framesent', f => { const b = Buffer.from(f.payload); if (b.length >= 4) sent.push({ id: b.readUInt16LE(2), hex: b.subarray(2).toString('hex') }); }));
await page.goto(base);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
await page.waitForTimeout(3000);
mkdirSync('artifacts/screenshots', { recursive: true });
const shot = name => page.screenshot({ path: `artifacts/screenshots/items-2-${name}.png` });
const out = [];
const log = (name, value) => { out.push(name); console.log(name, JSON.stringify(value)); };
const slot = n => page.locator(`#inventory .inventory-slot:nth-child(${n})`);
const since = from => sent.slice(from).map(p => `${p.id}:${p.hex}`);

log('server ids 159/105 received at login', received.filter(id => id === 159 || id === 105));
// 1. Item info label (ObjLbl).
await slot(8).hover(); await page.waitForTimeout(300);
log('label sword', await page.locator('#obj-label').innerText()); await shot('item-label-weapon');
await slot(15).hover(); log('label armour', await page.locator('#obj-label').innerText());
await slot(4).hover(); log('label other', await page.locator('#obj-label').innerText());
await slot(20).hover(); log('label empty hidden', await page.locator('#obj-label').isHidden());

// 2. Right-drag: slot 3 onto the empty slot 17 (WriteItemMove), then back.
let mark = sent.length;
const drag = async (from, to) => {
  const a = await slot(from).boundingBox(), b = await slot(to).boundingBox();
  await page.mouse.move(a.x + 16, a.y + 16); await page.mouse.down({ button: 'right' }); await page.mouse.move(b.x + 16, b.y + 16, { steps: 6 });
  await shot(`dragging-${from}-${to}`); await page.mouse.up({ button: 'right' }); await page.waitForTimeout(800);
};
await drag(3, 17);
log('moveitem 3 -> 17 sent', since(mark));
log('slot 17 now has', await slot(17).getAttribute('aria-label')); log('slot 3 now', await slot(3).getAttribute('aria-label'));
mark = sent.length; await drag(17, 3); log('moveitem back sent', since(mark));
mark = sent.length; await drag(2, 3); log('moveitem 2 -> 3 (different objects: swap) sent', since(mark));
mark = sent.length; await drag(3, 2); await shot('moved-back');

// 3. Delete button: nothing selected, then the item in slot 16 (20 apples).
mark = sent.length; await slot(20).click(); await page.locator('#delete-item').click(); await page.waitForTimeout(300);
log('delete, nothing selected', (await page.locator('#messages').innerText()).split('\n').slice(-1)); log('delete sent (none expected)', since(mark));
await slot(16).click(); await page.locator('#delete-item').click(); await page.waitForTimeout(300); await shot('delete-confirm');
await page.locator('#delete-confirm button:has-text("No")').click(); log('delete refused sent (none expected)', since(mark));
await page.locator('#delete-item').click(); await page.locator('#delete-confirm button:has-text("Sí")').click(); await page.waitForTimeout(1000);
log('delete accepted sent', since(mark)); log('console tail', (await page.locator('#messages').innerText()).split('\n').slice(-2));
log('slot 16 after delete', await slot(16).getAttribute('aria-label'));

// 4. Key ring.
await page.locator('#menu-tab').click(); await page.waitForTimeout(200);
await page.locator('#menu-actions button[aria-label="Llavero"]').click(); await page.waitForTimeout(800);
await shot('keyring');
log('keyring slots', await page.locator('#keyring-window .keyring-slot').evaluateAll(n => n.map(b => b.getAttribute('aria-label')).slice(0, 4)));
await page.locator('#keyring-window .keyring-slot').first().hover(); log('keyring name label', await page.locator('#keyring-window .keyring-name').innerText());
await shot('keyring-hover');
mark = sent.length; await page.locator('#keyring-window .keyring-slot').first().dblclick(); await page.waitForTimeout(800);
log('UseKey sent', since(mark)); log('console after UseKey', (await page.locator('#messages').innerText()).split('\n').slice(-2));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
log('keyring closed by Escape', await page.locator('#keyring-window').count() === 0);

// 5. Papyrus: LeftClick the Cartelera at 43,52 (one tile north of the character at 43,53).
const rect = await page.locator('#viewport').boundingBox();
const [px, py] = (await page.locator('#position').innerText()).split(', ').map(Number);
log('standing at', [px, py]);
mark = sent.length; await page.mouse.click(rect.x + rect.width / 2 + (43 - px) * 32, rect.y + rect.height / 2 + (52 - py) * 32); await page.waitForTimeout(1500);
log('console after click', (await page.locator('#messages').innerText()).split('\n').slice(-3)); log('papiro visible', await page.locator('#papiro-window').isVisible()); log('click sent', since(mark)); await shot('papiro');
await page.locator('#papiro-close').click().catch(async () => { await page.locator('#papiro-window .papiro-close').click(); }); await page.waitForTimeout(300);
log('papiro closed', await page.locator('#papiro-window').count() === 0);
console.log(JSON.stringify({ problems }));
await browser.close();
