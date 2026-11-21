// AGPL-3.0-or-later. Drives the connect flow of the classic client in headless Chrome for the core-session screenshots.
// Usage: AO_WEB_PORT=5775 AO_EMAIL=.. AO_PASSWORD=.. node tools/core-session-shot.mjs login|account|play|create
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const step = process.argv[2] ?? 'account';
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5775}/`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = [];
page.on('pageerror', e => problems.push(e.message)); page.on("response", r => { if (r.status() >= 400) problems.push(r.status() + " " + r.url()); });
mkdirSync('artifacts/screenshots', { recursive: true });
const shot = name => page.screenshot({ path: `artifacts/screenshots/core-session-${name}.png` });
await page.goto(base); await page.waitForTimeout(2500);
if (step === 'login') await shot('login');
else {
  await page.locator('#email').fill(process.env.AO_EMAIL); await page.locator('#password').fill(process.env.AO_PASSWORD);
  await page.locator('#connect').click();
  await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(2500);
  await shot('account');
  if (step === 'create') { await page.mouse.click(330, 728); await page.waitForTimeout(2500); await shot('create'); }
  if (step === 'play') { await page.mouse.dblclick(247, 291); await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60000 }); await page.waitForTimeout(2000); await shot('play'); }
}
console.log(JSON.stringify({ problems }));
await browser.close();
