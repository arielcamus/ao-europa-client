// AGPL-3.0-or-later. Headless Chrome against the REAL VB6 server: duel form, GM tournament form, right-click menus.
// Usage: AO_WEB_PORT=5786 AO_EMAIL=aotest@local.test AO_PASSWORD=... node tools/extras-shot.mjs
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5786}/`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = []; const sent = [];
page.on('pageerror', e => problems.push(e.message));
page.on('websocket', ws => ws.on('framesent', f => { const b = Buffer.from(f.payload); if (b.length >= 4) sent.push(b.readUInt16LE(2)); }));
await page.goto(base);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30_000 }); await page.waitForTimeout(2500);
await page.mouse.dblclick(247, 291); // the first character card of the account screen (core-session-shot.mjs)
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
await page.waitForTimeout(2500);
mkdirSync('artifacts/screenshots', { recursive: true });
const shot = name => page.screenshot({ path: `artifacts/screenshots/coverage-tail-${name}.png` });
const say = async text => { await page.locator('#viewport canvas[tabindex]').focus(); await page.keyboard.press('Enter'); await page.locator('#chat').fill(text); await page.keyboard.press('Enter'); await page.waitForTimeout(700); };
await say('/RETAR Ana@Beto'); await shot('duel');
console.log('duel form', await page.locator('#duel-window').isVisible(), await page.locator('#duel-player-0').inputValue());
await page.keyboard.press('Escape');
await say('/EVENTO'); await say('/APOSTAR 1'); await say('/CREAREVENTO FOO');
console.log('console tail', JSON.stringify((await page.locator('#messages').innerText()).split('\n').slice(-4)));
await shot('console');
await page.locator('#gm-panel-button').click(); await page.waitForTimeout(1500);
await page.locator('#gm-tournament-button').click(); await page.waitForTimeout(500); await shot('tournament');
console.log('tournament form', await page.locator('#tournament-window').isVisible());
// Right click on a character: the menu depends on what stands in the middle of the view (the client sends LeftClick first).
const view = await page.locator('#viewport').boundingBox();
await page.mouse.click(view.x + 368 + 64, view.y + 304, { button: 'right' }); await page.waitForTimeout(600); await shot('rightclick');
console.log('menu items', await page.locator('#interaction-menu [role=menuitem]').allInnerTexts());
console.log('sent client ids', [...new Set(sent)].join(','), JSON.stringify({ problems }));
await browser.close();
