// AGPL-3.0-or-later. Creates ONE account and ONE character through the classic client UI (server cap: 15 new characters per IP per run).
// Usage: AO_WEB_PORT=5775 AO_EMAIL=new@local.test AO_PASSWORD=.. AO_CHAR=Name node tools/core-session-create.mjs
import { chromium } from '@playwright/test';
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5775}/`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = []; page.on('pageerror', e => problems.push(e.message));
const shot = n => page.screenshot({ path: `artifacts/screenshots/core-session-${n}.png` });
await page.goto(base); await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Crear cuenta' }).click();
const win = page.locator('#new-account-window');
await win.waitFor(); await shot('new-account');
const [, , email, pass, captcha] = await win.locator('input').all();
const sum = (await win.locator('.vb-label').first().innerText()).split('+').map(Number).reduce((a, b) => a + b);
await email.fill(process.env.AO_EMAIL); await pass.fill(process.env.AO_PASSWORD); await captcha.fill(String(sum));
await win.getByRole('button', { name: 'Crear cuenta' }).click();
await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(1500); await shot('account-empty');
await page.mouse.click(330, 728); await page.waitForTimeout(2000);
await page.locator('.cs-name').fill(process.env.AO_CHAR);
await page.getByRole('button', { name: 'Raza siguiente' }).click(); await page.getByRole('button', { name: 'Genero siguiente' }).click();
await page.waitForTimeout(500); await shot('create-filled');
await page.locator('.cs-create').getByRole('button', { name: 'Crear personaje' }).click();
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60000 }); await page.waitForTimeout(2500); await shot('created-in-game');
console.log(JSON.stringify({ problems, name: await page.locator('#character-name').innerText() }));
await browser.close();
