// AGPL-3.0-or-later. NWB-* : the "typical player" path on the live pre-HOO server as configured on 2026-11-21 (docs/DATA-PATCHES.md section 8,
// docs/SERVER-PREHOO-BUILD.md "Newbie graduation"): a new character picks its city, reads the welcome text, takes Makrom's first quest at the
// city's Cartelera, walks into the Newbie Dungeon, kills, hands the quest in at Makrom and levels up. The same character then does what every
// player does next (Ariel's checklist, 21 Nov): chat, assign skill points, store gold in the bank, die and lose some items but not others, and
// graduate at level 13. It is ONE fresh warrior of the harness's own (account cached in artifacts/playthrough/newbie.json), created in Ullathorpe.
//
// Expected numbers: quest 190 and the creatures from the live Dat (Quests.DAT [QUEST190]: 508x2, 506x7, 502x10, 501x8, RewardEXP 250, RewardGLD 60;
// npcs.dat 508 Hormiga GiveEXP 11), Configuracion.ini ExpMult=4 / OroMult=1 / OroPorNivelBilletera=1000, Ciudades.Dat [Ullathorpe] 1:57,44.
// Code: 9ccd7fad ModQuest.bas EnviarQuest/FinishQuest, Protocol.bas HandleQuestAccept, SistemaCombate GetExpForUser, Modulo_UsUaRiOs CheckUserLevel,
// InvUsuario TirarTodosLosItems/QuitarNewbieObj (+ the -c graduation patch), Protocol.bas HandleBankDepositGold/ExtractGold, HandleTalk/HandleWhisper.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { QuestClientPacketId as Q, BankTradeClientPacketId as BK, SessionClientPacketId as SCP, SkillsClientPacketId as SK, ItemsClientPacketId as IT, CombatClientPacketId as CB, DoorClientPacketId as DOOR } from '@ao/protocol';
import type { ClientPacket } from '@ao/protocol';
import { step } from '../harness.js';
import type { Ctx } from '../harness.js';
import { Sess } from '../session.js';
import { loadMap, path as bfs, walkable } from '../maps.js';
import { gmGoto, spawnCreature, killMine, skills, SKILL } from './util.js';
import { sql } from './sc-util.js';

const CITY = { id: 1, name: 'Ullathorpe', map: 1, x: 57, y: 44 } as const; // Ciudades.Dat [Ullathorpe] on the live server
const CARTELERA = { npc: 1331, x: 60, y: 56 }, MAKROM_NEAR_DOOR = { x: 77, y: 18 }, DOOR_TO_DUNGEON = { x: 74, y: 22 }, DUNGEON = { map: 168, x: 50, y: 32 };
const EXP_MULT = 4, BILLETERA = 1000;
const Q190 = { id: 190, npcs: [[508, 2], [506, 7], [502, 10], [501, 8]] as [number, number][], exp: 250, gold: 60 };
// creatures carry no name in CharacterCreate (ShowName=0): they are told apart by body (npcs.dat Body=)
const CREATURES: Record<string, { npc: number; giveExp: number; body: number }> = { Hormiga: { npc: 508, giveExp: 11, body: 4100 }, 'Murciélago': { npc: 506, giveExp: 18, body: 4340 }, Serpiente: { npc: 502, giveExp: 22, body: 4194 }, Gallo: { npc: 501, giveExp: 18, body: 4050 } };
const creatureOf = (body: number) => Object.entries(CREATURES).find(([, v]) => v.body === body)?.[0];
const questTargets = (s: Sess) => [...s.chars.values()].filter(ch => ch.npc === 1 && creatureOf(ch.body)).sort((a, b) => (Math.abs(a.x - s.x) + Math.abs(a.y - s.y)) - (Math.abs(b.x - s.x) + Math.abs(b.y - s.y)));
const EXP_LEVEL_UP = [0, 500, 750, 1125, 1687, 2531, 3796, 5695, 8542, 12814, 19221, 28832, 43248]; // Balance.dat [EXP], index = ELV
const MOTD = { rates: 'EXP X4', newbie: '¿Eres nuevo? Hasta el nivel 12 entrena en el Dungeon Newbie', board: 'Busca la Cartelera de tu ciudad' };

interface Nb { s: Sess; email: string; password: string; name: string; fresh: boolean; created: Sess['rx'] }
const FILE = 'artifacts/playthrough/newbie.json';
const letters = (n: number) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');

/** The newbie character: created once per run (AO_NEWBIE_FRESH=0 reuses the cached one), always in Ullathorpe (home byte 1). */
async function nb(c: Ctx): Promise<Nb> {
  const have = c.shared.nb as Nb | undefined;
  if (have) { if (have.s.closed) await relog(c); return c.shared.nb as Nb; }
  const cached = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) as { email: string; password: string; name: string } : undefined;
  if (cached && process.env.AO_NEWBIE_FRESH === '0') {
    const s = await Sess.open(); await s.loginAccount(cached.email, cached.password);
    const ch = s.characters.find(x => x.name === cached.name)!; await s.loginChar(ch.id, ch.name);
    return (c.shared.nb = { s, ...cached, fresh: false, created: [] }) as Nb;
  }
  const email = `ptnewbie${Date.now()}@local.test`, password = 'playthroughpw1';
  for (let i = 0; i < 3; i++) {
    const s = await Sess.open(), name = `Nw${letters(7)}`;
    try {
      if (i === 0) await s.createAccount(email, password); else await s.loginAccount(email, password);
      const r = await s.createChar({ name, race: 1, gender: 1, characterClass: 3, head: 1, home: CITY.id });
      if (r.ok) { mkdirSync('artifacts/playthrough', { recursive: true }); writeFileSync(FILE, JSON.stringify({ email, password, name })); return (c.shared.nb = { s, email, password, name, fresh: true, created: [...s.rx] }) as Nb; }
      s.close();
    } catch { s.close(); }
    await new Promise(r => setTimeout(r, 3000));
  }
  c.blocked('could not create the newbie character (3 attempts)');
  throw new Error('unreachable');
}
async function relog(c: Ctx) {
  const n = c.shared.nb as Nb; n.s.close(); let last: unknown;
  for (let i = 0; i < 4; i++) {
    const s = await Sess.open();
    try { await s.loginAccount(n.email, n.password); const ch = s.characters.find(x => x.name === n.name)!; await s.loginChar(ch.id, ch.name); n.s = s; return; }
    catch (e) { last = e; s.close(); await new Promise(r => setTimeout(r, 4000)); }
  }
  throw last;
}
const userId = (n: Nb) => Number(sql(`select id from user where name='${n.name}';`));
/** Logs the newbie out cleanly, runs UPDATEs on its own rows ({id} placeholder), logs it back in. Own test character only (brief rule). */
async function dbNb(c: Ctx, ...statements: string[]) {
  const n = await nb(c), id = userId(n), s = n.s, pm = s.mark(); s.say('/SALIR');
  await s.until(() => s.closed || s.rx.slice(pm).some(r => r.name === 'Disconnect'), 25_000, 'logout').catch(() => undefined); s.close();
  let free = false; for (let i = 0; i < 20 && !free; i++) { free = sql(`select is_logged from user where id=${id};`) === '0'; if (!free) await new Promise(r => setTimeout(r, 3000)); }
  if (!free) { await relog(c); c.blocked(`${n.name} stayed is_logged=1 for 60 s: the DB UPDATE was not applied`); }
  for (const st of statements) sql(st.replace(/\{id\}/g, String(id)));
  await relog(c);
}

