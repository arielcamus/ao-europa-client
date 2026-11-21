// AGPL-3.0-or-later. CMB-01..26 (combat, magic, PvP, safe zones, citizen/criminal, factions). Expected numbers come from the pinned server (9ccd7fad,
// `git show 9ccd7fad:Codigo/<file>`) and the live server's own Dat (C:\ao\server-9ccd\Dat), cited per step. Creatures are the GM helper's own (static dummies:
// NPC 612 "Blanco" for melee, NPC 602 "Louise" for spells) and are removed afterwards; characters are the harness's own two (mage, warrior).
import { SessionClientPacketId as SCP, KeysClientPacketId as KEY, StatusClientPacketId as STC, Heading } from '@ao/protocol';
import type { ClientPacket } from '@ao/protocol';
import { step } from '../harness.js';
import type { Ctx } from '../harness.js';
import type { Sess } from '../session.js';
import { ensureEquipped, spotOn, actor, dbEdit, setUser, setSlot, setSkill, equipSlot, slotOf, amountOf, attack, castSpell, workClick, series, localeIds, Msg, spotOnMap2, placeSet, gmGoto, spawnCreature, killMine, click, useSlot } from './sc-util.js';
import { attributes, miniStats, loadMap } from './util.js';
import { walkable, path as bfs } from '../maps.js';

const DUMMY_MELEE = 612, DUMMY_SPELL = 602;
export const heading = (s: Sess, h: Heading) => s.send({ id: SCP.ChangeHeading, heading: h, counter: 0 } as unknown as ClientPacket);

/** Walks `s` to the tile just WEST of (tx, ty) and faces east. Only for open ground (map 2 spot). */
async function standWestOf(s: Sess, tx: number, ty: number) {
  for (let i = 0; i < 12 && s.y !== ty; i++) { const r = await s.step(s.y < ty ? Heading.South : Heading.North, 450); if (!r.moved) throw new Error(`blocked at ${s.x},${s.y} going to row ${ty}`); }
  for (let i = 0; i < 12 && s.x < tx - 1; i++) { const r = await s.step(Heading.East, 450); if (!r.moved) throw new Error(`blocked at ${s.x},${s.y} going to column ${tx - 1}`); }
  heading(s, Heading.East); await s.sleep(500);
}
/** The text numbers the server floats over a character (PrepareMessageTextOverChar: damage dealt, heals). */
const overChar = (s: Sess, m: number, charIndex: number) => series(s, m, 'TextOverChar').filter(x => x.p.charIndex === charIndex);
const num = (t: string) => Number(String(t).replace(/\D/g, ''));

/**
 * The GM spawns `npc` first (GM at the left end of a free run on map 2), then steps one tile aside; the warrior is placed through the DB on the tile west of the creature
 * with heading = East (user.heading, the column the server loads), so no walking is needed. Returns the creature record.
 */
const MELEE_MAP = 751;
const fm2 = () => loadMap(MELEE_MAP)!.map;
async function meleeSetup(c: Ctx, npc: number) {
  const [x, y] = spotOn(MELEE_MAP, 62, 57, 6, 5), g = c.gm;
  await gmGoto(c, MELEE_MAP, x + 4, y + 2);
  const mine = await spawnCreature(c, npc);
  const cr = g.chars.get(mine.charIndex) ?? { x: mine.x, y: mine.y };
  const fm = loadMap(MELEE_MAP)!.map, aside = [[cr.x, cr.y - 4], [cr.x, cr.y + 4], [cr.x + 4, cr.y], [cr.x - 5, cr.y - 3]].find(([ax, ay]) => walkable(fm, ax!, ay!));
  if (aside) await gmGoto(c, MELEE_MAP, aside[0]!, aside[1]!);
  const f = loadMap(2)!.map; if (!walkable(f, cr.x - 1, cr.y)) { await killMine(c, mine); c.blocked(`the tile west of the creature (${cr.x - 1},${cr.y}) is not walkable`); }
  await dbEdit(c, 'war', setUser('is_dead=0, min_sta=60, min_hp=20, min_ham=100, min_sed=100, heading=2'), placeSet(MELEE_MAP, cr.x - 1, cr.y));
  const w = await actor(c, 'war'); c.eq(w.map, MELEE_MAP, `warrior on map ${MELEE_MAP} (Forgat, no hostile creatures)`);
  await ensureEquipped(w, 3500); // a naked character loses stamina every 1.6 s (SUR-12)
  await w.sleep(1500);
  // the server puts a login on the closest legal tile: walk to an orthogonal neighbour of the creature and face it (first neighbour that accepts the walk)
  const nb: [number, number, Heading][] = [[cr.x - 1, cr.y, Heading.East], [cr.x, cr.y - 1, Heading.South], [cr.x + 1, cr.y, Heading.West], [cr.x, cr.y + 1, Heading.North]];
  let faced = false;
  for (const [tx, ty, face] of nb) {
    if (!walkable(fm2(), tx, ty)) continue;
    const route = (w.x === tx && w.y === ty) ? [] : bfs(fm2(), [w.x, w.y], [tx, ty]); if (!route) continue;
    let ok = true; for (const h of route) { const r = await w.step(h as Heading, 450); if (!r.moved) { ok = false; break; } }
    if (!ok) continue;
    heading(w, face); await w.sleep(600); faced = true; break;
  }
  if (!faced) { await killMine(c, mine); c.blocked(`the warrior could not reach a tile next to the creature at ${cr.x},${cr.y} (stood at ${w.x},${w.y})`); }
  return { w, mine, at: cr };
}

