// AGPL-3.0-or-later. Drives the classic client in headless Chrome against the REAL VB6 server for the trade screenshots:
// the browser logs in with AO_EMAIL / AO_PASSWORD, a raw session (AO_OTHER_EMAIL / AO_OTHER_PASSWORD) and starts the trade.
// Usage: AO_WEB_PORT=5743 node tools/bank-trade-shot.mjs     (own bridge: AO_BRIDGE_PORT=7743 AO_TCP_PORT=7667 AO_ASSETS=... node tools/dev-web.mjs)
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { Vb6Session, gotoTile, sleep, BC, DC } from './real-server/bank-trade-session.mjs';
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5743}/`;
const other = new Vb6Session({ email: need('AO_OTHER_EMAIL'), password: need('AO_OTHER_PASSWORD') });
await other.login();
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = [];
page.on('pageerror', e => problems.push(e.message)); page.on('response', r => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); }); page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('requestfailed', r => problems.push(`failed ${r.url()}`));
await page.goto(base);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
await page.waitForTimeout(3000);
mkdirSync('artifacts/screenshots', { recursive: true });
const shot = name => page.screenshot({ path: `artifacts/screenshots/bank-trade-${name}.png` });
const log = async label => console.log(label, JSON.stringify((await page.locator('#messages').innerText()).split('\n').slice(-4)));
// The responder must be within 3 tiles: Tbank walks next to the browser character.
const [px, py] = (await page.locator('#position').innerText()).split(', ').map(Number);
await gotoTile(other, [px + 1, py], { maxSteps: 300 }); await sleep(800);
other.send({ id: DC.LeftClick, x: px, y: py, counter: other.nextCounter('leftClick') }); await sleep(1800);   // target the browser character
other.send({ id: BC.CommerceStart }); await sleep(1500);
await shot('question');
console.log('question visible', await page.locator('#question').isVisible(), JSON.stringify(await page.locator('#question-text').innerText()));
await page.locator('#question-yes').click({ force: true }); await page.waitForTimeout(1500);
console.log('trade window', await page.locator('#trade').isVisible());
await page.locator('#trade [data-kind="inventory"][data-slot="3"]').click(); await page.waitForTimeout(300);
await page.locator('#trade-offer').click(); await page.waitForTimeout(800);
await log('after offer');
await page.locator('#trade-chat').click(); await page.locator('#trade-chat').fill('hola desde el navegador'); await page.locator('#trade-chat').press('Enter'); await page.waitForTimeout(800);
other.send({ id: BC.CommerceSendChatMessage, message: 'hola, soy Tbank' }); await page.waitForTimeout(1000);
await shot('trade-window');
console.log('log', JSON.stringify((await page.locator('#trade-log').innerText()).split('\n')));
console.log('gold labels', await page.locator('#trade-my-gold').innerText(), await page.locator('#trade-my-offer-gold').innerText());
await page.locator('#trade-reject').click(); await page.waitForTimeout(1200);
console.log('trade window after reject', await page.locator('#trade').isVisible());
await shot('after-reject');
console.log(JSON.stringify({ problems }));
other.close(); await browser.close(); setTimeout(() => process.exit(0), 300);
