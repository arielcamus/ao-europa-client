// AGPL-3.0-or-later. Shared helpers for the SUR-* and CMB-* steps (survival and combat): two own characters (a mage = c.player, a warrior =
// the harness's second character), DB edits of either one while it is logged out, packet helpers for use/equip/attack/cast, and the numbers
// transcribed from the pinned server data. Kept apart from util.ts so the other categories' files are untouched.
import { readFileSync, existsSync } from 'node:fs';
import { CombatClientPacketId as CB, ItemsClientPacketId as IT, SpellClientPacketId as SP, DoorClientPacketId as DOOR } from '@ao/protocol';
import type { ClientPacket } from '@ao/protocol';
import { Sess } from '../session.js';
import type { Ctx } from '../harness.js';
import { sql, second, gmGoto, spawnCreature, killMine } from './util.js';

export { sql, second, gmGoto, spawnCreature, killMine };
export type Who = 'mage' | 'war';
export const CLASS = { Mage: 1, Cleric: 2, Warrior: 3 } as const;

/** The two own characters. The mage is the harness's player; the warrior is created once by `second()` and cached in artifacts/playthrough/account2.json. */
export async function actor(c: Ctx, w: Who): Promise<Sess> {
  if (w === 'mage') {
    if (!c.own) c.blocked('needs the harness\'s own mage character (creation failed on this server run)');
    if (c.player.stats?.characterClass !== CLASS.Mage) c.blocked('the harness player is not a mage');
    return c.player;
  }
  const s = await second(c);
  if (s.closed) { await relogWar(c); return c.shared.p2 as Sess; }
  return s;
}
const warCreds = () => JSON.parse(readFileSync('artifacts/playthrough/account2.json', 'utf8')) as { email: string; password: string; charName: string };
async function relogWar(c: Ctx) {
  const a = warCreds(); let last: unknown;
  (c.shared.p2 as Sess | undefined)?.close();
  for (let i = 0; i < 4; i++) {
    const s = await Sess.open();
    try { await s.loginAccount(a.email, a.password); const ch = s.characters.find(x => x.name === a.charName)!; await s.loginChar(ch.id, ch.name); c.shared.p2 = s; return; }
    catch (e) { last = e; s.close(); await new Promise(r => setTimeout(r, 4000)); }
  }
  throw last;
}
const nameOf = (c: Ctx, w: Who) => (w === 'mage' ? c.charName : warCreds().charName);

/**
 * UPDATE statements on one of the OWN characters (brief rule: logged-out own test characters only, UPDATE only). Placeholders: {id}.
 * The character is logged out with /SALIR (a clean save), the statements run once the server reports is_logged=0, then it logs back in.
 */
export async function dbEdit(c: Ctx, w: Who, ...statements: string[]) {
  const s = await actor(c, w);
  const id = Number(sql(`select id from user where name='${nameOf(c, w).replace(/'/g, "''")}';`));
  if (!Number.isInteger(id) || id <= 0) throw new Error(`cannot resolve the character id of ${nameOf(c, w)}`);
  const pm = s.mark(); s.say('/SALIR');
  await s.until(() => s.closed || s.rx.slice(pm).some(r => r.name === 'Disconnect'), 25_000, 'logout').catch(() => undefined);
  s.close();
  let free = false;
  for (let i = 0; i < 20 && !free; i++) { free = sql(`select is_logged from user where id=${id};`) === '0'; if (!free) await new Promise(r => setTimeout(r, 3000)); }
  if (free) for (const st of statements) {
    const out = sql(st.replace(/\{id\}/g, String(id)).replace(/;\s*$/, ' returning 1;'));
    if (!out.startsWith('1') && /^update user /i.test(st)) throw new Error(`UPDATE not applied to ${nameOf(c, w)} (is_logged still set?): ${st.slice(0, 80)}`);
  }
  if (w === 'mage') await c.relogin(); else await relogWar(c);
  await dress(c, w);
  if (!free) c.blocked(`the server kept ${nameOf(c, w)} flagged is_logged=1 for 60 s, so the DB UPDATE was not applied`);
}
export const setUser = (set: string) => `update user set ${set} where id={id} and is_logged=0;`;
export const setSlot = (slot: number, item: number, amount: number, eq = 0) => `update inventory_item set item_id=${item}, amount=${amount}, is_equipped=${eq} where user_id={id} and number=${slot};`;
/** Skill points live in `skillpoint` (number = skill index + 1 in the VB6 enumeration order). */
export const setSkill = (skill: number, value: number) => `update skillpoint set value=${value} where user_id={id} and number=${skill + 1};`;

// ---- packets ----
export const useSlot = (s: Sess, slot: number) => s.send({ id: IT.UseItem, slot, fromInventory: true, counter: 0 } as ClientPacket);
export const equipSlot = (s: Sess, slot: number) => s.send({ id: IT.EquipItem, slot, skin: false, counter: 0 } as unknown as ClientPacket);
export const attack = (s: Sess) => s.send({ id: CB.Attack, counter: 0 } as ClientPacket);
export const click = (s: Sess, x: number, y: number) => s.send({ id: DOOR.LeftClick, x, y, counter: 0 } as ClientPacket);
/** Spell cast = CastSpell(slot) then WorkLeftClick(x, y, skill Magic) like the client's spell cursor. */
export const castSpell = (s: Sess, slot: number) => s.send({ id: SP.CastSpell, slot, counter: 0 } as unknown as ClientPacket);
export const workClick = (s: Sess, x: number, y: number, skill = 1) => s.send({ id: SP.WorkLeftClick, x, y, skill, counter: 0 } as unknown as ClientPacket);
export const slotOf = (s: Sess, obj: number) => [...s.inventory.values()].find(i => i.object === obj);
export const amountOf = (s: Sess, obj: number) => [...s.inventory.values()].filter(i => i.object === obj).reduce((n, i) => n + i.amount, 0);

