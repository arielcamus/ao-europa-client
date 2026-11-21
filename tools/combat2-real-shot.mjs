// AGPL-3.0-or-later. Headless Chrome against the REAL VB6 server for wp03 (combat and spells completion).
// Usage: AO_WEB_PORT=5766 AO_EMAIL=spells@local.test AO_PASSWORD=... node tools/combat2-real-shot.mjs menu|bow
//   menu: the five safe toggles of the MENU tab (click clan, resurrection, party, legion) on map 1.
//   bow:  map 2 next to the snakes: equip bow + arrows, use the bow (target cursor), shoot, die; screenshots in artifacts/screenshots.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
const mode = process.argv[2] ?? 'menu';
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5766}/`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = [];
page.on('pageerror', e => problems.push(e.message));
await page.goto(base);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
await page.waitForTimeout(2500);
mkdirSync('artifacts/screenshots', { recursive: true });
const shot = name => page.screenshot({ path: `artifacts/screenshots/combat-spells-2-${name}.png` });
const lines = async n => (await page.locator('#messages').innerText()).split('\n').slice(-n);
if (mode === 'menu') {
  await page.locator('#menu-tab').click();
  await shot('menu-safes-on');
  for (const id of ['safe-clan', 'safe-resu', 'safe-party', 'safe-attack']) { await page.locator(`#${id}`).click(); await page.waitForTimeout(1200); }
  await page.locator('#safe-legion').click(); await page.waitForTimeout(500);
  console.log('console:', JSON.stringify(await lines(6)));
  await shot('menu-safes-off');
  for (const id of ['safe-clan', 'safe-resu', 'safe-party', 'safe-attack']) { await page.locator(`#${id}`).click(); await page.waitForTimeout(1200); }
  console.log('after toggling back:', JSON.stringify(await lines(4)));
} else if (mode === 'bow') {
  const slot = n => page.locator(`#inventory .inventory-slot:nth-child(${n})`);
  await slot(11).dblclick(); await page.waitForTimeout(1000); await slot(12).dblclick(); await page.waitForTimeout(1000);
  await slot(11).dblclick(); await page.waitForTimeout(800);
  console.log('targeting after using the bow:', await page.locator('#viewport').getAttribute('data-targeting'), JSON.stringify(await lines(2)));
  await shot('bow-target');
  const rect = await page.locator('#viewport').boundingBox();
  const [px, py] = (await page.locator('#position').innerText()).split(', ').map(Number);
  // click the tile one north-east of the character: whatever stands there, the shot is fired.
  await page.mouse.click(rect.x + rect.width / 2 + 32, rect.y + rect.height / 2 - 32); await page.waitForTimeout(700);
  await shot('bow-shot');
  console.log('after the shot:', JSON.stringify(await lines(3)), 'at', px, py);
  await page.waitForTimeout(9000); await shot('after-fight');
  console.log('later:', JSON.stringify(await lines(4)));
}
console.log(JSON.stringify({ problems }));
await browser.close();
