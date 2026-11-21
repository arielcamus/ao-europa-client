// AGPL-3.0-or-later. WP-A: frmMain buttons and frmMapaGrande creature panel against the REAL VB6 server (own account, see report).
// Usage: AO_WEB_PORT=5794 AO_EMAIL=... AO_PASSWORD=... node tools/wp-a-screens-shot.mjs
import { launch } from './world-drive.mjs';
const gm = await launch({ email: process.env.AO_EMAIL, password: process.env.AO_PASSWORD, port: process.env.AO_WEB_PORT });
const { page, wire } = gm; const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = name => page.screenshot({ path: `artifacts/screenshots/wp-a-${name}.png` });
const visible = id => page.locator(`#${id}`).evaluate(el => !el.hidden);
await shot('main');
const modes = {};
for (const [button, label] of [['btn-exp-total', 'experience-text'], ['btn-exp', 'exp-percent'], ['btn-exp2', 'exp-percent4'], ['btn-exp-remaining', 'exp-remaining']]) {
  await page.locator(`#${button}`).click(); await wait(300);
  modes[button] = { label, visible: await visible(label), text: await page.locator(`#${label}`).textContent(),
    othersHidden: (await Promise.all(['experience-text', 'exp-percent', 'exp-percent4', 'exp-remaining'].filter(l => l !== label).map(visible))).every(v => !v) };
  await shot(`exp-${button}`);
}
console.log('exp modes', JSON.stringify(modes));
const sentIds = () => wire.filter(w => w.dir === 'c2s').map(w => w.id);
const bindKeys = wire.filter(w => w.dir === 's2c' && w.id === 136).map(w => w.hex);
console.log('BindKeys from server', bindKeys);
const mark = wire.length;
await page.locator('#chat-combat-icon').click(); await wait(500); await page.locator('#chat-global-icon').click(); await wait(500);
console.log('MacroPos sent', wire.slice(mark).filter(w => w.dir === 'c2s').map(w => `${w.id}:${w.hex}`));
await shot('chat-icons');
await page.locator('#chat-combat-icon').click(); await wait(300); await page.locator('#chat-global-icon').click(); await wait(300);
// info panel buttons
await page.locator('#menu-tab').click(); await wait(300);
const mark2 = wire.length;
await page.getByRole('button', { name: 'Hogar', exact: true }).click(); await wait(800);
console.log('Hogar sent', wire.slice(mark2).filter(w => w.dir === 'c2s').map(w => w.id));
await page.getByRole('button', { name: 'Retos', exact: true }).click(); await wait(500);
console.log('Retos form', await page.locator('#duel-window').isVisible()); await shot('retos'); await page.keyboard.press('Escape');
await page.locator('#bug-report').click(); await wait(500);
console.log('bug report form', await page.locator('#gm-help').isVisible()); await shot('bugreport'); await page.keyboard.press('Escape');
await shot('info-panel');
// manual / MAO ask first
const popups = []; page.on('popup', p => popups.push(p.url()));
await page.locator('#manual').click(); await wait(400); await shot('manual-confirm');
console.log('confirm dialog text', await page.locator('.vb-window, [role=dialog]').allInnerTexts().then(t => t.filter(Boolean).slice(-2)));
console.log('problems', JSON.stringify(gm.problems.slice(0, 5)));
await page.keyboard.press('Escape'); await wait(300);
await gm.close();
