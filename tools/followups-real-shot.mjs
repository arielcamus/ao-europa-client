// AGPL-3.0-or-later. Headless Chrome against the REAL VB6 server through tools/dev-web.mjs (follow-ups #16, #84):
// one character store (walk, turn, talk: the own character, its overhead bubble and its console line all come from the tracker),
// then frmMapaGrande (dungeon world + references, a search that keeps Label1). Screenshots artifacts/screenshots/followups-*.png.
// Usage: AO_WEB_PORT=5814 AO_EMAIL=.. AO_PASSWORD=.. node tools/followups-real-shot.mjs   (dev-web.mjs running with AO_BRIDGE_PORT=7814 AO_TCP_PORT=7667)
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5814}/`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = [], warnings = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text()); });
await page.goto(base);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30_000 }); await page.waitForTimeout(2000);
await page.mouse.dblclick(247, 291);
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
await page.waitForTimeout(2500);
mkdirSync('artifacts/screenshots', { recursive: true });
const shot = name => page.screenshot({ path: `artifacts/screenshots/followups-${name}.png` });
const position = async () => (await page.locator('#position').textContent())?.trim();
const start = await position();
await page.locator('#viewport').click({ position: { x: 5, y: 5 } }).catch(() => undefined); await page.keyboard.press('Escape').catch(() => undefined);
for (const key of ['ArrowDown', 'ArrowDown', 'ArrowRight']) { await page.keyboard.press(key); await page.waitForTimeout(450); }
await page.waitForTimeout(800);
const walked = await position();
await page.keyboard.press('Enter'); await page.locator('#chat').fill('prueba de seguimiento'); await page.keyboard.press('Enter');
await page.waitForTimeout(900); await shot('talk');
const consoleText = await page.locator('#console').innerText();
await page.locator('#minimap').click();
const win = page.locator('#world-map-window'); await win.waitFor({ timeout: 8000 }); await page.waitForTimeout(1500);
const description = await win.locator('.wm-info').textContent();
await shot('map');
await win.getByRole('button', { name: 'Mapa de mazmorras' }).click();
await win.getByRole('button', { name: 'Referencias del mapa' }).click(); await page.waitForTimeout(800);
const checks = { dungeon: await win.getByRole('button', { name: 'Mapa de mazmorras' }).getAttribute('data-checked'), references: await win.getByRole('button', { name: 'Referencias del mapa' }).getAttribute('data-checked') };
await shot('map-dungeon-references');
await win.locator('input').fill('1'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
const afterSearch = { title: await win.locator('.wm-title').textContent(), info: await win.locator('.wm-info').textContent() };
await shot('map-search');
console.log(JSON.stringify({ start, walked, saidInConsole: consoleText.includes('prueba de seguimiento'), consoleTail: consoleText.split('\n').slice(-3), description, checks, afterSearch, labelKept: afterSearch.info === description, problems, warnings: warnings.slice(0, 5) }, null, 1));
await browser.close();
