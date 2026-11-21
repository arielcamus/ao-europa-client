// AGPL-3.0-or-later. Headless Chrome against the REAL VB6 server: spawn a chicken (GM /ACC 501), press every arrow key and log the client's outgoing packet ids.
// Usage: AO_WEB_PORT=7792 AO_EMAIL=... AO_PASSWORD=... node tools/walk-into-creature-shot.mjs   (a step into the chicken must send ChangeHeading 6, never Walk 78)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const need = n => process.env[n] ?? (() => { throw new Error(`Set ${n}`); })();
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const sent = [];
page.on('websocket', ws => ws.on('framesent', f => { const b = Buffer.from(f.payload); if (b.length >= 4) sent.push({ id: b.readInt16LE(2), body: b.subarray(4).toString('hex') }); }));
await page.goto(`http://127.0.0.1:${process.env.AO_WEB_PORT ?? 7792}/`);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click(); await page.locator('.cs-slot-hit[data-slot="1"]').dblclick();
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
await page.waitForTimeout(2500);
mkdirSync('artifacts/screenshots', { recursive: true });
const pos = async () => (await page.locator('#position').innerText()).trim();
await page.keyboard.press('Enter'); await page.locator('#chat').fill('/ACC 501'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
await page.screenshot({ path: 'artifacts/screenshots/walk-into-char-spawn.png' });
for (const [name, key] of [['north', 'ArrowUp'], ['east', 'ArrowRight'], ['south', 'ArrowDown'], ['west', 'ArrowLeft']]) {
  for (let i = 0; i < 2; i++) {
    const at = sent.length, before = await pos();
    await page.keyboard.press(key); await page.waitForTimeout(700);
    console.log(name, before, '->', await pos(), 'sent ids', JSON.stringify(sent.slice(at).map(s => s.id)));
  }
}
await page.screenshot({ path: 'artifacts/screenshots/walk-into-char-after.png' });
await browser.close();
