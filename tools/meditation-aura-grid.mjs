// AGPL-3.0-or-later. Real VB6 server through tools/fx-inject-proxy.mjs: a living character, MeditateToggle injected for the six auras
// (sent ids 153/155/159/165/171 -> classic FX 115-119, and 120 as sent), crop of each, then a labelled 3x2 grid.
// Usage: AO_WEB_PORT=5805 AO_CONTROL=7822 AO_EMAIL=.. AO_PASSWORD=.. OUT=/abs/grid.png node tools/meditation-aura-grid.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const need = n => process.env[n] ?? (() => { throw new Error(`Set ${n}`); })();
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5805}/`, control = `http://127.0.0.1:${process.env.AO_CONTROL ?? 7822}`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
await page.goto(base);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
await page.waitForTimeout(3000); await page.mouse.click(248, 291); await page.waitForTimeout(800); await page.mouse.click(686, 729);
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 }); await page.waitForTimeout(2500);
const inject = body => fetch(`${control}/packet`, { method: 'POST', body: JSON.stringify(body) });
const toggle = fx => inject({ id: 84, charIndex: 'self', fx, x: 0, y: 0 });
mkdirSync('artifacts/screenshots', { recursive: true });
const clip = { x: 278, y: 330, width: 200, height: 170 }, cells = [];
for (const [sent, art] of [[153, 115], [155, 116], [159, 117], [165, 118], [171, 119], [120, 120]]) {
  await toggle(sent); await page.waitForTimeout(1200);
  const buf = await page.screenshot({ clip }); await toggle(0); await page.waitForTimeout(300);
  writeFileSync(`artifacts/screenshots/meditation-fx2-${art}.png`, buf); cells.push({ art, sent, data: buf.toString('base64') });
}
const html = `<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(3,400px);gap:6px;font:16px sans-serif;color:#fff">${cells.map(c => `<div><div style="padding:4px">FX ${c.art} (server sends ${c.sent})</div><img width=400 src="data:image/png;base64,${c.data}"></div>`).join('')}</body>`;
const grid = await browser.newPage({ viewport: { width: 1218, height: 760 } }); await grid.setContent(html); await grid.screenshot({ path: need('OUT') });
await browser.close();
