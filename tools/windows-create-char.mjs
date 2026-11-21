// AGPL-3.0-or-later. Creates ONE character through the classic client UI on an existing, empty test account (server cap: 15 new characters per IP per run).
// Usage: AO_WEB_PORT=5782 AO_EMAIL=windows@local.test AO_PASSWORD=.. AO_CHAR=Name node tools/windows-create-char.mjs
import { open } from './windows-drive.mjs';
const h = await open({ email: process.env.AO_EMAIL, password: process.env.AO_PASSWORD });
const { page } = h;
await page.waitForTimeout(1500);
await page.mouse.click(330, 728); await page.waitForTimeout(2000);
await page.locator('.cs-name').fill(process.env.AO_CHAR);
if (process.env.AO_CLASS_NEXT) for (let i = 0; i < Number(process.env.AO_CLASS_NEXT); i++) await page.getByRole('button', { name: 'Clase siguiente' }).click().catch(() => {});
await page.getByRole('button', { name: 'Raza siguiente' }).click(); await page.getByRole('button', { name: 'Genero siguiente' }).click();
await page.waitForTimeout(500);
await page.locator('.cs-create').getByRole('button', { name: 'Crear personaje' }).click();
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60000 }); await page.waitForTimeout(2500);
console.log(JSON.stringify({ problems: h.problems.slice(0, 5), name: await page.locator('#character-name').innerText() }));
await h.browser.close();
