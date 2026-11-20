// AGPL-3.0-or-later. Headless Chrome against tools/bank-trade-mock-server.mjs (NOT the VB6 oracle): the vault, Goliath and trade offers.
// Usage: AO_WEB_PORT=5749 node tools/bank-trade-mock-shot.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5749}/`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = [];
page.on('console', m => { if (m.text().startsWith('BT')) console.log(m.text()); }); page.on('pageerror', e => problems.push(e.message)); page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
await page.goto(base);
await page.locator('#email').fill('mock@local.test'); await page.locator('#password').fill('x'); await page.locator('#connect').click();
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
await page.waitForTimeout(2500);
mkdirSync('artifacts/screenshots', { recursive: true });
const shot = name => page.screenshot({ path: `artifacts/screenshots/bank-trade-${name}.png` });
const rect = await page.locator('#viewport').boundingBox();
const [px, py] = (await page.locator('#position').innerText()).split(', ').map(Number);
const at = (tx, ty) => ({ x: rect.x + rect.width / 2 + (tx - px) * 32, y: rect.y + rect.height / 2 + (ty - py) * 32 });
const sel = id => page.locator(id);
// 1. Goliath: click the banker.
const k = at(60, 42); await page.mouse.click(k.x, k.y); await page.waitForTimeout(800);
console.log('goliath', await sel('#goliath').isVisible(), await sel('#goliath-gold').innerText());
await shot('goliath');
await sel('#goliath-extract').click(); await sel('#goliath-amount').fill('1000'); await page.waitForTimeout(300); await shot('goliath-retirar');
await sel('#goliath-accept').click(); await page.waitForTimeout(600);
console.log('gold after extract', await sel('#goliath-gold').innerText(), 'wallet', await sel('#gold').innerText());
await sel('#goliath-deposit').click(); await sel('#goliath-deposit-all').click(); await page.waitForTimeout(600);
console.log('gold after deposit all', await sel('#goliath-gold').innerText(), 'wallet', await sel('#gold').innerText());
// 2. The vault.
await sel('#goliath-vault').click(); await page.waitForTimeout(1200);
console.log('vault', await sel('#bank').isVisible(), 'goliath still', await sel('#goliath').isVisible());
await sel('#bank [data-side="vault"][data-slot="1"]').click(); await page.waitForTimeout(300); await shot('vault');
console.log('selected', await sel('#bank-item-name').innerText(), '|', await sel('#bank-item-desc').innerText());
await sel('#bank-amount').fill('100'); await sel('#bank-extract').click(); await page.waitForTimeout(500);
await sel('#bank [data-side="user"][data-slot="3"]').dblclick(); await page.waitForTimeout(500);       // whole stack of 3791 into the vault
await sel('#bank [data-side="vault"][data-slot="2"]').dragTo(sel('#bank [data-side="vault"][data-slot="5"]')); await page.waitForTimeout(500);
await sel('#bank [data-side="user"][data-slot="4"]').click(); await sel('#bank-amount').fill('10'); await sel('#bank-deposit').click(); await page.waitForTimeout(600);
await shot('vault-after');
const text = async s => (await sel(s).getAttribute('aria-label'));
console.log('vault slots', await text('#bank [data-side="vault"][data-slot="1"]'), '|', await text('#bank [data-side="vault"][data-slot="5"]'), '|', await text('#bank [data-side="vault"][data-slot="10"]'), '|', await text('#bank [data-side="vault"][data-slot="11"]'));
console.log('inventory', await text('#bank [data-side="user"][data-slot="1"]'), '|', await text('#bank [data-side="user"][data-slot="3"]'), '|', await text('#bank [data-side="user"][data-slot="4"]'));
await sel('#bank-close').click(); await page.waitForTimeout(500);
console.log('vault closed', !(await sel('#bank').isVisible()));
// 3. Trade with offers. /RETIRAR 5000 (ProtocolCmdParse) puts gold in the wallet first.
await page.locator('#chat-open').click(); await page.locator('#chat').fill('/RETIRAR 5000'); await page.locator('#chat').press('Enter'); await page.waitForTimeout(800);
console.log('wallet after /RETIRAR 5000', await sel('#gold').innerText());
await page.locator('#chat-open').click(); await page.locator('#chat').fill('/COMERCIAR'); await page.locator('#chat').press('Enter'); await page.waitForTimeout(800);
console.log('question', await sel('#question').isVisible(), JSON.stringify(await sel('#question-text').innerText()));
await sel('#question-yes').click({ force: true }); await page.waitForTimeout(800);
await sel('#trade [data-kind="inventory"][data-slot="1"]').click(); await sel('#trade-amount').fill('25'); await sel('#trade-offer').click(); await page.waitForTimeout(400);
await sel('#trade [data-kind="inventory"][data-slot="3"]').click(); await sel('#trade-amount').fill('2'); await sel('#trade-offer').click(); await page.waitForTimeout(400);
await sel('#trade-gold').fill('1500'); await sel('#trade-offer-gold').click(); await page.waitForTimeout(400);
await sel('#trade-chat').click(); await sel('#trade-chat').fill('¿Cambiamos?'); await sel('#trade-chat').press('Enter'); await page.waitForTimeout(500);
await sel('#trade [data-kind="mine"][data-slot="1"]').click(); await sel('#trade [data-kind="other"][data-slot="2"]').click(); await page.waitForTimeout(300);
await shot('trade-offers');
console.log('gold', await sel('#trade-my-gold').innerText(), await sel('#trade-my-offer-gold').innerText(), await sel('#trade-other-gold').innerText(), 'names', await sel('#trade-my-offer-name').innerText(), await sel('#trade-other-offer-name').innerText());
await sel('#trade-accept').click(); await page.waitForTimeout(400); await sel('#trade-accept').click(); await page.waitForTimeout(800);
console.log('trade closed after both accepted', !(await sel('#trade').isVisible()));
// Esc and the world click close the vault.
await page.mouse.click(k.x, k.y); await page.waitForTimeout(500); await sel('#goliath-vault').click(); await page.waitForTimeout(800);
await page.keyboard.press('Escape'); await page.waitForTimeout(400); console.log('vault closed by Escape', !(await sel('#bank').isVisible()));
console.log(JSON.stringify({ problems }));
await browser.close();