// ---- moving and fighting like a player ----
const DIRS: Record<number, [number, number]> = { 1: [0, -1], 2: [1, 0], 3: [0, 1], 4: [-1, 0] };
const face = (s: Sess, h: number) => s.send({ id: SCP.ChangeHeading, heading: h, counter: 0 } as unknown as ClientPacket);
const headingTo = (fx: number, fy: number, tx: number, ty: number) => tx > fx ? 2 : tx < fx ? 4 : ty > fy ? 3 : 1;
/** Tile exits of a map: a route must not cross one by accident (stepping on it changes map). */
const exitTiles = (map: number) => (loadMap(map)?.exits ?? []).map(e => e.y * 101 + e.x);
const occupied = (s: Sess) => new Set([...s.chars.values()].filter(ch => ch.charIndex !== s.charIndex).map(ch => ch.y * 101 + ch.x));
/** Walks along a BFS path, re-planning around characters that block it. `within` = stop when the Manhattan distance to the target is <= within. */
async function walk(s: Sess, tx: number, ty: number, within = 0, maxSteps = 400): Promise<void> {
  const blocked = new Set<number>(); let steps = 0;
  for (let plan = 0; plan < 12; plan++) {
    if (Math.abs(s.x - tx) + Math.abs(s.y - ty) <= within) return;
    const f = loadMap(s.map); if (!f) throw new Error(`no map file for ${s.map}`);
    const extra = new Set([...occupied(s), ...blocked, ...exitTiles(s.map)]); extra.delete(ty * 101 + tx);
    if (!walkable(f.map, tx, ty)) throw new Error(`target ${s.map}:${tx},${ty} is not walkable: use approach()`);
    const route = bfs(f.map, [s.x, s.y], [tx, ty], extra); if (!route) throw new Error(`no path ${s.map}:${s.x},${s.y} -> ${tx},${ty}`);
    let refused = false;
    for (const h of route) {
      if (Math.abs(s.x - tx) + Math.abs(s.y - ty) <= within) return;
      const map0 = s.map, r = await s.step(h as 1 | 2 | 3 | 4, 260); steps++;
      if (s.map !== map0) return; // a tile exit took us elsewhere
      if (!r.moved) { const [dx, dy] = DIRS[h]!; blocked.add((s.y + dy) * 101 + s.x + dx); refused = true; break; }
      if (steps > maxSteps) throw new Error(`gave up after ${steps} steps at ${s.x},${s.y}`);
    }
    if (!refused && Math.abs(s.x - tx) + Math.abs(s.y - ty) <= within) return;
  }
  if (Math.abs(s.x - tx) + Math.abs(s.y - ty) > within) throw new Error(`could not reach ${tx},${ty} (at ${s.x},${s.y})`);
}
/**
 * Walks next to a character to click it. Never onto the tile right BELOW it: HandleLeftClick also looks one tile under the clicked one for a user
 * ("MapData(x, y + 1).UserIndex", the tall-sprite offset) and, finding the clicker itself there, skips HandleWorldAction, so a click from below is silent.
 */