// ---- placement and observation ----
import { loadMap } from './util.js';
import { walkable } from '../maps.js';
/** First walkable run of `len` tiles in a row near the middle of map 2 (an unsafe field map, as DTH-01 uses). Returns the left tile. */
export function spotOnMap2(len = 4): [number, number] { return spotOn(2, 50, 50, len); }
/** First walkable run of `len` tiles in a row, searching outwards from (cx, cy) on `map`. */
export function spotOn(map: number, cx: number, cy: number, len = 4, rows = 1): [number, number] {
  const f = loadMap(map); if (!f) throw new Error(`no map file for ${map}`);
  for (let r = 0; r < 40; r++) for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (Array.from({ length: rows }, (_, j) => Array.from({ length: len }, (_, i) => walkable(f.map, x + i, y + j)).every(Boolean)).every(Boolean)) return [x, y];
  throw new Error(`no walkable spot on map ${map}`);
}
export const placeSet = (map: number, x: number, y: number) => setUser(`pos_map=${map}, pos_x=${x}, pos_y=${y}`);
/** The server's locale ids since a mark. */
export const localeIds = (s: Sess, m: number) => s.localeSince(m).map(l => l.id);
export const Msg = { poisonTick: 47, poisonDamage: 390, cured: 682, notPoisoned: 683, wait: 681, tired: 93, healed: 519, hungry: 904, dead: 77, safeCitizen: 1057, safeArmy: 1058, armyVsArmy: 1055, armyVsCitizen: 1056, noSafeArea: 572, onlyCitizensToggle: 696 } as const;
/** Time series of one packet name since `m`: [{ t (ms since the session opened), packet }]. */
export const series = (s: Sess, m: number, name: string) => s.since(m).filter(r => r.name === name).map(r => ({ t: r.t, p: r.packet as any }));
/** EquipItem toggles, and the login inventory does not say what is equipped: send it, and send it again when the answer says the item is not worn. */
export async function ensureEquipped(s: Sess, obj: number, want = true) {
  for (let i = 0; i < 3; i++) {
    const it = slotOf(s, obj)!; equipSlot(s, it.slot); await s.sleep(900);
    if (!!slotOf(s, obj)!.equipped === want) return true;
  }
  return false;
}

/** Like dbEdit for both characters at once: both log out together, both rows are updated, both log back in together (a character stranded on an unsafe map while the other one relogs gets killed by wandering creatures). */
export async function dbEditBoth(c: Ctx, edits: { mage: string[]; war: string[] }) {
  const ws: Who[] = ['mage', 'war'], sess = await Promise.all(ws.map(w => actor(c, w)));
  const ids = ws.map(w => Number(sql(`select id from user where name='${nameOf(c, w).replace(/'/g, "''")}';`)));
  await Promise.all(sess.map(async s => { const pm = s.mark(); s.say('/SALIR'); await s.until(() => s.closed || s.rx.slice(pm).some(r => r.name === 'Disconnect'), 25_000, 'logout').catch(() => undefined); s.close(); }));
  for (let i = 0; i < 2; i++) {
    let free = false; for (let k = 0; k < 20 && !free; k++) { free = sql(`select is_logged from user where id=${ids[i]};`) === '0'; if (!free) await new Promise(r => setTimeout(r, 3000)); }
    if (!free) throw new Error(`${nameOf(c, ws[i]!)} stayed flagged is_logged=1: UPDATE not applied`);
    for (const st of edits[ws[i]!]) { const out = sql(st.replace(/\{id\}/g, String(ids[i])).replace(/;\s*$/, ' returning 1;')); if (!out.startsWith('1') && /^update user /i.test(st)) throw new Error(`UPDATE not applied to ${nameOf(c, ws[i]!)}: ${st.slice(0, 80)}`); }
  }
  await Promise.all([c.relogin(), relogWar(c)]);
  await dress(c, 'mage'); await dress(c, 'war');
}

/**
 * A fresh create -> /SALIR -> relog keeps the armour equipped (checked by the coordinator). Characters of this harness come back naked for two upstream reasons: UserDie unequips all
 * gear and a revive does not re-equip it, and OBJ3500/3502 are Newbie=1, which EquiparInvItem refuses at login above level 12 (the server then sets Desnudo). A naked character
 * loses stamina and cannot regenerate (SUR-12), so steps that need clothes re-equip explicitly: EquipItem toggles, ensureEquipped checks the answer.
 */
export async function dress(c: Ctx, w: Who) {
  const s = w === 'mage' ? c.player : (c.shared.p2 as Sess);
  if (!s || s.closed) return;
  const obj = [3502, 32, 3500].find(o => slotOf(s, o)); if (!obj) return;
  const ok = await ensureEquipped(s, obj, true);
  if (!ok) console.log(`dress(${w}) could not equip the armour ${obj}: ${JSON.stringify([...s.inventory.values()].map(i => [i.slot, i.object, i.equipped]))}`);
}
