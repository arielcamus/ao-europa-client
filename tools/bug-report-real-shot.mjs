// AGPL-3.0-or-later. Live check of the in-game bug reporter (docs/BUG-REPORTS.md) against the REAL VB6 server through tools/dev-web.mjs:
// log in, walk a few steps, F8, fill the form, Enviar, then read the stored report back from AO_BUG_REPORT_DIR (the same dir the server uses).
// Screenshots artifacts/screenshots/bug-report-live-*.png. Usage: AO_WEB_PORT=5841 AO_EMAIL=.. AO_PASSWORD=.. AO_BUG_REPORT_DIR=.. node tools/bug-report-real-shot.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5841}/`;
const email = need('AO_EMAIL'), password = need('AO_PASSWORD');
const dir = need('AO_BUG_REPORT_DIR');
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = []; page.on('pageerror', e => problems.push(e.message));
await page.goto(base);
await page.locator('#email').fill(email); await page.locator('#password').fill(password); await page.locator('#connect').click();
await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30_000 }); await page.waitForTimeout(2500);

await page.screenshot({ path: 'artifacts/screenshots/bug-report-live-account.png' });
await page.mouse.click(247, 291); await page.waitForTimeout(500); await page.mouse.click(685, 729); // select the first slot, then JUGAR
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 }).catch(async error => { await page.screenshot({ path: 'artifacts/screenshots/bug-report-live-stuck.png' }); console.log(await page.locator('#messages').innerText().catch(() => ''), problems); throw error; });
await page.waitForTimeout(2500);
// Walk a few steps so the protocol trace has walks and position replies.
for (const key of ['KeyD', 'KeyD', 'KeyS']) { await page.keyboard.down(key); await page.waitForTimeout(350); await page.keyboard.up(key); await page.waitForTimeout(250); }
await page.screenshot({ path: 'artifacts/screenshots/bug-report-live-ingame.png' });
await page.keyboard.press('F8');
await page.locator('#bug-report-window').waitFor();
await page.locator('#bug-report-text').fill('Prueba en vivo del reporte de bugs \nEl personaje camina y abro el reporte con F8.');
await page.screenshot({ path: 'artifacts/screenshots/bug-report-live-window.png' });
await page.locator('#bug-report-send').click();
await page.locator('#bug-report-status').filter({ hasText: 'Gracias' }).waitFor({ timeout: 15_000 });
const status = await page.locator('#bug-report-status').innerText();
await page.screenshot({ path: 'artifacts/screenshots/bug-report-live-sent.png' });
const id = /Reporte (\S+) enviado/.exec(status)[1];
const raw = readFileSync(join(dir, `${id}.json`), 'utf8'); const report = JSON.parse(raw);
console.log(JSON.stringify({
  id, problems, leaks: { email: raw.includes(email), password: raw.includes(password) },
  character: report.character, client: report.client, screenshot: report.screenshotInfo, stats: report.stats,
  protocolCount: report.protocol.length, protocolNames: [...new Set(report.protocol.map(e => `${e.dir}:${e.name}`))].slice(0, 40),
  chatTail: report.chat.slice(-4), consoleCount: report.console.length, errors: report.errors,
}, null, 1));
await browser.close();
