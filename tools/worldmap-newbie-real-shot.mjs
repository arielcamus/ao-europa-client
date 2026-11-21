// AGPL-3.0-or-later. Headless Chrome against the REAL VB6 server through tools/dev-web.mjs: frmMapaGrande in the Newbie Dungeon
// (Ariel, 21 Nov: "the big map shows me in the wrong place"). A GM character goes to the Ullathorpe door of the Newbie Dungeon (1:74,22),
// walks in (map 168), opens the big map from the minimap, then goes to Dungeon Newbie Sur (167, Ariel's map; AO_SUR_TILE, default 50 50) and opens it again; it ends
// where it started. Screenshots artifacts/screenshots/worldmap-newbie-*.png.
// Usage: AO_WEB_PORT=5820 AO_EMAIL=.. AO_PASSWORD=.. node tools/worldmap-newbie-real-shot.mjs   (dev-web.mjs running with AO_BRIDGE_PORT=7820 AO_TCP_PORT=7667)
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5820}/`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = [];
page.on('pageerror', e => problems.push(e.message));
await page.goto(base);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30_000 }); await page.waitForTimeout(2000);
await page.mouse.dblclick(247, 291);
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
await page.waitForTimeout(2500);
mkdirSync('artifacts/screenshots', { recursive: true });
const shot = name => page.screenshot({ path: `artifacts/screenshots/worldmap-newbie-${name}.png` });
const map = () => page.locator('#minimap').getAttribute('data-minimap-map');
const position = async () => (await page.locator('#position').textContent())?.trim();
const say = async text => { await page.keyboard.press('Enter'); await page.locator('#chat').fill(text); await page.keyboard.press('Enter'); await page.waitForTimeout(1500); };
const waitMap = async want => { for (let i = 0; i < 40 && (await map()) !== String(want); i++) await page.waitForTimeout(250); return map(); };
const start = { map: await map(), at: await position() };
await page.locator('#viewport').click({ position: { x: 5, y: 5 } }).catch(() => undefined); await page.keyboard.press('Escape').catch(() => undefined);

const bigMap = async name => {
  await page.locator('#minimap').click();
  const win = page.locator('#world-map-window'); await win.waitFor({ timeout: 8000 }); await page.waitForTimeout(1500);
  const read = sel => win.locator(sel).evaluate(el => { const s = el.style; return { display: s.display, left: parseFloat(s.left), top: parseFloat(s.top) }; });
  const result = { title: await win.locator('.wm-title').textContent(), dungeon: await win.getByRole('button', { name: 'Mapa de mazmorras' }).getAttribute('data-checked'),
    player: await read('.wm-player'), selected: await read('.wm-selected'), at: await position() };
  // How much of the picture under the selected cell is not black: the art the marker sits on.
  result.cellLit = await win.locator('.wm-picture').evaluate(async (el, cell) => {
    const url = getComputedStyle(el).backgroundImage.replace(/^url\("?|"?\)$/g, ''); const image = new Image(); image.src = url; await image.decode();
    const c = document.createElement('canvas'); c.width = 27; c.height = 27; const g = c.getContext('2d'); g.drawImage(image, cell.left, cell.top, 27, 27, 0, 0, 27, 27);
    const d = g.getImageData(0, 0, 27, 27).data; let lit = 0; for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) > 24) lit++; return lit;
  }, result.selected);
  await shot(name); await win.screenshot({ path: `artifacts/screenshots/worldmap-newbie-${name}-window.png` });
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  return result;
};

await say('/TELEP YO 1 74 24'); await waitMap(1);
const atDoor = await position();
let walkedIn = await map();
for (let i = 0; i < 6 && walkedIn === '1'; i++) { await page.keyboard.press('ArrowUp'); await page.waitForTimeout(600); walkedIn = await map(); }
await waitMap(168); await page.waitForTimeout(2000);
const central = { map: await map(), ...(await bigMap('168')) };
await say(`/TELEP YO 167 ${process.env.AO_SUR_TILE ?? '50 50'}`); await waitMap(167); await page.waitForTimeout(2000);
const sur = { map: await map(), ...(await bigMap('167')) };
const [sx, sy] = (start.at ?? '').split(',').map(Number);
if (start.map && sx && sy) { await say(`/TELEP YO ${start.map} ${sx} ${sy}`); await waitMap(start.map); }
const end = { map: await map(), at: await position() };
console.log(JSON.stringify({ start, atDoor, central, sur, end, problems }, null, 1));
await browser.close();
