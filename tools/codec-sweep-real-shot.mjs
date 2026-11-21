// AGPL-3.0-or-later. Headless Chrome against the REAL pinned VB6 server through tools/dev-web.mjs (Ariel's /EST disconnect, 21 Nov):
// log in, type /EST, check the session stays open and every stats line reaches the console; screenshot artifacts/screenshots/codec-sweep-est.png.
// Usage: AO_WEB_PORT=5822 AO_EMAIL=.. AO_PASSWORD=.. node tools/codec-sweep-real-shot.mjs   (dev-web.mjs running with AO_BRIDGE_PORT=7822 AO_TCP_PORT=7667)
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5822}/`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
try {
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
  await page.keyboard.press('Enter'); await page.locator('#chat').fill('/EST'); await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  mkdirSync('artifacts/screenshots', { recursive: true });
  await page.screenshot({ path: 'artifacts/screenshots/codec-sweep-est.png' });
  const consoleText = await page.locator('#console').innerText();
  const stillPlaying = await page.locator('#viewport[data-rendered="true"]').count();
  console.log(JSON.stringify({ stillPlaying, consoleTail: consoleText.split('\n').slice(-16), problems, warnings: warnings.slice(-6) }, null, 1));
} finally { await browser.close(); }
