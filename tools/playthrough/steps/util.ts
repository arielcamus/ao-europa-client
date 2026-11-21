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