async function approach(s: Sess, tx: number, ty: number, maxD = 2) {
  const f = loadMap(s.map)!.map, occ = occupied(s), cand: [number, number][] = [];
  for (let dy = -maxD; dy <= maxD; dy++) for (let dx = -maxD; dx <= maxD; dx++) { const x = tx + dx, y = ty + dy, d = Math.abs(dx) + Math.abs(dy); if (d === 0 || d > maxD || (dx === 0 && dy === 1) || !walkable(f, x, y) || occ.has(y * 101 + x) || exitTiles(s.map).includes(y * 101 + x)) continue; cand.push([x, y]); }
  cand.sort((a, b) => (Math.abs(a[0] - s.x) + Math.abs(a[1] - s.y)) - (Math.abs(b[0] - s.x) + Math.abs(b[1] - s.y)));
  if (cand.some(([x, y]) => x === s.x && y === s.y)) return;
  let last: unknown; for (const [x, y] of cand.slice(0, 4)) { try { await walk(s, x, y, 0); return; } catch (e) { last = e; } }
  throw last ?? new Error(`no tile next to ${tx},${ty}`);
}
const charNamed = (s: Sess, re: RegExp) => [...s.chars.values()].filter(ch => re.test(ch.name)).sort((a, b) => (Math.abs(a.x - s.x) + Math.abs(a.y - s.y)) - (Math.abs(b.x - s.x) + Math.abs(b.y - s.y)))[0];
const slotOf = (s: Sess, obj: number) => [...s.inventory.values()].find(i => i.object === obj);
/** Red potions: the starter Pocion de Vida (4335). */
async function healIfLow(s: Sess) { const st = s.stats!; if (st.hp < st.maxHp * 0.45) { const p = slotOf(s, 4335); if (p) { s.send({ id: IT.UseItem, slot: p.slot, fromInventory: true, counter: 0 } as ClientPacket); await s.sleep(500); } } }
/** Chases one creature (by char index) and swings at it until it is gone. Returns the exp gained and the swings. */
async function fight(s: Sess, target: number, maxMs = 150_000) {
  // a creature the GM just spawned reaches the player's view a moment after the GM's: wait for its CharacterCreate first
  await s.until(() => s.chars.has(target), 6000, `creature ${target} in view`).catch(() => undefined);
  const t0 = Date.now(), exp0 = s.stats!.experience, lvl0 = s.stats!.level, m0 = s.mark(); let swings = 0; const trace: string[] = []; const refused = new Set<number>();
  while (s.chars.has(target) && Date.now() - t0 < maxMs) {
    const t = s.chars.get(target)!, d = Math.abs(t.x - s.x) + Math.abs(t.y - s.y);
    if (trace.length < 40) trace.push(`${s.x},${s.y}>${t.x},${t.y}:${s.stats?.hp}/${s.stats?.stamina}`);
    await healIfLow(s);
    if (d === 1) {
      face(s, headingTo(s.x, s.y, t.x, t.y)); await s.sleep(120);
      if ((s.stats?.stamina ?? 0) < 10) { await s.sleep(3000); continue; } // UsuarioAtaca refuses under 10 stamina (Msg93, SUR-13): wait for RecStamina
      s.send({ id: CB.Attack, counter: 0 } as ClientPacket); swings++; await s.sleep(1150);
    } else {
      const f = loadMap(s.map)!.map, avoid = new Set([...occupied(s), ...exitTiles(s.map), ...refused]);
      const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [t.x + dx!, t.y + dy!] as [number, number]).filter(([x, y]) => walkable(f, x, y) && !avoid.has(y * 101 + x)).sort((a, b) => (Math.abs(a[0] - s.x) + Math.abs(a[1] - s.y)) - (Math.abs(b[0] - s.x) + Math.abs(b[1] - s.y)));
      let route: number[] | undefined; for (const a of adj) { route = bfs(f, [s.x, s.y], a, avoid); if (route?.length) break; }
      if (!route || !route.length) { await s.sleep(600); continue; }
      for (const h of route.slice(0, 2)) { const r = await s.step(h as 1 | 2 | 3 | 4, 230); if (!r.moved) { const [dx, dy] = DIRS[h]!; refused.add((s.y + dy) * 101 + s.x + dx); break; } }
      if (refused.size > 30) refused.clear();
    }
    if ((s.stats?.hp ?? 1) <= 0) break;
  }
  trace.push(s.chars.has(target) ? (Date.now() - t0 >= maxMs ? 'timeout' : `hp ${s.stats?.hp}`) : 'gone');
  await s.sleep(800);
  // CharacterRemove also comes when a creature walks out of view: a kill is a removal WITH exp gained
  const gained = s.stats!.level > lvl0 || s.stats!.experience > exp0;
  // each natural skill-up adds 5 x ExpMult exp (SubirSkill, Msg140 with the amount): kept apart from the kill's exp
  const skillUpExp = s.localeSince(m0).filter(l => l.id === 140).reduce((n, l) => n + Number(l.text), 0);
  const hits = s.since(m0).filter(r => r.name === 'UpdateExp').length - s.localeSince(m0).filter(l => l.id === 140).length;
  return { killed: !s.chars.has(target) && gained, trace: trace.join(' '), swings, hits, skillUpExp, skillUps: s.localeSince(m0).filter(l => l.id === 1626).map(l => l.text), exp: s.stats!.level === lvl0 ? s.stats!.experience - exp0 - skillUpExp : NaN };
}
/** The GM helper spawns ONE creature on a walkable tile right next to the player (its own tile), then the player fights it. Only that creature is ever killed. */
async function spawnNext(c: Ctx, s: Sess, npc: number) {
  const f = loadMap(s.map)!.map, occ = occupied(s), ring: [number, number][] = [];
  for (let r = 1; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.abs(dx) + Math.abs(dy) === r) ring.push([s.x + dx, s.y + dy]);
  const spot = ring.find(([x, y]) => walkable(f, x, y) && !occ.has(y * 101 + x) && !exitTiles(s.map).includes(y * 101 + x));
  if (!spot) throw new Error(`no free tile next to the player at ${s.x},${s.y}`);
  await gmGoto(c, s.map, spot[0], spot[1]); return spawnCreature(c, npc);
}
async function questDetails(s: Sess, slot = 1) { const m = s.mark(); s.send({ id: Q.QuestDetailsRequest, slot } as unknown as ClientPacket); return await s.waitFor('QuestDetails', m, 5000) as { questIndex: number; npcs: { amount: number; npcIndex: number; killed: number }[] }; }
async function questList(s: Sess) { const m = s.mark(); s.send({ id: Q.QuestListRequest } as unknown as ClientPacket); return (await s.waitFor('QuestListSend', m, 5000)).quests as number[]; }
const text = (s: Sess, from = 0) => s.rx.slice(from).map(r => JSON.stringify(r.packet)).join('\n');

// ---- the newbie path ----
step('NWB-01', async c => {
  const n = await nb(c), s = n.s;
  if (!n.fresh) c.blocked('the newbie character was reused (AO_NEWBIE_FRESH=0): creation and the welcome text need a fresh one');
  const cm = n.created.find(r => r.name === 'ChangeMap')!.packet as any;
  c.eq(cm.map, CITY.map, `home byte ${CITY.id} (${CITY.name}): spawn map`);
  c.eq([s.x, s.y], [CITY.x, CITY.y], `spawn tile = Ciudades.Dat [${CITY.name}]`);
  c.eq(s.stats!.level, 1, 'ELV 1'); c.eq(s.stats!.experience, 0, 'Exp 0');
  const welcome = n.created.map(r => JSON.stringify(r.packet)).join('\n');
  c.ok(welcome.includes(MOTD.rates), `the MOTD rates line says "${MOTD.rates}"`);
  c.ok(welcome.includes(MOTD.newbie), `the MOTD points to the Newbie Dungeon ("${MOTD.newbie}...", windows-1252 decoded)`);
  c.ok(welcome.includes(MOTD.board), 'the MOTD points to the Cartelera and Makrom');
  c.fixture('newbie-create-motd', s, 0);
});

