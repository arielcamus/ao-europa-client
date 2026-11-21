// AGPL-3.0-or-later. WP-A: frmMapaGrande creature panel against the REAL VB6 server. Usage: AO_WEB_PORT=5794 AO_EMAIL=.. AO_PASSWORD=.. node tools/wp-a-map-shot.mjs
import { launch } from './world-drive.mjs';
const gm = await launch({ email: process.env.AO_EMAIL, password: process.env.AO_PASSWORD, port: process.env.AO_WEB_PORT });
const { page } = gm; const wait = ms => new Promise(r => setTimeout(r, ms));
await page.locator('#minimap').click(); await page.locator('#world-map-window').waitFor(); await wait(1500);
await page.screenshot({ path: 'artifacts/screenshots/wp-a-map-open.png' });
const win = page.locator('#world-map-window');
const read = () => win.evaluate(root => {
  const lists = [...root.querySelectorAll('.vb-list')];
  const rows = el => [...el.children].map(r => r.textContent);
  return { title: root.querySelector('.wm-title')?.textContent, creatures: rows(lists[0]), drops: rows(lists[1]), labels: [...root.querySelectorAll('.vb-label')].map(l => l.textContent).filter(Boolean).slice(-6) };
});
console.log('own map', JSON.stringify(await read()));
for (const map of (process.env.AO_MAPS ?? '1,34,20').split(',').map(Number)) {
  await win.locator('input').fill(String(map)); await page.keyboard.press('Enter'); await wait(1200);
  const state = await read(); console.log('search', map, JSON.stringify(state));
  const rows = win.locator('.vb-list').first().locator('.vb-row');
  const n = await rows.count();
  for (let i = 0; i < Math.min(n, Number(process.env.AO_ROWS ?? 3)); i++) {
    await rows.nth(i).click(); await wait(900);
    { const r = await read(); if (process.env.AO_COMPACT) { if (r.drops.length) console.log('  row', i, map, r.creatures[i], 'drops', JSON.stringify(r.drops), JSON.stringify(r.labels)); } else console.log('  row', i, JSON.stringify(r)); }
    if (map === Number(process.env.AO_SHOT_MAP ?? 1) && i === Number(process.env.AO_SHOT_ROW ?? 0)) { await page.screenshot({ path: 'artifacts/screenshots/wp-a-map-creature-a.png' }); await wait(700); await page.screenshot({ path: 'artifacts/screenshots/wp-a-map-creature-b.png' }); }
  }
}
await page.screenshot({ path: 'artifacts/screenshots/wp-a-map-final.png' });
console.log('problems', JSON.stringify(gm.problems.slice(0, 5)));
await gm.close();
