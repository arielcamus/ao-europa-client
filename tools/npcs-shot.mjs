// AGPL-3.0-or-later. Drives the classic client in headless Chrome for the npcs screenshots.
// Usage: AO_WEB_PORT=5715 AO_EMAIL=.. AO_PASSWORD=.. node tools/npcs-shot.mjs <name> [--hover] [--click-npc] [--click-player] [--wait ms]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const args = process.argv.slice(2), name = args[0] ?? 'npcs';
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
const flag = f => args.includes(f);
const wait = Number(args[args.indexOf('--wait') + 1] || 2500);
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5715}/`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = [];
page.on('pageerror', e => problems.push(e.message)); page.on('console', m => { if (m.type() === 'error' || m.text().includes('DBG')) problems.push(m.text()); });
await page.goto(base);
await page.locator('#email').fill(need('AO_EMAIL'));
await page.locator('#password').fill(need('AO_PASSWORD'));
await page.locator('#connect').click();
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
await page.waitForTimeout(wait);
const rect = (await page.locator('#viewport').boundingBox());
// Tile (tx,ty) -> screen px: the camera centres on the character's tile (position text "x, y").
const [px, py] = (await page.locator('#position').innerText()).split(', ').map(Number);
const at = (tx, ty) => ({ x: rect.x + rect.width / 2 + (tx - px) * 32, y: rect.y + rect.height / 2 + (ty - py) * 32 });
const ts = (args.find(a => a.startsWith('--tile=')) ?? '').slice(7).split(',').map(Number);
if (ts.length === 2) { const p = at(ts[0], ts[1]); await page.mouse.move(p.x, p.y); if (flag('--click')) await page.mouse.down().then(() => page.mouse.up()); }
await page.waitForTimeout(1800);
mkdirSync('artifacts/screenshots', { recursive: true });
await page.screenshot({ path: `artifacts/screenshots/feat-npcs-${name}.png` });
console.log(JSON.stringify({ position: `${px}, ${py}`, console: (await page.locator('#messages').innerText()).split('\n').slice(-12), problems }));
await browser.close();