step('NWB-02', async c => {
  const n = await nb(c), s = n.s;
  if (s.map !== CITY.map) c.blocked(`the newbie stands on map ${s.map}, not in ${CITY.name}`);
  await approach(s, CARTELERA.x, CARTELERA.y);
  const board = charNamed(s, /Cartelera/i); c.ok(!!board, `the Cartelera is on screen (${board?.name} at ${board?.x},${board?.y})`);
  const m = s.mark(); s.send({ id: DOOR.LeftClick, x: board!.x, y: board!.y, counter: 0 } as ClientPacket);
  const list = (await s.waitFor('NpcQuestListSend', m, 5000)).quests as { questIndex: number; state: number; requiredLevel: number }[];
  c.eq(list.map(q => q.questIndex), [190, 191, 192, 193, 194, 4, 154, 163, 164, 165], 'the board offers Makrom\'s 190-194, quest 4, then its own 154/163/164/165');
  const st190 = list.find(q => q.questIndex === 190)!.state;
  // FinishQuest records EVERY finished quest in quest_done ("aunque sea repetible"), so a character that already handed 190 in sees state 2 (done);
  // CanUserAcceptQuest skips the done check for Repetible=1, so it can take it again.
  if (n.fresh) c.eq(st190, 0, 'quest 190 available (state 0)'); else c.ok([0, 2].includes(st190), `quest 190 state ${st190} for a character that may have finished it (Repetible=1: shown done, still acceptable)`);
  c.ok(list.filter(q => [191, 192, 193, 194].includes(q.questIndex)).every(q => q.state !== 0), `191-194 not available at level 1 (states ${list.filter(q => q.questIndex > 190 && q.questIndex < 195).map(q => q.state).join(',')})`);
  const a = s.mark(); s.send({ id: Q.QuestAccept, slot: list.findIndex(q => q.questIndex === 190) + 1 } as unknown as ClientPacket); await s.sleep(1500);
  c.ok(s.localeSince(a).some(l => l.id === 1264), 'QuestAccept answered Msg1264 "Has aceptado la misión"');
  c.eq(await questList(s), [190], 'the quest log holds 190');
  const d = await questDetails(s); c.eq(d.npcs.map(x => [x.npcIndex, x.amount, x.killed]), Q190.npcs.map(([npc, amt]) => [npc, amt, 0]), 'quest 190 asks 2 Hormigas, 7 Murciélagos, 10 Serpientes, 8 Gallos; none killed');
  c.fixture('newbie-cartelera-accept-190', s, m);
});

step('NWB-03', async c => {
  const n = await nb(c), s = n.s;
  if (s.map !== CITY.map) c.blocked(`the newbie stands on map ${s.map}`);
  const m = s.mark();
  await walk(s, DOOR_TO_DUNGEON.x, DOOR_TO_DUNGEON.y, 0);
  await s.until(() => s.map === DUNGEON.map, 6000, 'ChangeMap to the Newbie Dungeon').catch(() => undefined);
  c.eq(s.map, DUNGEON.map, `walking onto the door at ${CITY.map}:${DOOR_TO_DUNGEON.x},${DOOR_TO_DUNGEON.y} entered the Newbie Dungeon (map ${DUNGEON.map})`);
  c.eq([s.x, s.y], [DUNGEON.x, DUNGEON.y], 'arrival tile = the door\'s exit');
  c.note(`map name "${loadMap(DUNGEON.map)!.name}", ${[...s.chars.values()].filter(x => x.npc === 1).length} creatures in view`);
  c.fixture('newbie-enter-dungeon', s, m);
});

step('NWB-04', async c => {
  const n = await nb(c), s = n.s;
  if (s.map !== DUNGEON.map) c.blocked(`the newbie is not in the Newbie Dungeon (map ${s.map})`);
  if ((s.stats?.hp ?? 0) <= 0) return c.blocked('the newbie is dead (a creature killed it earlier)');
  const before = await questDetails(s), m = s.mark();
  // ONE Hormiga (Newbie Dungeon NPC 508, a quest-190 target) that the GM helper spawns right next to the player, then removes if it survives.
  // A natural creature is the fallback: on a busy dungeon a level-1 warrior chasing one is often swarmed (stamina under 10 stops the swings)
  // and dies, which is real play but makes the step a coin toss.
  let result: Awaited<ReturnType<typeof fight>> | undefined, who = 'Hormiga';
  const spawned = await spawnNext(c, s, 508);
  try { result = await fight(s, spawned.charIndex, 90_000); } finally { await killMine(c, spawned); }
  c.note(`the GM helper spawned one Hormiga (char ${spawned.charIndex}) next to the player; removed afterwards if alive`);
  if (!result.killed && (s.stats?.hp ?? 0) > 0) { const t = questTargets(s)[0]; if (t) { who = creatureOf(t.body)!; result = await fight(s, t.charIndex, 60_000); c.note(`fallback: a natural ${who}`); } }
  c.ok(result!.killed, `killed a ${who} after ${result!.swings} swings (route ${result!.trace})`);
  const kind = CREATURES[who]!;
  c.fixture('newbie-first-kill', s, m);
  if (Number.isFinite(result!.exp)) {
    // GetExpForUser floats "+N" over the player for every exp grant (WriteTextOverTile): the kill's exp is their sum
    const floated = s.since(m).filter(r => r.name === 'TextOverTile' && /^\+/.test(String((r.packet as any).text))).map(r => Number(String((r.packet as any).text).replace(/\D/g, '')));
    c.note(`floating exp texts ${floated.join(',')} (sum ${floated.reduce((a, b) => a + b, 0)}); skill-up bonus ${result!.skillUpExp} (Msg140) counted apart`);
    // x4 is unmistakable (x1 would give about 11). The total is not exactly 44: NpcList().flags.ExpCount is a Long (Declares.bas), so each grant's
    // fractional ExpaDar is subtracted with rounding, and each grant is itself rounded into the Long Exp. A newbie hitting an 8-HP Hormiga for 1 per hit
    // gets 1 x 11 / 8 = 1.375 -> x4 = 5.5 -> 6 per hit for 8 hits, then a remainder: 51 in three live runs (VB6 integer rounding, server side).
    c.ok(result!.exp >= kind.giveExp * EXP_MULT - result!.hits / 2, `exp for the kill ${result!.exp} >= GiveEXP ${kind.giveExp} x ExpMult ${EXP_MULT} = ${kind.giveExp * EXP_MULT} (EXP x4 is live; ${result!.hits} exp grants)`);
    c.eq(result!.exp, floated.reduce((a, b) => a + b, 0), 'the exp gained equals the sum of the floating +N texts the client shows');
  } else c.note('the kill crossed a level: exp delta not compared');
  const after = await questDetails(s), i = Q190.npcs.findIndex(([npc]) => npc === kind.npc);
  c.eq(after.npcs[i]!.killed, before.npcs[i]!.killed + 1, `quest 190 counter for NPC ${kind.npc} ticked`);
  c.shared.nbKills = after.npcs.map(x => x.killed);
  { // skills rise by use only up to the level's natural cap (SubirSkill maxPermitido: 3 at level 1, 5 at 2)
    const lvl = s.stats!.level, cap = lvl % 2 === 0 ? Math.floor(lvl / 2) * 5 : Math.floor(lvl / 2) * 5 + 3 - Math.floor((Math.floor((lvl - 1) / 2) * 5) % 10 / 5);
    const sk = await skills(s); c.ok(sk.every(v => v <= cap), `no skill above the level-${lvl} natural cap ${cap} after fighting (${sk.map((v, i) => v ? `${i}:${v}` : '').filter(Boolean).join(' ') || 'all 0'})`);
  }
  if (result!.skillUps.length) c.note(`skills rose by use during the fight: ${result!.skillUps.join(' | ')} (+${result!.skillUpExp} exp = 5 x ExpMult each)`);
});

