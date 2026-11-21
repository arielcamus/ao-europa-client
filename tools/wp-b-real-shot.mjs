// AGPL-3.0-or-later. Headless Chrome against the REAL VB6 server through the bridge started by tools/dev-web.mjs:
// logs in, records which of the five "no client reference" packets the server really sends (UserIndexInServer 46 at login), opens the
// skills window and the quest log from the real server's answers and drags both (MoverForm), screenshots artifacts/screenshots/wp-b-real-*.png.
// Usage: AO_WEB_PORT=5795 AO_EMAIL=.. AO_PASSWORD=.. node tools/wp-b-real-shot.mjs   (dev-web.mjs running with AO_BRIDGE_PORT=7795 AO_TCP_PORT=7667)
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5795}/`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = [], received = new Set();
page.on('pageerror', e => problems.push(e.message));
page.on('websocket', ws => ws.on('framereceived', f => { const b = Buffer.from(f.payload); for (let i = 0; i + 4 <= b.length;) { const len = b.readUInt16LE(i); if (i + 2 + len > b.length) break; received.add(b.readUInt16LE(i + 2)); i += 2 + len; } }));
await page.goto(base);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
// The account screen: a double click on the first card plays.
await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30_000 }); await page.waitForTimeout(2000);
await page.mouse.dblclick(247, 291);
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
await page.waitForTimeout(2500);
mkdirSync('artifacts/screenshots', { recursive: true });
const shot = name => page.screenshot({ path: `artifacts/screenshots/wp-b-real-${name}.png` });
const drag = async (locator, from, to) => {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + from[0], box.y + from[1]); await page.mouse.down(); await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 5 }); await page.mouse.up();
  const after = await locator.boundingBox(); return { dx: Math.round(after.x - box.x), dy: Math.round(after.y - box.y) };
};
await page.getByRole('button', { name: 'Skills' }).click();
const skills = page.locator('#skills-window'); await skills.waitFor({ timeout: 8000 }); await page.waitForTimeout(600); await shot('skills');
console.log('skills drag', JSON.stringify(await drag(skills, [8, 8], [68, 58]))); await shot('skills-dragged');
await page.keyboard.press('Escape');
await page.locator('#menu-tab').click();
await page.getByRole('button', { name: 'Quests' }).click();
const log = page.locator('#quest-log'); await log.waitFor({ timeout: 8000 }); await page.waitForTimeout(600); await shot('quests');
console.log('quest log drag', JSON.stringify(await drag(log, [10, 60], [70, 110]))); await shot('quests-dragged');
console.log('quest rows', JSON.stringify(await log.locator('.q-main-list .q-row').allInnerTexts()));
console.log('server packet ids seen', [...received].sort((a, b) => a - b).join(','), 'UserIndexInServer(46):', received.has(46), 'ShowFrmLogear(137):', received.has(137), 'NotificarClienteCasteo(185):', received.has(185), JSON.stringify({ problems }));
await browser.close();
