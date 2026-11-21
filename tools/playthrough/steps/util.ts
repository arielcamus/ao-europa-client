// AGPL-3.0-or-later. Shared helpers for the playthrough steps.
import { SkillsClientPacketId as SK, GmClientPacketId as G } from '@ao/protocol';
import type { ClientPacket } from '@ao/protocol';
import type { Sess } from '../session.js';
import type { Ctx } from '../harness.js';

/**
 * The GM helper (Consejero/SemiDios) can only teleport ITSELF: HandleWarpChar refuses other players with MSG 948 unless the map is an event
 * map (the VB6 `And Consejero Or SemiDios` precedence). So the GM goes to the player ("YO"), never the reverse.
 */
export async function gmGoto(c: Ctx, map: number, x: number, y: number) {
  const g = c.gm, m = g.mark();
  g.gm(`/TELEP YO ${map} ${x} ${y}`);
  // a same-map warp may only produce CharacterRemove/Create or nothing the GM sees as its own: wait for the map, then a fixed settle
  await g.until(() => g.map === map, 8000, `GM on map ${map}`);
  await g.sleep(1800);
}
export async function attributes(s: Sess) {
  const m = s.mark(); s.send({ id: SK.RequestAtributes } as ClientPacket);
  return await s.waitFor('Atributes', m, 4000) as { strength: number; agility: number; intelligence: number; constitution: number; charisma: number };
}
export async function skills(s: Sess): Promise<number[]> {
  const m = s.mark(); s.send({ id: SK.RequestSkills } as ClientPacket);
  return (await s.waitFor('SendSkills', m, 4000)).skills;
}
export async function miniStats(s: Sess) {
  const m = s.mark(); s.send({ id: SK.RequestMiniStats } as ClientPacket);
  return await s.waitFor('MiniStats', m, 4000);
}
export const SKILL = { Magia: 0, Robar: 1, Tacticas: 2, Armas: 3, Meditar: 4, Apunalar: 5, Ocultarse: 6, Supervivencia: 7, Comerciar: 8, Defensa: 9, Liderazgo: 10, Proyectiles: 11, Wrestling: 12, Navegacion: 13 } as const;
/** GM /MOD <name> <option> <value>: option words are the VB6 ones (ELV, ORO, EXP, SKILLS ...). */
export const mod = (c: Ctx, name: string, option: string, value: string | number, extra = '') => c.gm.gm(`/MOD ${name} ${option} ${value}${extra ? ' ' + extra : ''}`);
export { G };

import { execFileSync } from 'node:child_process';
/**
 * Test-data UPDATE on the shared server DB for a LOGGED-OUT own test character (brief rule: UPDATEs only, own character). The GM helper
 * cannot edit or teleport other players, so position/level changes of the harness character go through the DB. Configure with
 * AO_DB_SSH ("user@host") / AO_DB_SSH_PORT / AO_DB_SSH_KEY / AO_DB_CLI (sqlite3 path on the server host).
 */
export function sql(statement: string): string {
  const key = process.env.AO_DB_SSH_KEY ?? `${process.env.HOME}/Projects/ao-reference/runtime/ao-vm/id_ed25519`;
  const cli = process.env.AO_DB_CLI ?? 'C:\\ao\\sqlite-cli\\sqlite3.exe C:\\ao\\server-9ccd\\Database.db';
  return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'StrictHostKeyChecking=no', '-o', 'LogLevel=ERROR', '-i', key, '-p', process.env.AO_DB_SSH_PORT ?? '2222', process.env.AO_DB_SSH ?? 'aobuilder@127.0.0.1', `${cli} "${statement}"`], { encoding: 'utf8', timeout: 30_000 }).trim();
}
/** Log the own character out, run `UPDATE user SET <set> WHERE id = <id>`, log back in. Returns after the settle. */
export async function dbUpdateOwn(c: Ctx, set: string) {
  if (!c.own) c.blocked('DB updates are only done on the harness\'s own character');
  const id = c.player.characters.find(ch => ch.name === c.charName)!.id;
  // a clean /SALIR (countdown, or at once on a safe map) makes the server save and clear is_logged; a dropped socket leaves it set for minutes
  const p0 = c.player, pm = p0.mark(); p0.say('/SALIR');
  await p0.until(() => p0.closed || p0.rx.slice(pm).some(r => r.name === 'Disconnect'), 25_000, 'logout').catch(() => undefined);
  p0.close();
  let free = false;
  for (let i = 0; i < 20 && !free; i++) { free = sql(`select is_logged from user where id=${id};`) === '0'; if (!free) await new Promise(r => setTimeout(r, 3000)); }
  if (free) sql(`update user set ${set} where id=${id} and is_logged=0;`);
  await c.relogin();
  if (!free) c.blocked(`the server kept character ${id} flagged is_logged=1 for 60 s after the socket closed, so the DB UPDATE (${set}) was not applied`);
}
/** First MOV step needs dry land: a new character spawns at sea on 517 until fix/home-city. Memoised. */
export async function ensureLand(c: Ctx) {
  if (!c.own) return;
  if (c.player.map !== 517) return; // the Forgat data patch spawns characters on land (751); only the unpatched 517 spawn is at sea
  if (c.shared.landBlocked) c.blocked(String(c.shared.landBlocked));
  try { await dbUpdateOwn(c, 'pos_map=1, pos_x=58, pos_y=43'); }
  catch (e) { c.shared.landBlocked = `new characters spawn at SEA in Forgat 517 (until fix/home-city) and the character cannot be moved to land: the GM helper cannot teleport others and the DB route failed (${e instanceof Error ? e.message : e})`; c.blocked(String(c.shared.landBlocked)); }
}

