// AGPL-3.0-or-later. Real VB6 server: the centred minimap (default), zoom buttons, the per-map mode, the LeftClick sent, and frmMapaGrande.
// Usage: AO_WEB_PORT=5785 AO_EMAIL=.. AO_PASSWORD=.. node tools/world-minimap-shot.mjs
import { launch } from './world-drive.mjs';
const { page, wire, problems, say, close } = await launch({ email: process.env.AO_EMAIL, password: process.env.AO_PASSWORD, port: process.env.AO_WEB_PORT, slot: process.env.AO_SLOT ? process.env.AO_SLOT.split(',').map(Number) : undefined });
const shot = async name => { const box = await page.locator('#minimap').boundingBox(); await page.screenshot({ path: `artifacts/screenshots/world-minimap-${name}.png`, clip: { x: box.x - 10, y: box.y - 10, width: 120, height: 120 } }); };
const info = () => page.evaluate(() => ({ mode: document.getElementById('minimap').dataset.minimapMode, canvas: !document.getElementById('minimap-canvas').hidden }));
console.log('start', await page.locator('#position').innerText(), await info());
await shot('centered-77-53');
for (let i = 0; i < 6; i++) { await page.keyboard.press('ArrowLeft', { delay: 60 }); await page.waitForTimeout(350); } await shot('centered-walked');
await page.locator('#minimap-zoom-in').click(); await page.locator('#minimap-zoom-in').click(); await page.waitForTimeout(400); await shot('zoom-in');
await page.locator('#minimap-zoom-out').click(); await page.locator('#minimap-zoom-out').click(); await page.locator('#minimap-zoom-out').click(); await page.locator('#minimap-zoom-out').click(); await page.waitForTimeout(400); await shot('zoom-out');
await page.screenshot({ path: 'artifacts/screenshots/world-minimap-full.png' });
// big map
const before = wire.length;
await page.locator('#minimap').click({ position: { x: 50, y: 50 } }); await page.waitForTimeout(1500);
console.log('big map open', await page.locator('#world-map-window').isVisible(), await page.locator('#world-map-window .wm-title').innerText());
await page.screenshot({ path: 'artifacts/screenshots/world-bigmap.png' });
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
console.log('closed by Esc', !(await page.locator('#world-map-window').isVisible().catch(() => false)));
console.log('c2s after minimap click', wire.slice(before).filter(w => w.dir === 'c2s').map(w => w.id));
console.log('problems', problems);
await close();
