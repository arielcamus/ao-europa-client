// AGPL-3.0-or-later. Headless Chrome against the REAL VB6 server (through tools/fx-inject-proxy.mjs): pet commands typed in the
// chat box, the J-key taming flow on a chicken, and the travel form (the server has no Transporter NPC on a non-battle server, so the
// ViajarForm is injected through the proxy control port; CompletarViaje is sent for real and the server ignores it without a target).
// Usage: AO_WEB_PORT=5769 AO_CONTROL=7792 AO_EMAIL=.. AO_PASSWORD=.. node tools/pets-travel-shot.mjs
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5769}/`, control = `http://127.0.0.1:${process.env.AO_CONTROL ?? 7792}`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = []; const sent = [];
page.on('pageerror', e => problems.push(e.message));
page.on('websocket', ws => ws.on('framesent', f => { const b = Buffer.from(f.payload); if (b.length >= 4) sent.push(b.readUInt16LE(2)); }));
await page.goto(base);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
await page.waitForTimeout(2500);
mkdirSync('artifacts/screenshots', { recursive: true });
const shot = name => page.screenshot({ path: `artifacts/screenshots/wp05-${name}.png` });
const say = async text => { await page.keyboard.press('Enter'); await page.keyboard.type(text); await page.keyboard.press('Enter'); await page.waitForTimeout(700); };
await shot('map37');
for (const command of ['/QUIETO', '/ACOMPAÑAR', '/ACOMPAÑARTODOS', '/LIBERAR', '/LIBERARTODOS']) await say(command);
await shot('pet-commands');
console.log('console tail', JSON.stringify((await page.locator('#messages').innerText()).split('\n').slice(-6)));
// Travel form via the proxy.
await fetch(`${control}/packet`, { method: 'POST', body: JSON.stringify({ id: 147, destinations: [{ city: 'Ciudad de Arghal', cost: 6500 }, { city: 'Monte Perdido', cost: 3000 }, { city: 'Guarida Abandonada', cost: 4500 }], interface: 0 }) });
await page.locator('#travel-window').waitFor({ timeout: 5000 });
await page.waitForTimeout(800); await shot('travel-form');
await page.locator('#travel-window .vb-row').nth(1).click();
await page.locator('#travel-window  button:has-text("Viajar")').click(); await page.waitForTimeout(800);
console.log('travel window closed after Viajar:', await page.locator('#travel-window').count() === 0);
console.log('sent client ids', [...new Set(sent)].join(','), JSON.stringify({ problems }));
await browser.close();
