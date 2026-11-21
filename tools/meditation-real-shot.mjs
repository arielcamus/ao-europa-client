// AGPL-3.0-or-later. Headless Chrome against the REAL VB6 server: starts meditating (F6 or /MEDITAR), logs the MeditateToggle / CreateFX
// the server sends, screenshots the aura, moves one step (the server stops meditating), screenshots again.
// Usage: AO_WEB_PORT=5805 AO_EMAIL=.. AO_PASSWORD=.. LABEL=lvl15 [MODE=key|cmd] node tools/meditation-real-shot.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { FrameDecoder, decodeServerPacket } from '../packages/protocol/dist/index.js';
const need = n => process.env[n] ?? (() => { throw new Error(`Set ${n}`); })();
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5805}/`, label = process.env.LABEL ?? 'run', mode = process.env.MODE ?? 'key';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = [], seen = []; const decoder = new FrameDecoder();
page.on('pageerror', e => problems.push(e.message));
await page.routeWebSocket(/\/bridge/, ws => {
  const server = ws.connectToServer();
  ws.onMessage(m => server.send(m)); ws.onClose(() => server.close());
  server.onMessage(m => { ws.send(m); const raw = typeof m === 'string' ? Buffer.from(m) : m; try { for (const body of decoder.push(new Uint8Array(raw))) seen.push(decodeServerPacket(body)); } catch (e) { problems.push(String(e)); } });
});
await page.goto(base);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
await page.waitForTimeout(3000); await page.mouse.click(248, 291); await page.waitForTimeout(800); await page.mouse.click(686, 729);
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 }); await page.waitForTimeout(2500);
mkdirSync('artifacts/screenshots', { recursive: true });
const shot = n => page.screenshot({ path: `artifacts/screenshots/meditation-fx-${label}-${n}.png` });
const dump = from => console.log(JSON.stringify(seen.slice(from).filter(p => [84, 8, 17].includes(p.id) || p.fx !== undefined || p.id === 84).map(p => p)));
await shot('0-before'); const a = seen.length;
if (mode === 'cmd') { await page.keyboard.press('Enter'); await page.keyboard.type('/MEDITAR'); await page.keyboard.press('Enter'); } else await page.keyboard.press('F6');
await page.waitForTimeout(2500); await shot('1-meditating');
console.log('after start:'); dump(a);
const b = seen.length; await page.keyboard.press('ArrowDown'); await page.waitForTimeout(1500); await shot('2-after-move');
console.log('after move:'); dump(b);
console.log(seen.length, JSON.stringify(seen.slice(-6)), JSON.stringify({ problems }));
await browser.close();
