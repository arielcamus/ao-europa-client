// AGPL-3.0-or-later. Drives the classic client in headless Chrome for the crafting screenshots.
// Real server: AO_WEB_PORT=5749 AO_EMAIL=.. AO_PASSWORD=.. node tools/crafting-shot.mjs real-anvil --tile=34,65   (walks next to the anvil first)
// Mock server (tools/crafting-mock-server.mjs): ... node tools/crafting-shot.mjs smith --click-at=30,40   (window packets, see the mock)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const args = process.argv.slice(2), name = args[0] ?? 'crafting';
const need = key => process.env[key] ?? (() => { throw new Error(`Set ${key}`); })();
const opt = key => (args.find(a => a.startsWith(`--${key}=`)) ?? '').slice(key.length + 3);
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5749}/`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = [];
page.on('pageerror', e => problems.push(e.message)); page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
await page.goto(base);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD'));
await page.locator('#connect').click();
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
await page.waitForTimeout(2500);
const rect = await page.locator('#viewport').boundingBox();
const position = async () => (await page.locator('#position').innerText()).split(', ').map(Number);
const at = async (tx, ty) => { const [px, py] = await position(); return { x: rect.x + rect.width / 2 + (tx - px) * 32, y: rect.y + rect.height / 2 + (ty - py) * 32 }; };
const tile = opt('tile').split(',').map(Number);
if (tile.length === 2) { const p = await at(tile[0], tile[1]); await page.mouse.click(p.x, p.y); }
await page.waitForTimeout(Number(opt('wait') || 2500));
const open = opt('select');
if (open) { // select a list row and a smith tab, like the player would
  const [tab, row] = open.split(',');
  if (tab !== 'none') await page.locator(`#smith-tab-${tab}`).click().catch(() => {});
  await page.locator(`#${opt('window') || 'smith'}-objects .craft-row`).nth(Number(row || 0)).click().catch(() => {});
  await page.waitForTimeout(800);
}
mkdirSync('artifacts/screenshots', { recursive: true });
await page.screenshot({ path: `artifacts/screenshots/crafting-${name}.png` });
console.log(JSON.stringify({ position: (await position()).join(', '), console: (await page.locator('#messages').innerText()).split('\n').slice(-8), problems }));
await browser.close();