step('NWB-05', async c => {
  const n = await nb(c);
  if (!(await questList(n.s)).includes(190)) c.blocked('the newbie does not hold quest 190 (NWB-02 failed)');
  // HARNESS SHORTCUT: the other 26 kills are written to the logged-out character's quest row (format read back first), and it is placed on the
  // dungeon side of the exit; the turn-in itself is the real one (walk out, click Makrom).
  const id = userId(n);
  const s0 = n.s, pm = s0.mark(); s0.say('/SALIR'); await s0.until(() => s0.closed || s0.rx.slice(pm).some(r => r.name === 'Disconnect'), 25_000).catch(() => undefined); s0.close();
  let free = false; for (let i = 0; i < 20 && !free; i++) { free = sql(`select is_logged from user where id=${id};`) === '0'; if (!free) await new Promise(r => setTimeout(r, 3000)); }
  if (!free) { await relog(c); c.blocked('is_logged stayed 1'); }
  const row = sql(`select number, npcs from quest where user_id=${id} and quest_id=190;`), [num, npcs] = row.split('|');
  c.note(`stored progress "${npcs}" (slot ${num})`);
  let k = 0; const full = npcs!.replace(/\d+/g, () => String(Q190.npcs[k++]?.[1] ?? 0));
  if (k !== Q190.npcs.length) { await relog(c); throw new Error(`unexpected quest progress format "${npcs}"`); }
  sql(`update quest set npcs='${full}' where user_id=${id} and number=${num};`);
  sql(`update user set is_dead=0, min_hp=20, pos_map=${DUNGEON.map}, pos_x=50, pos_y=32 where id=${id} and is_logged=0;`); // alive: creatures may have killed it on the way
  await relog(c);
  const s = n.s, d = await questDetails(s);
  c.eq(d.npcs.map(x => x.killed), Q190.npcs.map(([, a]) => a), 'all four counters complete after the relog');
  await walk(s, 50, 33, 0); await s.until(() => s.map === CITY.map, 6000, 'back in the city').catch(() => undefined);
  c.eq(s.map, CITY.map, 'the dungeon exit (168:50,33) leads back to Ullathorpe');
  const mk = charNamed(s, /Makrom/i); c.ok(!!mk, `Makrom is on screen at ${mk?.x},${mk?.y} (map spawn ${MAKROM_NEAR_DOOR.x},${MAKROM_NEAR_DOOR.y})`);
  await approach(s, mk!.x, mk!.y);
  const cur = s.chars.get(mk!.charIndex) ?? mk!, gold0 = s.stats!.gold, exp0 = s.stats!.experience, lvl0 = s.stats!.level, sta0 = s.stats!.maxStamina, m = s.mark();
  c.shared.nbBefore = { gold0, exp0, lvl0, sta0, m };
  s.send({ id: DOOR.LeftClick, x: cur.x, y: cur.y, counter: 0 } as ClientPacket); await s.sleep(2500);
  c.ok(text(s, m).includes(`QUESTFIN*${Q190.id}`), 'Makrom answered ChatOverHead QUESTFIN*190 (FinishQuest)');
  c.eq(s.stats!.gold - gold0, Q190.gold, `gold reward = RewardGLD ${Q190.gold} x OroMult 1`);
  c.eq(await questList(s), [], 'the quest log is empty after the turn-in');
  c.fixture('newbie-turn-in-190', s, m);
});

step('NWB-06', async c => {
  const n = await nb(c), s = n.s, b = c.shared.nbBefore as { gold0: number; exp0: number; lvl0: number; sta0: number; m: number } | undefined;
  if (!b) return c.blocked('needs the quest turn-in (NWB-05)');
  // CheckUserLevel: exp += RewardEXP x ExpMult; while exp >= ExpLevelUp[ELV]: exp -= it, ELV += 1
  let lvl = b!.lvl0, exp = b!.exp0 + Q190.exp * EXP_MULT; while (lvl < 12 && exp >= EXP_LEVEL_UP[lvl]!) { exp -= EXP_LEVEL_UP[lvl]!; lvl++; }
  c.ok(s.since(b!.m).some(r => r.name === 'LevelUp'), 'the turn-in sent LevelUp');
  c.eq(s.stats!.level, lvl, `ELV after +${Q190.exp * EXP_MULT} exp (RewardEXP ${Q190.exp} x ${EXP_MULT}) from ${b!.exp0} at level ${b!.lvl0}`);
  c.eq(s.stats!.experience, exp, 'the surplus exp carries over');
  c.eq(s.stats!.maxStamina - b!.sta0, 15 * (lvl - b!.lvl0), 'MaxSta +15 per level (AumentoSta)');
  c.note(`MaxHP ${s.stats!.maxHp} at level ${lvl}`);
});