import { loadMap, path as bfs, walkable, objects } from '../maps.js';
import type { MapFacts } from '../maps.js';
export const HEAD = { 1: [0, -1], 2: [1, 0], 3: [0, 1], 4: [-1, 0] } as Record<number, [number, number]>;
/** Walks the own character along a BFS path on the CSM map; stops at the first refusal. Returns the tiles walked. */
export async function walkTo(c: Ctx, tx: number, ty: number, wait = 300): Promise<number> {
  const p = c.player, f = loadMap(p.map); if (!f) throw new Error(`no map file for ${p.map}`);
  const route = bfs(f.map, [p.x, p.y], [tx, ty]); if (!route) throw new Error(`no walkable path ${p.x},${p.y} -> ${tx},${ty} on map ${p.map}`);
  let n = 0; for (const h of route) { const r = await p.step(h, wait); if (!r.moved) throw new Error(`step ${n + 1}/${route.length} refused at ${p.x},${p.y} heading ${h}`); n++; }
  return n;
}
/** Relocates the own character through the DB (see dbUpdateOwn) and returns the loaded map facts. */
export async function relocate(c: Ctx, map: number, x: number, y: number): Promise<MapFacts> {
  const f = loadMap(map)!; if (!walkable(f.map, x, y)) throw new Error(`tile ${map}:${x},${y} is not walkable`);
  if (c.player.map !== map || c.player.x !== x || c.player.y !== y) await dbUpdateOwn(c, `pos_map=${map}, pos_x=${x}, pos_y=${y}`);
  return f;
}
export { loadMap, objects };

import { GmClientPacketId as GM, DoorClientPacketId as DOOR } from '@ao/protocol';
/** GM spawns ONE creature (/ACC, no respawn) at its own position and returns its char index + tile. Only ever kill what this returned. */
export async function spawnCreature(c: Ctx, npcNumber: number) {
  const g = c.gm, m = g.mark(); g.gm(`/ACC ${npcNumber}`);
  await g.until(() => g.since(m).some(r => r.name === 'CharacterCreate' && (r.packet as any).npc === 1), 6000, `creature ${npcNumber} spawned`);
  const cr = g.since(m).filter(r => r.name === 'CharacterCreate' && (r.packet as any).npc === 1).pop()!.packet as any;
  return { charIndex: cr.charIndex as number, name: cr.name as string, x: cr.x as number, y: cr.y as number, from: m };
}
/** Kills exactly the creature this run spawned: select it by clicking its CURRENT tile on the GM, check the name, then /RMATA. */
export async function killMine(c: Ctx, mine: { charIndex: number; name: string }) {
  const g = c.gm, cur = g.chars.get(mine.charIndex); if (!cur) return false; // already gone
  g.send({ id: DOOR.LeftClick, x: cur.x, y: cur.y, counter: 0 } as ClientPacket); await g.sleep(700);
  g.gm('/RMATA'); await g.sleep(900);
  return true;
}
export { GM };

import { Sess as SessCls } from '../session.js';
import { readFileSync as rf, writeFileSync as wf, existsSync as ex, mkdirSync as mk } from 'node:fs';
/** A SECOND non-GM character of the harness's own (warrior), created once and cached in artifacts/playthrough/account2.json. */
export async function second(c: Ctx): Promise<InstanceType<typeof SessCls>> {
  if (c.shared.p2) return c.shared.p2 as InstanceType<typeof SessCls>;
  const file = 'artifacts/playthrough/account2.json'; let acct = ex(file) ? JSON.parse(rf(file, 'utf8')) : undefined;
  for (let i = 0; i < 4; i++) {
    const s = await SessCls.open();
    try {
      if (acct) { await s.loginAccount(acct.email, acct.password); const ch = s.characters.find(x => x.name === acct.charName); if (ch) { await s.loginChar(ch.id, ch.name); c.shared.p2 = s; return s; } }
      else {
        const email = `pt2${Date.now()}@local.test`, password = 'playthroughpw1', name = 'Pq' + Array.from({ length: 7 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');
        await s.createAccount(email, password);
        const r = await s.createChar({ name, race: 1, gender: 1, characterClass: 3, head: 1 });
        if (r.ok) { mk('artifacts/playthrough', { recursive: true }); wf(file, JSON.stringify({ email, password, charName: name })); c.shared.p2 = s; return s; }
      }
    } catch { /* retry */ }
    s.close(); await new Promise(r => setTimeout(r, 2000));
  }
  c.blocked('could not create or log in a second non-GM character');
  throw new Error('unreachable');
}
