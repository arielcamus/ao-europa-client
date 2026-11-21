// AGPL-3.0-or-later. Headless Chrome through tools/status-inject-proxy.mjs (web 5767 -> bridge -> proxy 7767/7768 -> VB6 server):
// the states the real server only sends when another player casts at you. Screenshots in artifacts/screenshots.
// Usage: AO_EMAIL=... AO_PASSWORD=... node tools/combat2-inject-shot.mjs   (WEB_PORT 5767, CONTROL 7768 by default)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5767}/`, control = `http://127.0.0.1:${process.env.AO_CONTROL_PORT ?? 7768}/packet`;
const inject = packet => fetch(control, { method: 'POST', body: JSON.stringify(packet) });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = []; page.on('pageerror', e => problems.push(e.message));
await page.goto(base);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
await page.waitForTimeout(2500);
mkdirSync('artifacts/screenshots', { recursive: true });
const shot = name => page.screenshot({ path: `artifacts/screenshots/combat-spells-2-${name}.png` });
const pos = async () => (await page.locator('#position').innerText());
await shot('inject-normal');
await inject({ id: 74 }); await page.waitForTimeout(1500); await shot('inject-blind');
await inject({ id: 85 }); await page.waitForTimeout(1500); await shot('inject-blind-over');
await inject({ id: 83, charIndex: 'self', invisible: true, x: 0, y: 0 }); await page.waitForTimeout(800); await shot('inject-invisible');
await inject({ id: 83, charIndex: 'self', invisible: false, x: 0, y: 0 });
const before = await pos();
await inject({ id: 97 }); await page.waitForTimeout(300); // ParalizeOK
await page.keyboard.down('ArrowRight'); await page.waitForTimeout(700); await page.keyboard.up('ArrowRight');
console.log('paralysed: position', before, '->', await pos());
await inject({ id: 97 }); await page.waitForTimeout(300); // toggle off
await page.keyboard.down('ArrowRight'); await page.waitForTimeout(700); await page.keyboard.up('ArrowRight');
console.log('free again: position ->', await pos());
const stunAt = await pos();
await inject({ id: 98, duration: 2500 });
await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(1000); await page.keyboard.up('ArrowLeft');
console.log('stunned 2.5 s: position', stunAt, '->', await pos());
await page.waitForTimeout(2000);
await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(700); await page.keyboard.up('ArrowLeft');
console.log('after the stun: position ->', await pos());
await inject({ id: 140, charIndex: 'self', barTime: 6, action: 2 }); await page.waitForTimeout(2500); await shot('inject-bar');
console.log(JSON.stringify({ problems }));
await browser.close();
