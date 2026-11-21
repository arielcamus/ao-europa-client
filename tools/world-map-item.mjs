// AGPL-3.0-or-later. Real VB6 server: GM /CI 3137 1 (the "Mapa" item, ObjType 37), use it (ShowFrmMapa, 138), screenshot frmMapaGrande with the
// multipliers, record tests/fixtures/vb6/world/map-item-show-form.jsonl, then delete the item again (undo = nothing left in the inventory).
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch } from './world-drive.mjs';
const gm = await launch({ email: process.env.AO_EMAIL, password: process.env.AO_PASSWORD, port: process.env.AO_WEB_PORT });
const wait = ms => new Promise(r => setTimeout(r, ms));
const before = (await gm.page.locator('#inventory .inventory-slot').evaluateAll(n => n.map(b => b.getAttribute('aria-label'))));
await gm.say('/CI 3137 1'); await wait(1500);
const labels = await gm.page.locator('#inventory .inventory-slot').evaluateAll(n => n.map(b => b.getAttribute('aria-label')));
const slot = labels.findIndex(l => /Mapa/i.test(l ?? '') && !/Mapa/i.test(before[labels.indexOf(l)] ?? ''));
console.log('map item slot', slot + 1, labels[slot]);
const mark = gm.wire.length;
const item = gm.page.locator('#inventory .inventory-slot').nth(slot);
await item.dblclick(); await wait(2000);
const rows = gm.wire.slice(mark).filter(w => w.dir === 's2c' && w.id === 138).map((w, i) => ({ t_ms: i, dir: 's2c', id: 138, name: 'ShowFrmMapa', hex: w.hex }));
console.log('138 rows', rows.length, rows[0]?.hex, 'window', await gm.page.locator('#world-map-window').isVisible());
await gm.page.screenshot({ path: 'artifacts/screenshots/world-bigmap-item.png' });
if (rows.length) { mkdirSync('tests/fixtures/vb6/world', { recursive: true }); writeFileSync('tests/fixtures/vb6/world/map-item-show-form.jsonl', rows.map(r => JSON.stringify(r)).join('\n') + '\n'); }
await gm.page.keyboard.press('Escape'); await wait(300);
// undo: delete the item
await item.click(); await gm.page.locator('#delete-item').click(); await wait(300);
await gm.page.locator('#delete-confirm button:has-text("Sí")').click(); await wait(1000);
console.log('after delete', (await gm.page.locator('#inventory .inventory-slot').nth(slot).getAttribute('aria-label')));
await gm.close();