// PRG-06 and PRG-07 on the same character: points per level, assigned later.
step('PRG-06', async c => {
  const n = await nb(c), s = n.s, b = c.shared.nbBefore as { m: number; lvl0: number } | undefined;
  if (!b) return c.blocked('needs the newbie level-up (NWB-05/06)');
  const lu = s.since(b.m).filter(r => r.name === 'LevelUp').pop()?.packet as { skillPoints: number } | undefined;
  const gained = s.stats!.level - b.lvl0;
  c.eq(lu?.skillPoints, 10 + 5 * gained, `free skill points = 10 at creation + 5 x ${gained} level(s) (LevelSkillPoints, not added to skills)`);
  c.shared.nbFree = lu?.skillPoints;
});
step('PRG-07', async c => {
  const n = await nb(c), s = n.s, free = c.shared.nbFree as number | undefined;
  if (!free) return c.blocked('needs PRG-06');
  const before = await skills(s), pts = new Array(before.length).fill(0); pts[SKILL.Armas] = 4; pts[SKILL.Tacticas] = 3;
  s.send({ id: SK.ModifySkills, points: pts } as unknown as ClientPacket); await s.sleep(1500);
  const after = await skills(s);
  c.eq([after[SKILL.Armas]! - before[SKILL.Armas]!, after[SKILL.Tacticas]! - before[SKILL.Tacticas]!], [4, 3], 'assigned 4 to Armas and 3 to Tacticas');
  c.ok(after[SKILL.Armas]! > 0, `Armas ${after[SKILL.Armas]} may exceed the natural cap of level ${s.stats!.level} (assigned points have no per-level cap)`);
  await dbNb(c); // a clean /SALIR (the server saves) and a relog; a bare socket close would log back in from the last save
  const lu = n.s.rx.filter(r => r.name === 'LevelUp').pop()?.packet as { skillPoints: number } | undefined;
  c.eq(lu?.skillPoints, free - 7, 'the 7 spent points are gone from the free pool after a relog');
});

step('ECO-20', async c => {
  const n = await nb(c), s = n.s, g = c.gm;
  if (s.map !== CITY.map) c.blocked(`the newbie is on map ${s.map}`);
  await gmGoto(c, s.map, s.x + 2, s.y);
  const say = `hola desde el playthrough ${letters(4)}`, m = g.mark(), ms = s.mark(); s.say(say); await s.sleep(1500);
  const heard = g.since(m).find(r => JSON.stringify(r.packet).includes(say));
  c.ok(!!heard, `a character 2 tiles away received the talk (${heard?.name})`);
  c.eq((heard?.packet as any)?.charIndex, s.charIndex, 'over the speaker\'s char index');
  c.ok(s.since(ms).some(r => JSON.stringify(r.packet).includes(say)), 'the speaker sees its own bubble');
  // HandleWhisper: "If CompararPrivilegios(sender, target) < 0 Then Exit Sub": a player's whisper to a GM is dropped without a word (server rule).
  // The other way round reaches the player as ConsoleCharText, and the sender's head shows it only to GMs (ToSuperioresArea).
  const psst = `psst ${letters(4)}`, m2 = g.mark(), sm2 = s.mark(); s.say(`\\${c.gmName} ${psst}`); await s.sleep(1500);
  c.ok(!g.since(m2).some(r => r.name === 'ConsoleCharText' && JSON.stringify(r.packet).includes(psst)), `a player's whisper to the GM ${c.gmName} is not delivered (CompararPrivilegios < 0)`);
  c.ok(!s.since(sm2).some(r => r.name === 'ConsoleCharText'), 'and the sender gets no echo either');
  const back = `hola novato ${letters(4)}`, m3 = s.mark(); g.say(`\\${n.name} ${back}`); await s.sleep(1500);
  const w = s.since(m3).find(r => r.name === 'ConsoleCharText' && JSON.stringify(r.packet).includes(back));
  c.ok(!!w, `the GM's whisper reached the player as ConsoleCharText from ${(w?.packet as any)?.sourceName}`);
  c.fixture('newbie-talk-whisper', s, ms);
});

step('ECO-05', async c => {
  const n = await nb(c), s = n.s;
  if (s.map !== CITY.map) c.blocked(`the newbie is on map ${s.map}`);
  const gold = s.stats!.gold; if (gold < 20) c.blocked(`the newbie has only ${gold} gold (needs the quest reward)`);
  // Ullathorpe's bank hall (banker Krix 77,47) is closed by a door at 77,55: like a player, click the door from the side (never from the tile right
  // below it, see approach()), then walk in.
  // a door toggles (HandleDoorAction): another player may have left it open, so try the doorway first and click only when it is shut
  await walk(s, 76, 56, 0); let clicks = 0, opened = false; const answers: string[] = [];
  for (let k = 0; k < 3 && s.y > 54; k++) {
    if (s.x !== 77) { await s.step(2, 400); }
    const r = await s.step(1, 400);
    if (r.moved) { for (let i = 0; i < 5 && s.y > 51; i++) { if (!(await s.step(1, 400)).moved) break; } break; }
    if (s.x === 77) await s.step(4, 400); // back to 76,56: a click from the tile right below the door hits yourself
    const dm = s.mark(); s.send({ id: DOOR.LeftClick, x: 77, y: 55, counter: 0 } as ClientPacket); clicks++; await s.sleep(1200);
    const bp = s.since(dm).find(x => x.name === 'BlockPosition' && (x.packet as any).x === 77 && (x.packet as any).y === 55);
    answers.push(bp ? `sides ${(bp.packet as any).sides}` : 'no answer'); if (bp && (bp.packet as any).sides === 0) opened = true;
  }
  c.note(`door 77,55: ${clicks} click(s), answers ${answers.join(' / ') || 'none (it was open)'}`);
  c.ok(s.y <= 54, `walked through the opened door into the bank hall (at ${s.x},${s.y}; door ${opened ? 'opened by a click' : clicks ? 'see note' : 'already open'})`);
  const banker = charNamed(s, /Krix|Banquer/i); c.ok(!!banker, `the banker is on screen (${banker?.name} at ${banker?.x},${banker?.y})`);
  await approach(s, banker!.x, banker!.y, 3);
  const m = s.mark(); s.send({ id: DOOR.LeftClick, x: banker!.x, y: banker!.y, counter: 0 } as ClientPacket); await s.sleep(1500);
  // IniciarBanco = WriteGoliathInit: a click on the banker opens frmGoliath (gold in/out); its Bóveda button (BankStart) opens the item vault (BankInit)
  c.ok(s.since(m).some(r => r.name === 'Goliath'), `clicking the banker opened frmGoliath (Goliath) (got ${[...new Set(s.since(m).map(r => r.name))].filter(x => !/Move|Hunger/.test(x)).join(',')})`);
  { const v = s.mark(); s.send({ id: BK.BankStart } as unknown as ClientPacket); await s.sleep(1500); c.ok(s.since(v).some(r => r.name === 'BankInit'), 'the Bóveda button (BankStart) opened the vault (BankInit)'); }
  const put = gold - (gold % 10 || 0) - 10, d = s.mark(); s.send({ id: BK.BankDepositGold, amount: put } as unknown as ClientPacket); await s.sleep(1500);
  const bank = s.since(d).filter(r => r.name === 'UpdateBankGld').pop()?.packet as any;
  c.eq(s.stats!.gold, gold - put, `deposited ${put}: gold ${gold} -> ${gold - put}`);
  c.ok(text(s, d).includes('1418'), 'the banker said Msg1418 "Tenés N monedas de oro en tu cuenta"');
  const inBank = Object.values(bank ?? {}).find(v => typeof v === 'number' && v >= put) as number | undefined; c.ok(inBank !== undefined, `UpdateBankGld ${JSON.stringify(bank)}`);
  const e = s.mark(); s.send({ id: BK.BankExtractGold, amount: put } as unknown as ClientPacket); await s.sleep(1500);
  c.eq(s.stats!.gold, gold, `withdrew ${put} again: gold back to ${gold}`);
  s.send({ id: BK.BankEnd } as unknown as ClientPacket); await s.sleep(500);
  c.fixture('newbie-bank-gold', s, m); void e;
});

