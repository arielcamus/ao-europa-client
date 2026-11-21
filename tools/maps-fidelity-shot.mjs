// AGPL-3.0-or-later. maps-fidelity (#74): the per-map minimap (CenteredMinimap = 0) against the VB6 server, through your own bridge.
// Usage: AO_WEB_PORT=5874 AO_EMAIL=.. AO_PASSWORD=.. node tools/maps-fidelity-shot.mjs   (a GM character: it uses /TELEP and puts it back)
// Writes artifacts/screenshots/maps-fidelity-<map>-minimap.png (1:1, the 100 x 100 control), -minimap-2x.png (classic scale 2), -full.png,
// and prints, for every stop and every walking step, the tile, the dot's pixel and the pixel the VB6 formula gives.
import { launch } from './world-drive.mjs';

const vb6Dot = (x, y) => ({ left: Math.round((x - 13) * (100 / 74) - 3), top: Math.round((y - 10) * (100 / 80) - 3) });
const { page, say, close, problems } = await launch({ email: process.env.AO_EMAIL, password: process.env.AO_PASSWORD, port: process.env.AO_WEB_PORT });
const state = () => page.evaluate(() => {
  const dot = document.getElementById('minimap-dot'), sheet = document.getElementById('minimap-map');
  const [x, y] = (document.getElementById('position').textContent ?? '').split(',').map(Number);
  return { map: Number(document.getElementById('map-number').textContent), x, y, left: parseFloat(dot.style.left), top: parseFloat(dot.style.top), dotHidden: dot.hidden,
    mode: document.getElementById('minimap').dataset.minimapMode, sheet: sheet ? { w: sheet.width, density: sheet.dataset.density, hidden: sheet.hidden } : undefined };
});
const rows = [];
const check = async label => {
  const s = await state(), want = vb6Dot(s.x, s.y), ok = s.left === want.left && s.top === want.top;
  rows.push({ label, ...s, want, ok }); console.log(JSON.stringify({ label, map: s.map, tile: [s.x, s.y], dot: [s.left, s.top], vb6: [want.left, want.top], ok, mode: s.mode, sheet: s.sheet }));
  return s;
};
const shot = async name => {
  const box = await page.locator('#minimap').boundingBox();
  await page.screenshot({ path: `artifacts/screenshots/maps-fidelity-${name}-minimap.png`, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  await page.screenshot({ path: `artifacts/screenshots/maps-fidelity-${name}-full.png` });
};
const walk = async (key, steps, label) => { for (let i = 0; i < steps; i++) { await page.keyboard.press(key); await page.waitForTimeout(350); } await page.waitForTimeout(400); return check(label); };

const home = await check('login');
// Ullathorpe (map 1): stand under the quest NPC 419 at (26, 16), whose marker DibujarMiniMapa paints at ConvertToMinimapPosition(26, 16, 2, 0).
await say('/TELEP YO 1 26 17'); await page.waitForTimeout(2500); await check('ullathorpe under quest NPC 419 (26,16)'); await shot('ullathorpe-quest');
await say('/TELEP YO 1 50 50'); await page.waitForTimeout(2500); await check('ullathorpe centre'); await shot('ullathorpe');
await walk('ArrowRight', 4, 'walk east x4'); await walk('ArrowDown', 4, 'walk south x4'); await walk('ArrowLeft', 4, 'walk west x4'); await walk('ArrowUp', 4, 'walk north x4');
// Edges: the server puts the character on the nearest free tile, so the check reads back where it landed.
for (const [x, y] of [[14, 11], [86, 11], [14, 89], [86, 89]]) { await say(`/TELEP YO 1 ${x} ${y}`); await page.waitForTimeout(2500); await check(`ullathorpe corner ${x},${y}`); await shot(`ullathorpe-corner-${x}-${y}`); }
// A dungeon (map 40, Catacumbas Ullathorpe) and an open field (map 22, Bosque).
await say('/TELEP YO 40 50 50'); await page.waitForTimeout(2500); await check('dungeon map 40'); await shot('dungeon-40');
await say('/TELEP YO 22 50 50'); await page.waitForTimeout(2500); await check('field map 22'); await shot('field-22');
await walk('ArrowUp', 3, 'field walk north x3');
// Classic scale 2: the canvas backing store doubles (density 2) and is filled nearest neighbour.
await page.setViewportSize({ width: 2048, height: 1536 }); await page.waitForTimeout(800); await check('field map 22 at scale 2');
{ const box = await page.locator('#minimap').boundingBox(); await page.screenshot({ path: 'artifacts/screenshots/maps-fidelity-field-22-minimap-2x.png', clip: { x: box.x, y: box.y, width: box.width, height: box.height } }); }
await page.setViewportSize({ width: 1024, height: 768 }); await page.waitForTimeout(500);
await say(`/TELEP YO ${home.map} ${home.x} ${home.y}`); await page.waitForTimeout(2000); await check('back home');
console.log('summary', JSON.stringify({ checks: rows.length, mismatches: rows.filter(r => !r.ok).map(r => r.label) }));
console.log('problems', problems); await close();
