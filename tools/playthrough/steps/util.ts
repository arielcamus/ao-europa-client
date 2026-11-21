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
  const cli = process.env.AO_DB_CLI ?? 'C:\\ao\\sqlite-cli\\sqlite3.exe C:\\ao\\server\\Database.db';
  return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'StrictHostKeyChecking=no', '-o', 'LogLevel=ERROR', '-i', key, '-p', process.env.AO_DB_SSH_PORT ?? '2222', process.env.AO_DB_SSH ?? 'aobuilder@127.0.0.1', `${cli} "${statement}"`], { encoding: 'utf8', timeout: 30_000 }).trim();
}
/** Log the own character out, run `UPDATE user SET <set> WHERE id = <id>`, log back in. Returns after the settle. */
export async function dbUpdateOwn(c: Ctx, set: string) {
  if (!c.own) c.blocked('DB updates are only done on the harness\'s own character');
  const id = c.player.characters.find(ch => ch.name === c.charName)!.id;
  c.player.close();
  let free = false;
  for (let i = 0; i < 20 && !free; i++) { free = sql(`select is_logged from user where id=${id};`) === '0'; if (!free) await new Promise(r => setTimeout(r, 3000)); }
  if (free) sql(`update user set ${set} where id=${id} and is_logged=0;`);
  await c.relogin();
  if (!free) c.blocked(`the server kept character ${id} flagged is_logged=1 for 60 s after the socket closed, so the DB UPDATE (${set}) was not applied`);
}
/** First MOV step needs dry land: a new character spawns at sea on 517 until fix/home-city. Memoised. */
export async function ensureLand(c: Ctx) {
  if (!c.own) return;
  if (c.player.map !== 517) return;
  if (c.shared.landBlocked) c.blocked(String(c.shared.landBlocked));
  try { await dbUpdateOwn(c, 'pos_map=1, pos_x=58, pos_y=43'); }
  catch (e) { c.shared.landBlocked = `new characters spawn at SEA in Forgat 517 (until fix/home-city) and the character cannot be moved to land: the GM helper cannot teleport others and the DB route failed (${e instanceof Error ? e.message : e})`; c.blocked(String(c.shared.landBlocked)); }
}