step('CMB-01', async c => {
  // UsuarioAtaca (pinned SistemaCombate.bas): IntervaloPermiteAtacar = IntervaloUserPuedeAtacar 1165 ms (intervalos.ini) drops a second Attack inside the window; MinSta < 10 refuses with message 93
  // (SUR-13); else QuitarSta(RandomNumber(1, 10)) and ArmaMov goes out; the hit tile is HeadtoPos(Heading). UserImpactoNpc: ProbExito = clamp(50 + (PoderAtaque - NpcPoderEvasion) * 0.4, 5, 95)%.
  // Blanco (NPC 612, live NPCs.dat) has no PoderEvasion (0) and the new warrior has Armas 0, so PoderAtaque = 0: 50%. A hit sends UpdateExp-less feedback: LocaleMsg 382, TextOverChar with the damage on the
  // creature, CharUpdateHP, and SubirSkillDeArmaActual may add '+1 Combate con armas' (1626).
  const { w, mine } = await meleeSetup(c, DUMMY_MELEE);
  try {
    c.ok(await ensureEquipped(w, 3487), 'sword equipped');
    c.shared.melee = { strength: (await attributes(w)).strength, damages: [] as number[], texts: [] as string[] }; let lastHp = 1_000_000;
    let m = w.mark(); attack(w); attack(w); await w.sleep(1600);
    c.eq(series(w, m, 'ArmaMov').length, 1, 'two Attack packets in the same instant produce ONE swing (1165 ms interval)');
    let swings = 0, hits = 0; const startSta = w.stats!.stamina, spent: number[] = [];
    while (swings < 14 && w.stats!.stamina >= 10) {
      const before = w.mark(), sta0 = w.stats!.stamina; attack(w); await w.sleep(1350); swings++;
      const r = w.since(before), dmg = r.filter(x => x.name === 'TextOverChar' && (x.packet as any).charIndex === mine.charIndex);
      const hp = r.filter(x => x.name === 'CharUpdateHP' && (x.packet as any).charIndex === mine.charIndex).map(x => (x.packet as any).hp as number);
      if (hp.length) { hits++; const d = lastHp - hp[hp.length - 1]!; lastHp = hp[hp.length - 1]!; (c.shared.melee as any).damages.push(d); (c.shared.melee as any).texts.push(dmg.map(x => (x.packet as any).text).join('|')); }
      const sta = r.filter(x => x.name === 'UpdateSta').map(x => (x.packet as any).stamina as number); if (sta.length) spent.push(sta0 - Math.min(...sta));
    }
    c.ok(swings >= 6, `${swings} swings before stamina fell under 10 (each costs 1..10)`);
    c.ok(hits >= 1 && hits <= swings - 1 || swings < 8, `${hits} hits in ${swings} swings (50% expected; every hit or no hit would mean a clamp bug)`);
    c.ok(spent.length > 0 && spent.every(d => d >= 0 && d <= 10 + 2), `per-swing stamina cost ${spent.join(',')} (1..10, regen can add back 1-2)`);
    c.ok(w.stats!.stamina < startSta, `stamina ${startSta} -> ${w.stats!.stamina}`);
    c.note(`damage (CharUpdateHP deltas) ${(c.shared.melee as any).damages.join(',')}; floating texts ${(c.shared.melee as any).texts.join(',')}`);
    // an attack with MinSta < 10 is refused (message 93), nothing swings
    const mm = w.mark(); await w.sleep(1300); attack(w); await w.sleep(1200);
    if (w.stats!.stamina < 10) c.ok(localeIds(w, mm).includes(Msg.tired) && series(w, mm, 'ArmaMov').length === 0, 'stamina under 10: message 93 and no swing');
  } finally { await killMine(c, mine); }
});

step('CMB-02', async c => {
  // GetUserDamageWithItem (pinned): (3 * RandomNumber(MinHit, MaxHit of the weapon) + MaxHit * 0.2 * max(STR - 15, 0) + RandomNumber(Stats.MinHIT, Stats.MaxHit)) * ModClase.DañoArmas, then minus the creature's defence
  // (Blanco has none) times GetPhysicalDamageModifier (1.0 here). The sword OBJ3487 is MinHIT 1 MaxHIT 3, a level-1 character has MinHIT 1 MaxHit 2 (GameLogic.bas), and the warrior's DañoArmas is 1.05 (live Balance.dat [MODDANOARMAS]).
  const d = c.shared.melee as { strength: number; damages: number[] } | undefined;
  if (!d) c.blocked('needs the damage numbers recorded by CMB-01 (run CMB- together)');
  const lo = Math.round((3 * 1 + 0 + 1) * 1.05), hi = Math.round((3 * 3 + 3 * 0.2 * Math.max(d!.strength - 15, 0) + 2) * 1.05);
  c.ok(d!.damages.length >= 2, `${d!.damages.length} damage samples: ${d!.damages.join(',')}`);
  c.ok(d!.damages.every(x => x >= lo && x <= hi), `every hit in [${lo}, ${hi}] (STR ${d!.strength}, DañoArmas 1.05)`);
  c.ok(Math.max(...d!.damages) > lo, 'the damage varies (not a constant)');
});
