// AGPL-3.0-or-later. Window sweep (21 Nov): headless Chrome against the REAL VB6 server through tools/dev-web.mjs, opening every window a
// non-GM player can reach (frmMain menu panel, options, exit, skills, map, right-click menus, slash-command forms) plus the NPC forms, which
// are opened by injecting the server packet the VB6 server sends for them into the live session (the page's WebSocket is proxied here).
// Screenshots artifacts/screenshots/window-sweep-<name>.png; a JSON line per window says whether it carries its interface bitmap.
// Usage: AO_WEB_PORT=5823 AO_EMAIL=.. AO_PASSWORD=.. [AO_ONLY=duel,options] node tools/window-sweep-real-shot.mjs
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { FrameDecoder, encodeFrame, encodeServerFrame } from '../packages/protocol/dist/index.js';
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5823}/`;
const only = process.env.AO_ONLY ? new Set(process.env.AO_ONLY.split(',')) : undefined;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = [];
page.on('pageerror', e => problems.push(e.message));
let inject = () => {};
await page.routeWebSocket(/\/bridge/, ws => {
  const server = ws.connectToServer();
  inject = (...packets) => { for (const packet of packets) ws.send(Buffer.from(encodeServerFrame(packet))); };
  // Whole frames only (tools/fx-inject-proxy.mjs): an injected frame must never land inside a server frame split across two chunks.
  const decoder = new FrameDecoder();
  ws.onMessage(message => server.send(message)); ws.onClose(() => server.close());
  server.onMessage(message => { for (const body of decoder.push(new Uint8Array(typeof message === 'string' ? Buffer.from(message) : message))) ws.send(Buffer.from(encodeFrame(body))); });
});
async function login() {
  await page.goto(base);
  await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
  await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30_000 }); await page.waitForTimeout(2500);
  await page.mouse.dblclick(247, 291);
  await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
}
await login();
mkdirSync('artifacts/screenshots', { recursive: true });
const say = async text => { await page.locator('#viewport canvas[tabindex]').focus(); await page.keyboard.press('Enter'); await page.locator('#chat').fill(text); await page.keyboard.press('Enter'); await page.waitForTimeout(900); };
const esc = async (n = 3) => { for (let i = 0; i < n; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); } };
/** Every element that looks like an open window: what it is called, its box and whether it shows an interface bitmap. */
const visibleWindows = () => page.evaluate(() => [...document.querySelectorAll('[role=dialog], .vb-window, [id$="-window"], [role=menu]')].filter(el => {
  const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 20 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]');
}).map(el => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
  return { id: el.id, cls: el.className, label: el.getAttribute('aria-label'), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    bg: (cs.backgroundImage.match(/(?:es_|en_)?([\w-]+)\.(?:bmp|png|jpg)/) ?? [])[1] ?? (cs.backgroundImage === 'none' ? '' : 'blob'), plainControls: el.querySelectorAll('.vb-command, .vb-text.vb-light, input[type=checkbox]').length }; }));
const results = [];
async function step(name, open, close = () => esc()) {
  if (only && !only.has(name)) return;
  const before = new Set((await visibleWindows()).map(w => w.id + w.cls));
  try { await open(); } catch (error) { results.push({ name, error: String(error).slice(0, 160) }); await close().catch(() => undefined); return; }
  await page.waitForTimeout(1200);
  const now = (await visibleWindows()).filter(w => !before.has(w.id + w.cls));
  await page.screenshot({ path: `artifacts/screenshots/window-sweep-${name}.png` });
  results.push({ name, windows: now });
  await close().catch(() => undefined); await page.waitForTimeout(300);
}
const click = selector => () => page.locator(selector).click();
const menu = label => async () => { await page.locator('#menu-tab').click(); await page.getByRole('button', { name: label, exact: true }).click(); };
const view = await page.locator('#viewport').boundingBox();
const k = view.width / 736;
await step('duel', menu('Retos'));
await step('duel-names', () => say('/RETAR Ana@Beto'));
await step('party', menu('Grupo'));
await step('guild', menu('Clanes'));
await step('keyring', menu('Llavero'));
await step('quests', menu('Quests'));
await step('stats', menu('Estadísticas'));
await step('skins', async () => { await page.locator('#menu-tab').click(); await page.getByRole('button', { name: 'Skins', exact: true }).click({ force: true }); });
await step('options', click('#settings'));
await step('exit', click('#disconnect'));
await step('manual', click('#manual'));
await step('skills', () => page.getByRole('button', { name: 'Skills', exact: true }).click());
await step('world-map', click('#minimap'));
await step('spell-info', async () => { await page.locator('#spells-tab').click(); await page.locator('#spell-info').click(); }, async () => { await esc(); await page.locator('#inventory-tab').click(); });
await step('bug-report', async () => { await page.locator('#menu-tab').click(); await page.locator('#bug-report').click(); });
await step('rightclick-self', () => page.mouse.click(view.x + 368 * k, view.y + 304 * k, { button: 'right' }));
await step('drop-amount', async () => { await page.locator('#inventory-tab').click(); await page.locator('#inventory').click({ position: { x: 17, y: 17 } }); await page.keyboard.press('t'); });
// Server-opened forms: the packet the VB6 server writes for them, injected into this live session.
const packets = await import('../packages/protocol/dist/index.js');
const P = packets;
const S = { ...P.BankTradeServerPacketId };
const injected = (name, ...packets) => step(name, async () => { if (!only || only.size > 1) await login(); inject(...packets); });
await injected('bank', { id: P.BankTradeServerPacketId.BankInit });
await step('trade-user', () => inject({ id: P.BankTradeServerPacketId.UserCommerceInit }), async () => { await esc(); });
await injected('commerce-npc', { id: P.ItemsServerPacketId.CommerceInit, npcName: 'Comerciante' });
await injected('pregunta', { id: P.BankTradeServerPacketId.ShowPregunta, messageId: 1594, param: 'Ana' });
await injected('user-request', { id: P.BankTradeServerPacketId.ShowUserRequest, details: 'linea uno·linea dos' });
await injected('msgbox', { id: P.SessionServerPacketId.ShowMessageBox, messageId: 1769, extra: '' });
await injected('blacksmith', { id: P.CraftingServerPacketId.ShowBlacksmithForm });
await injected('carpenter', { id: P.CraftingServerPacketId.ShowCarpenterForm });
await injected('alchemy', { id: P.CraftingServerPacketId.AlquimistaObj, objects: [891] }, { id: P.CraftingServerPacketId.ShowAlquimiaForm });
await injected('tailor', { id: P.CraftingServerPacketId.SastreObj, objects: [3578, 240, 3822] }, { id: P.CraftingServerPacketId.ShowSastreForm });
await injected('trainer', { id: P.SkillsServerPacketId.TrainerCreatureList, creatures: ['Lobo', 'Oso', 'Tigre'] });
await injected('travel', { id: P.PetsTravelServerPacketId.ViajarForm, destinations: [{ city: 'Ciudad de Arghal', cost: 6500 }, { city: 'Monte Perdido', cost: 3000 }], interface: 0 });
await injected('papiro', { id: P.KeyringServerPacketId.ShowPapiro });
await injected('guild-foundation', { id: P.GuildServerPacketId.ShowGuildFundationForm });
await injected('guild-fundar', { id: P.GuildServerPacketId.ShowFundarClanForm });
await injected('guild-news', { id: P.GuildServerPacketId.GuildNews, news: 'Noticia', guilds: 'Aliados-1\0Otros-0', members: 'Ana\0Bob', level: 2, exp: 10, expNeeded: 20 });
await injected('guild-details', { id: P.GuildServerPacketId.GuildDetails, name: 'Los Pibes', founder: 'Ana', creationDate: '01/02/2026', leader: 'Bob', memberCount: 7, alignment: 'Neutral', description: 'Hola', level: 2 });
await injected('guild-offer', { id: P.GuildServerPacketId.OfferDetails, details: 'texto' });
await injected('char-info', { id: P.GuildServerPacketId.CharacterInfo, gender: 1, name: 'Cleo', race: 2, characterClass: 3, level: 12, gold: 100, bank: 200, previousPetitions: 'p', currentGuild: 'G', previousGuilds: 'q', citizensKilled: 1, criminalsKilled: 2, ...{} });
await injected('peace-props', { id: P.GuildServerPacketId.PeaceProposalsList, guilds: 'Enemigos' });
await injected('forum', { id: P.GmServerPacketId.ShowForumForm });
await injected('shop', { id: P.ExtrasServerPacketId.ShopInit, credits: 100, items: [{ objNum: 1, value: 10, name: 'x' }] });
await injected('lobby', { id: P.ExtrasServerPacketId.ReportLobbyList, lobbies: [] });
await injected('quest-offers', { id: P.QuestServerPacketId.NpcQuestListSend, quests: [] });
const offered = (questIndex, state) => ({ questIndex, requiredLevel: 1, requiredQuest: 0, requiredClasses: [], limitLevel: 0, npcs: [{ amount: 10, npcIndex: 502 }], objs: [], spells: [], skillType: 0, skillValue: 0, rewardGold: 4, rewardExp: 0, rewardObjs: [], rewardSpells: [], state });
await injected('quest-offers-2', { id: P.QuestServerPacketId.NpcQuestListSend, quests: [offered(4, 0), offered(2, 3)] });
await injected('guild-leader', { id: P.GuildServerPacketId.GuildLeaderInfo, guilds: 'Aliados-0\0Enemigos-1', members: 'Ana\0Bob', news: 'Hoy hay dungeon', joinRequests: 'Dan\0Eva', level: 4, exp: 1500, expNeeded: 6000 });
await injected('signal', { id: P.SessionServerPacketId.ShowSignal, objIndex: 7, grh: 600 });
await injected('frm-mapa', { id: P.WorldServerPacketId.ShowFrmMapa, expMult: 2, goldMult: 3 });
for (const r of results) console.log(JSON.stringify(r));
console.log(JSON.stringify({ problems, S: Object.keys(S).length }));
await browser.close();