step('DTH-02', async c => {
  const n = await nb(c);
  // a newbie dies on an unsafe field map carrying a non-newbie item (5 Manzana Roja, obj 1) and gold above 1000 x ELV: TirarTodosLosItems drops the
  // apples and the excess gold, keeps every Newbie=1 item (EsNewbie) and the first OroPorNivelBilletera x ELV gold.
  const f = loadMap(2)!.map; let spot: [number, number] | undefined;
  for (let r = 0; r < 40 && !spot; r++) for (let y = 50 - r; y <= 50 + r && !spot; y++) for (let x = 50 - r; x <= 50 + r && !spot; x++) if ([[0, 0], [1, 0], [2, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => walkable(f, x + dx!, y + dy!))) spot = [x, y];
  const lvl = n.s.stats!.level, gold = BILLETERA * lvl + 600;
  const empty = sql(`select min(number) from inventory_item where user_id=${userId(n)} and item_id=0;`) || '20';
  await dbNb(c, `update user set pos_map=2, pos_x=${spot![0]}, pos_y=${spot![1]}, min_hp=1, gold=${gold} where id={id} and is_logged=0;`, `update inventory_item set item_id=1, amount=5, is_equipped=0 where user_id={id} and number=${empty};`);
  // a wild creature may kill the 1 HP newbie before the GM's Gallo arrives: then the death is already in the login stream, which is read from its start
  const s = n.s, login = s.rx.filter(r => r.name === 'ChangeInventorySlot').map(r => r.packet as any), stats0 = s.rx.find(r => r.name === 'UpdateUserStats')?.packet as any;
  c.eq([s.map, stats0?.gold, stats0?.hp], [2, gold, 1], 'logged in on map 2 with 1 HP and the gold');
  c.ok(login.some(i => i.object === 1 && i.amount === 5), `5 Manzana Roja in slot ${empty}`);
  const newbieItems = [...new Set(login.filter(i => i.object > 1).map(i => i.object as number))];
  const already = (s.stats?.hp ?? 1) <= 0, from = already ? 0 : s.mark(); let died = already, mine: Awaited<ReturnType<typeof spawnCreature>> | undefined;
  if (already) c.note('a wild creature on map 2 killed the newbie right after login (no GM spawn needed)');
  for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2]] as const) {
    if (died) break;
    await gmGoto(c, 2, s.x + dx, s.y + dy); mine = await spawnCreature(c, 501);
    try { await s.until(() => (s.stats?.hp ?? 1) <= 0, 25_000, 'HP 0').then(() => { died = true; }).catch(() => undefined); } finally { await killMine(c, mine); }
  }
  c.ok(died, 'a creature killed the 1 HP newbie');
  await s.sleep(2000);
  const dropped = s.since(from).filter(r => r.name === 'ObjectCreate').map(r => r.packet as any);
  c.ok(dropped.some(o => o.amount === 5), `the 5 apples fell to the floor (ObjectCreate ${JSON.stringify(dropped.map(o => [o.x, o.y, o.objIndex, o.amount]))})`);
  c.ok(!slotOf(s, 1), 'the apples left the inventory');
  const kept = newbieItems.filter(o => slotOf(s, o)); c.eq(kept.length, newbieItems.length, `the ${newbieItems.length} newbie items stayed (${newbieItems.join(',')})`);
  c.shared.nbDeath = { from, dropped, lvl, gold };
  c.fixture('newbie-death-drops', s, from);
});
step('DTH-03', async c => {
  const n = await nb(c), s = n.s, d = c.shared.nbDeath as { dropped: any[]; lvl: number; gold: number } | undefined;
  if (!d) return c.blocked('needs DTH-02');
  c.eq(s.stats!.gold, BILLETERA * d.lvl, `kept OroPorNivelBilletera ${BILLETERA} x ELV ${d.lvl} gold`);
  c.ok(d.dropped.some(o => o.amount === d.gold - BILLETERA * d.lvl), `the ${d.gold - BILLETERA * d.lvl} excess gold fell as a pile`);
  // tidy up: revive in place through the DB, pick the apples and the gold back up, return to the city
  await dbNb(c, 'update user set is_dead=0, min_hp=20 where id={id} and is_logged=0;');
  const p = n.s; let picked = 0;
  for (const o of d.dropped) { try { await walk(p, o.x, o.y, 0, 30); const m = p.mark(); p.send({ id: IT.PickUp, x: o.x, y: o.y, slot: 0 } as unknown as ClientPacket); await p.sleep(900); if (p.since(m).some(r => r.name === 'ObjectDelete' || r.name === 'ChangeInventorySlot' || r.name === 'UpdateGold')) picked++; } catch { /* a blocked tile: leave it */ } }
  c.note(`picked ${picked} of ${d.dropped.length} dropped piles back up`);
  await dbNb(c, `update user set is_dead=0, min_hp=20, min_sta=60, min_ham=100, min_sed=100, pos_map=${CITY.map}, pos_x=${CITY.x}, pos_y=${CITY.y}, gold=0 where id={id} and is_logged=0;`, `update inventory_item set item_id=0, amount=0 where user_id={id} and item_id=1;`);
});

