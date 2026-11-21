// AGPL-3.0-or-later. Headless Chrome against the REAL VB6 server through tools/fx-inject-proxy.mjs: the server does not make the test
// character a GM until it is restarted (see the PR body), so the GM-only packets (Privilegios, ShowGMPanelForm, UserNameList, SpawnListt,
// ShowMOTDEditionForm, ShowSOSForm) are injected and the GM forms and commands are exercised for real in the client.
// Usage: AO_WEB_PORT=5776 AO_CONTROL=7782 AO_EMAIL=.. AO_PASSWORD=.. node tools/gm-shot.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5776}/`, control = `http://127.0.0.1:${process.env.AO_CONTROL ?? 7782}`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = [], sent = [];
page.on('pageerror', e => problems.push(e.message));
page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'prueba' : undefined));
page.on('websocket', ws => ws.on('framesent', f => { const b = Buffer.from(f.payload); if (b.length >= 4) sent.push(b.readUInt16LE(2)); }));
await page.goto(base);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
await page.waitForTimeout(2000);
mkdirSync('artifacts/screenshots', { recursive: true });
const shot = name => page.screenshot({ path: `artifacts/screenshots/wp12-${name}.png` });
const inject = body => fetch(`${control}/packet`, { method: 'POST', body: JSON.stringify(body) });
const say = async text => { await page.keyboard.press('Enter'); await page.keyboard.type(text); await page.keyboard.press('Enter'); await page.waitForTimeout(500); };
const clientIds = () => [...new Set(sent)].join(',');
await say('/IRA Nadie'); console.log('before Privilegios, /IRA sends nothing:', !sent.includes(114));
await inject({ id: 177, isGM: true }); await inject({ id: 112, count: 7 }); await page.waitForTimeout(600);
await shot('gm-bar');
await say('/TELEP Aotest 1 60 50'); await say('/REVIVIR Aotest'); await say('/CI 38 5'); await say('/ACC 501'); await say('/INVISIBLE');
console.log('GM commands sent ids:', clientIds());
// Panel: PanelGM button sends SOSShowList + GMPanel; the server answer is injected.
await page.locator('#gm-panel-button').click(); await page.waitForTimeout(500);
await inject({ id: 108, list: 'AnaØMe quede trabadoØConsulta regularØ21/11/2026 08:30' }); await inject({ id: 111, list: 'Ana\0Beto\0Aotest' });
await inject({ id: 110, head: 1, body: 1, casco: 0, arma: 0, escudo: 0 }); await page.locator('#gm-panel').waitFor({ timeout: 5000 }); await page.waitForTimeout(600);
await shot('panel');
await page.locator('#gm-panel button:has-text("Mapeo")').click(); await page.waitForTimeout(300); await shot('panel-wide');
await page.locator('#gm-panel button:has-text("/Revivir")').click(); await page.keyboard.press('Escape');
// Spawn list
await page.locator('#gm-spawn-button').click(); await inject({ id: 107, listaCompleta: true });
await page.locator('#gm-spawn-list').waitFor({ timeout: 5000 }); await page.waitForTimeout(1200); await shot('spawn-list');
await page.locator('#gm-spawn-list .vb-row').first().click(); await page.locator('#gm-spawn-list button:has-text("Spawn")').click();
await page.keyboard.press('Escape');
// Create object
await page.locator('#gm-object-button').click(); await page.locator('#gm-objects').waitFor({ timeout: 5000 }); await page.waitForTimeout(1200); await shot('create-object');
await page.locator('#gm-objects input').first().fill('manzana'); await page.waitForTimeout(300); await page.locator('#gm-objects .vb-row').first().click(); await page.locator('#gm-objects button:has-text("Crear")').click();
await page.keyboard.press('Escape');
// MOTD edit and /GM help
await inject({ id: 109, motd: 'Bienvenidos~255~255~255~0~0' }); await page.locator('#gm-motd').waitFor({ timeout: 5000 }); await shot('motd');
await page.keyboard.press('Escape'); await say('/GM'); await page.locator('#gm-help').waitFor({ timeout: 5000 }); await shot('help');
await page.locator('#gm-help input[type=radio]').first().check(); await page.locator('#gm-help textarea').fill('Probando la consulta'); await page.locator('#gm-help button:has-text("Enviar")').click();
await page.waitForTimeout(800);
console.log('sent client ids', clientIds(), JSON.stringify({ problems }));
await browser.close();
