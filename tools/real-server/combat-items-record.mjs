// AGPL-3.0-or-later. Records the combat-items (wave 3) scenarios against the classic VB6 server with a GM character (Aotest).
// Usage: AO_EMAIL=... AO_PASSWORD=... node tools/real-server/combat-items-record.mjs <scenario> <out.jsonl>
// Credentials are required (no defaults). The account must be an Admin of the server (Server.ini Admin2=...), see docs/CONFORMANCE.md (gm/).
// Scenarios: paralysed-login, learn-spell-scroll, priest-revive (all need a DB set-up, see docs/DATA-PATCHES.md) and restore (re-creates native NPCs a cleanup killed).
// 🔴 KillNPCNoRespawn removes the SELECTED NPC, native ones included: this script only ever kills NPCs it spawned itself (none of the scenarios spawn any now).
import { Vb6Session, sleep, C, S, DC } from './bank-trade-session.mjs';
import {
  GmClientPacketId as G, ItemsClientPacketId as IC, CombatClientPacketId as CC, SpellClientPacketId as SC,
} from '../../packages/protocol/dist/index.js';

const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
const [scenario, out] = process.argv.slice(2);
const s = new Vb6Session({ email: need('AO_EMAIL'), password: need('AO_PASSWORD'), character: process.env.AO_CHAR });
await s.login(); await sleep(800);
const from = s.records.length;
const say = ms => sleep(ms);
const warp = (map, x, y) => s.send({ id: G.WarpChar, userName: 'YO', map, x, y });
const spawn = npcIndex => s.send({ id: G.CreateNPC, npcIndex });
// the session helper never forgets a character: drop the ones the server removed (CharacterRemove, id 43)
const npcs = () => { const gone = new Set(s.packets.filter(p => p.id === 43).map(p => p.charIndex)); return [...s.chars.values()].filter(c => (c.npc || c.npcNumber) && !gone.has(c.charIndex)); };
const nearestNpc = n => npcs().filter(c => !n || c.npcNumber === n).sort((a, b) => Math.hypot(a.x - s.pos.x, a.y - s.pos.y) - Math.hypot(b.x - s.pos.x, b.y - s.pos.y))[0];
const leftClick = (x, y) => s.send({ id: DC.LeftClick, x, y, counter: s.nextCounter('leftClick') });
const attack = () => s.send({ id: CC.Attack, counter: s.nextCounter('attack') });
const log = (...a) => console.log(...a);
const hp = () => s.last(S.UpdateHP)?.hp;

// Only NPCs THIS run spawned are ever killed (KillNPCNoRespawn on a native NPC removes it until the next server start).
const mine = new Set();
const spawnMine = async npcIndex => {
  const before = new Set(npcs().map(n => n.charIndex)); spawn(npcIndex); await say(1500);
  const fresh = npcs().filter(n => !before.has(n.charIndex) && n.npcNumber === npcIndex);
  fresh.forEach(n => mine.add(n.charIndex)); return fresh[0];
};
const current = n => n && npcs().find(c => c.charIndex === n.charIndex);
const kill = async n => { // select it (LeftClick), then GM /RMATA without respawn
  const cur = current(n); if (!cur || !mine.has(cur.charIndex)) return;
  leftClick(cur.x, cur.y); await say(500); s.send({ id: G.KillNPCNoRespawn }); await say(700);
};
const killAllMine = async () => { for (let i = 0; i < 8; i++) { const n = npcs().find(c => mine.has(c.charIndex)); if (!n) return; await kill(n); } };
const respawnSpawn = npcIndex => s.send({ id: G.CreateNPCWithRespawn, npcIndex });
const scenarios = {
  // The character is DEAD in the DB (is_dead=1, min_hp=0) next to the priest Juan XXI (NPC 1, map 1): select him (LeftClick) and /RESUCITAR; the server revives (UpdateHP, body/head change, console text).
  async 'priest-revive'() {
    await say(1500);
    log('npcs in view', npcs().map(n => [n.npcNumber, n.x, n.y, n.name]));
    const priest = nearestNpc(1); log('priest', priest && [priest.x, priest.y], 'me', s.pos);
    if (!priest) throw new Error('no priest in view');
    leftClick(priest.x, priest.y); await say(1200);
    s.send({ id: CC.Resucitate }); await say(3000);
    log('hp', hp());
  },
  // The spell scroll in slot 13 (amount set to 1 through the DB; UseItem exits when the amount is 0): the server teaches the spell (ChangeSpellSlot + console line) and consumes the scroll.
  async 'learn-spell-scroll'() { await say(2500); s.send({ id: IC.UseItem, slot: 13, fromInventory: true, counter: s.nextCounter('use') }); await say(3000); },
  // user.is_paralyzed = 1 in the DB (logged-out character): the login sends ParalizeOK, and ~20 s later the paralysis expires and the server sends it again (a toggle).
  async 'paralysed-login'() { await say(32000); },
  // Undo of a cleanup that killed native NPCs: /RACC (spawn with respawn) one of the same kind at each given 'map:x:y' (AO_RESTORE=2:50:40,...).
  async restore() {
    for (const spot of process.env.AO_RESTORE.split(',')) { const [m, x, y] = spot.split(':').map(Number); warp(m, x, y); await say(1800); respawnSpawn(Number(process.env.AO_NPC ?? 502)); await say(1200); log('restored at', spot, 'npcs near', npcs().filter(n => Math.hypot(n.x - x, n.y - y) < 4).map(n => [n.npcNumber, n.x, n.y])); }
    warp(1, 76, 54); await say(1500);
  },
  // Removes the NPCs of the given numbers around the character (cleanup after an aborted run).
};
if (!scenarios[scenario]) throw new Error(`scenarios: ${Object.keys(scenarios).join(', ')}`);
try { await scenarios[scenario](); } finally { // whatever happened: remove what this run spawned, take the GM off the attackable list, go home
  await killAllMine().catch(() => {}); warp(1, 76, 54); await sleep(1500); }
await sleep(1200);
if (out) s.save(out, 0);
const ids = new Map(); for (const r of s.records.slice(from)) ids.set(`${r.dir}${r.id}${r.name}`, (ids.get(`${r.dir}${r.id}${r.name}`) ?? 0) + 1);
console.log(scenario, 'records', s.records.length - from, [...ids].map(([k, v]) => `${k}x${v}`).join(' '));
s.close();
