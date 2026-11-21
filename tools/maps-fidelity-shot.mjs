// AGPL-3.0-or-later. maps-fidelity: minimap + big map screenshots at Forgat and Ullathorpe against the VB6 server.
// Usage: AO_WEB_PORT=5800 AO_EMAIL=.. AO_PASSWORD=.. AO_TAG=before node tools/maps-fidelity-shot.mjs
import { launch } from './world-drive.mjs';
const tag = process.env.AO_TAG ?? 'after';
const { page, say, close, problems } = await launch({ email: process.env.AO_EMAIL, password: process.env.AO_PASSWORD, port: process.env.AO_WEB_PORT });
const shot = async name => { const box = await page.locator('#minimap').boundingBox(); await page.screenshot({ path: `artifacts/screenshots/maps-fidelity-${tag}-${name}-minimap.png`, clip: { x: box.x - 4, y: box.y - 4, width: 108, height: 108 } }); await page.screenshot({ path: `artifacts/screenshots/maps-fidelity-${tag}-${name}-full.png` }); };
const bigmap = async name => { await page.locator('#minimap').click({ position: { x: 50, y: 50 } }); await page.waitForTimeout(1500); await page.screenshot({ path: `artifacts/screenshots/maps-fidelity-${tag}-${name}-bigmap.png` }); await page.keyboard.press('Escape'); await page.waitForTimeout(300); };
await shot('forgat'); await bigmap('forgat');
for (const [name, cmd] of [['ullathorpe', '/TELEP YO 1 50 50'], ['ullathorpe2', '/TELEP YO 1 62 40']]) { await say(cmd); await page.waitForTimeout(2500); await shot(name); if (name === 'ullathorpe') await bigmap(name); }
await say('/TELEP YO 751 62 57');
console.log('problems', problems); await close();
