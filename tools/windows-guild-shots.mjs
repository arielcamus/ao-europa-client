// AGPL-3.0-or-later. Screenshots the guild forms of the classic client with two real sessions against the VB6 server:
// leader Wintest (windows@local.test) and applicant Windowsapp (windows2@local.test), GM help from Aotest (tools/windows-gm.mjs).
// Usage: AO_WEB_PORT=5782 node tools/windows-guild-shots.mjs   (the guild WinGuild must exist; see tools/real-server/record-guild-flow.mjs)
import { execSync } from 'node:child_process';
import { open } from './windows-drive.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const leader = await open({ email: 'windows@local.test', password: 'windowspw1', character: 'Wintest' });
const app = await open({ email: 'windows2@local.test', password: 'windowspw2', character: 'Windowsapp' });
const gm = args => execSync(`node tools/windows-gm.mjs ${args}`, { stdio: 'inherit' });
const menu = async (h, name) => { await h.page.mouse.click(940, 535); await sleep(400); await h.page.locator(`#menu-actions button[aria-label="${name}"]`).evaluate(el => el.click()); await sleep(1300); };
const row = (h, win, text) => h.page.locator(`#${win} .vb-row`, { hasText: text }).first();
const btn = (h, name) => ({ click: () => h.page.locator(`[aria-label="${name}"], button:has-text("${name}")`).last().evaluate(el => el.click()) });
const step = async (n, fn) => {
  await Promise.race([fn(), sleep(20000).then(() => { throw new Error('step timeout'); })]).catch(e => console.log('STEP', n, 'failed:', String(e).split('\n')[0]));
  await leader.shot(`guild-${n}-leader`); await app.shot(`guild-${n}-applicant`);
};
try {
  await sleep(2500);
  gm('mod Windowsapp LEVEL 25'); gm('mod Wintest ORO 1000');
  await step('01-list', async () => { await menu(app, 'Clanes'); });
  await step('02-brief', async () => { await row(app, 'frm-guild-list', 'WinGuild').dblclick(); await sleep(1200); });
  await step('03-application', async () => { await btn(app, 'Solicitar ingreso').click(); await sleep(600); await app.page.locator('#frm-guild-sol textarea').fill('Hola, quiero entrar al clan'); });
  await step('04-sent', async () => { await btn(app, 'Enviar solicitud').click(); await sleep(1500); await menu(leader, 'Clanes'); });
  await step('05-card', async () => { await row(leader, 'frm-guild-leader', 'Windowsapp').dblclick(); await sleep(1500); });
  await step('06-request-text', async () => { await leader.page.locator('#frm-char-info button:has-text("Peticion")').evaluate(el => el.click()); await sleep(1500); });
  await step('07-reject-box', async () => { await leader.page.locator('#user-request-close').evaluate(el => el.click()); await leader.page.locator('#frm-char-info button:has-text("Rechazar")').evaluate(el => el.click()); await sleep(700); });
  await step('08-rejected', async () => { await leader.page.locator('#frm-commet textarea').fill('Todavia no'); await leader.page.locator('#frm-commet button:has-text("Enviar")').evaluate(el => el.click()); await sleep(1500); });
  // second application, accepted
  await step('09-reapply', async () => { await app.page.locator('#frm-guild-list [aria-label="Cerrar"], #frm-guild-brief [aria-label="Cerrar"]').first().click({ force: true }).catch(() => {}); await menu(app, 'Clanes'); await row(app, 'frm-guild-list', 'WinGuild').dblclick(); await sleep(1000); await btn(app, 'Solicitar ingreso').click(); await sleep(500); await app.page.locator('#frm-guild-sol textarea').fill('Segundo intento'); await btn(app, 'Enviar solicitud').click(); await sleep(1500); });
  await step('10-leader-requests', async () => { await menu(leader, 'Clanes'); });
  await step('11-card-again', async () => { await row(leader, 'frm-guild-leader', 'Windowsapp').dblclick(); await sleep(1500); });
  await step('12-accepted', async () => { await leader.page.locator('#frm-char-info button:has-text("Aceptar")').evaluate(el => el.click()); await sleep(2500); });
  await step('13-member-news', async () => { await menu(app, 'Clanes'); });
  await step('14-leader-members', async () => { await menu(leader, 'Clanes'); await row(leader, 'frm-guild-leader', 'Windowsapp').dblclick(); await sleep(1500); });
  await step('15-kick', async () => { await leader.page.locator('#frm-char-info button:has-text("Echar")').evaluate(el => el.click()); await sleep(2000); });
  gm('mod Windowsapp LEVEL 1'); gm('mod Wintest ORO 0');
} finally { console.log(JSON.stringify({ lp: leader.problems.slice(0, 3), ap: app.problems.slice(0, 3) })); await leader.browser.close(); await app.browser.close(); }