step('NWB-07', async c => {
  const n = await nb(c);
  // graduation: level 12 with exp just under ExpLevelUp[12] = 43248, standing in the Newbie Dungeon; one kill crosses 13. The -c server's
  // QuitarNewbieObj removes the Newbie=1 items and, only because the character is on a newbie map, sends it to its home city.
  await dbNb(c, `update user set is_dead=0, min_hp=20, min_sta=60, min_ham=100, min_sed=100, level=12, exp=${EXP_LEVEL_UP[12]! - 10}, pos_map=${DUNGEON.map}, pos_x=${DUNGEON.x}, pos_y=${DUNGEON.y} where id={id} and is_logged=0;`);
  const s = n.s; c.eq([s.stats!.level, s.map], [12, DUNGEON.map], 'level 12 in the Newbie Dungeon (DB)');
  const id = userId(n), newbie = [...new Set([...s.inventory.values()].map(i => i.object).concat(sql(`select item_id from inventory_item where user_id=${id} and item_id>0;`).split(/\s+/).filter(Boolean).map(Number)))];
  c.note(`inventory before: ${newbie.join(',')}`);
  const m = s.mark(); let spawned: Awaited<ReturnType<typeof spawnCreature>> | undefined;
  const t = questTargets(s)[0];
  let r = t ? await fight(s, t.charIndex, 120_000) : undefined;
  if (!r?.killed && s.map === DUNGEON.map) { spawned = await spawnNext(c, s, 508); try { r = await fight(s, spawned.charIndex, 90_000); } finally { await killMine(c, spawned); } }
  c.note(`fight: ${JSON.stringify(r)}, exp now ${s.stats!.experience}/${EXP_LEVEL_UP[12]}, hp ${s.stats!.hp}, map ${s.map}`);
  await s.until(() => s.stats!.level >= 13, 8000, 'level 13').catch(() => undefined);
  c.eq(s.stats!.level, 13, 'one kill crossed level 13');
  c.ok(s.localeSince(m).some(l => l.id === 671), 'Msg671 "Has dejado de ser Newbie"');
  await s.sleep(2000);
  c.eq(s.map, CITY.map, `graduating inside a newbie map sent the character home (${CITY.name})`);
  c.near(Math.abs(s.x - CITY.x) + Math.abs(s.y - CITY.y), 0, 2, `landed at ${s.x},${s.y}: the ${CITY.name} spawn ${CITY.x},${CITY.y} or the closest free tile (the -c patch uses WarpToLegalPos)`);
  await s.sleep(1000); const after = sql(`select item_id from inventory_item where user_id=${id} and item_id>0;`);
  const gone = newbie.filter(o => !slotOf(s, o)); c.ok(gone.length > 0, `QuitarNewbieObj removed the newbie items (${gone.join(',')}); left: ${[...s.inventory.values()].map(i => i.object).join(',') || 'nothing'}; DB after the save: ${after.replace(/\s+/g, ',') || 'nothing'}`);
  c.fixture('newbie-graduation', s, m);
});

// MOV-05 on the graduate: the Newbie Dungeon door now refuses it (CheckMapRestrictions: MapInfo.Newbie And Not EsNewbie -> Msg771, no warp).
step('MOV-05', async c => {
  const n = await nb(c), s = n.s;
  if (s.stats!.level < 13 || s.map !== CITY.map) return c.blocked(`needs the graduate (level 13 in ${CITY.name}); it is level ${s.stats!.level} on map ${s.map}`);
  await walk(s, DOOR_TO_DUNGEON.x, DOOR_TO_DUNGEON.y + 1, 0);
  const m = s.mark(); await s.step(1, 700); await s.sleep(1200);
  c.eq(s.map, CITY.map, 'a level-13 character stepping on the dungeon door stays in the city');
  c.ok(s.localeSince(m).some(l => l.id === 771), `Msg771 "Sólo los newbies pueden entrar a este mapa" (got ${s.localeSince(m).map(l => l.id).join(',') || 'nothing'})`);
  c.fixture('newbie-graduate-refused', s, m);
});

// The real browser client: the same character enters through the classic UI (login, character list, Jugar) and the client shows the welcome
// text and the world. Screenshot in artifacts/screenshots/playthrough-newbie-ui.png.
step('NWB-08', async c => {
  const n = await nb(c), page = c.page; if (!page) c.blocked('no Playwright page');
  n.s.say('/SALIR'); await n.s.sleep(1500); n.s.close(); await n.s.sleep(4000);
  await page!.goto(c.webBase);
  await page!.locator('#classic[data-ui-ready="true"]').waitFor({ timeout: 30_000 }).catch(() => undefined);
  await page!.locator('#email').fill(n.email); await page!.locator('#password').fill(n.password); await page!.locator('#connect').click();
  await page!.waitForTimeout(3000); await page!.mouse.click(248, 291); await page!.waitForTimeout(800); await page!.mouse.click(686, 729);
  await page!.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
  await page!.waitForTimeout(3000);
  mkdirSync(c.shots, { recursive: true }); await page!.screenshot({ path: `${c.shots}/playthrough-newbie-ui.png` });
  const msgs = await page!.locator('#messages').innerText();
  c.ok(msgs.includes('Dungeon Newbie'), 'the classic client\'s console shows the MOTD newbie line');
  c.ok(msgs.includes('X4'), 'and the X4 rates line');
  c.note('screenshot artifacts/screenshots/playthrough-newbie-ui.png');
  // a clean /SALIR from the UI (Ullathorpe is a safe map: instant), so the character is free for the next run
  await page!.keyboard.press('Enter'); await page!.keyboard.type('/SALIR'); await page!.keyboard.press('Enter'); await page!.waitForTimeout(3000);
  await page!.goto('about:blank');
});
