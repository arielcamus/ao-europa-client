// AGPL-3.0-or-later. CMB-01..26 (combat, magic, PvP, safe zones, citizen/criminal, factions). Expected numbers come from the pinned server (9ccd7fad,
// `git show 9ccd7fad:Codigo/<file>`) and the live server's own Dat (C:\ao\server-9ccd\Dat), cited per step. Creatures are the GM helper's own (static dummies:
// NPC 612 "Blanco" for melee, NPC 602 "Louise" for spells) and are removed afterwards; characters are the harness's own two (mage, warrior).
import { SessionClientPacketId as SCP, KeysClientPacketId as KEY, StatusClientPacketId as STC, PetsTravelClientPacketId as PET, Heading } from '@ao/protocol';
import type { ClientPacket } from '@ao/protocol';
import { step } from '../harness.js';
import type { Ctx } from '../harness.js';
import type { Sess } from '../session.js';
import { dbEditBoth, ensureEquipped, spotOn, actor, dbEdit, setUser, setSlot, setSkill, equipSlot, slotOf, amountOf, attack, castSpell, workClick, series, localeIds, Msg, spotOnMap2, placeSet, gmGoto, spawnCreature, killMine, click, useSlot } from './sc-util.js';
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
      // damage per hit = the number the server floats over the creature (PrepareMessageTextOverChar), one per hit. HP deltas are only a cross-check:
      // the dummy refills itself now and then, and two hits can share one sampling window.
      if (hp.length) { hits++; lastHp = hp[hp.length - 1]!; (c.shared.melee as any).texts.push(dmg.map(x => (x.packet as any).text).join('|')); }
      for (const x of dmg) { const v = num((x.packet as any).text); if (v > 0) (c.shared.melee as any).damages.push(v); }
      const sta = r.filter(x => x.name === 'UpdateSta').map(x => (x.packet as any).stamina as number); if (sta.length) spent.push(sta0 - Math.min(...sta));
    }
    c.ok(swings >= 6, `${swings} swings before stamina fell under 10 (each costs 1..10)`);
    c.ok(hits >= 1 && hits <= swings - 1 || swings < 8, `${hits} hits in ${swings} swings (50% expected; every hit or no hit would mean a clamp bug)`);
    c.ok(spent.length > 0 && spent.every(d => d >= 0 && d <= 10 + 2), `per-swing stamina cost ${spent.join(',')} (1..10, regen can add back 1-2)`);
    c.ok(w.stats!.stamina < startSta, `stamina ${startSta} -> ${w.stats!.stamina}`);
    c.note(`damage (floating numbers) ${(c.shared.melee as any).damages.join(',')}; last dummy HP ${lastHp}; floating texts ${(c.shared.melee as any).texts.join(',')}`);
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

// ---------- PvP: CMB-03 .. CMB-06 ----------
const Safe = { on: 'SafeModeOn', off: 'SafeModeOff' };
const toggleSeguro = (s: Sess) => s.send({ id: KEY.SafeToggle } as ClientPacket);
/** Both own characters side by side (mage east of the warrior, warrior facing east) on `map`; both alive, fed, dressed; the warrior wields the sword. */
async function duel(c: Ctx, map: number, cx: number, cy: number, dressed = true) {
  const [x, y] = spotOn(map, cx, cy, 4, 3);
  const w0 = await actor(c, 'war'), v0 = await actor(c, 'mage');
  if (dressed) { await ensureEquipped(w0, 3500); await ensureEquipped(w0, 3487); void v0; } // done while still on the safe map; the equipment persists through the relog
  await dbEditBoth(c, {
    mage: [setUser('is_dead=0, is_poisoned=0, status=1, level=1, exp=0, min_hp=20, min_sta=60, min_ham=100, min_sed=100'), placeSet(map, x + 1, y)],
    war: [setUser('is_dead=0, status=1, faction_score=0, ciudadanos_matados=0, criminales_matados=0, min_hp=20, min_sta=60, min_ham=100, min_sed=100, heading=2'), placeSet(map, x, y)],
  });
  const w = await actor(c, 'war'), v = await actor(c, 'mage');
  c.ok(w.map === map && v.map === map, `both characters on map ${map} (warrior ${w.map}:${w.x},${w.y} mage ${v.map}:${v.x},${v.y})`);
  if (Math.abs(w.x - v.x) + Math.abs(w.y - v.y) !== 1) { // the server put the logins on the closest legal tiles: the mage walks to a neighbour of the warrior
    const f = loadMap(map)!.map; let done = false;
    for (const [tx, ty] of [[w.x + 1, w.y], [w.x - 1, w.y], [w.x, w.y + 1], [w.x, w.y - 1]] as [number, number][]) {
      if (!walkable(f, tx, ty)) continue; const route = (v.x === tx && v.y === ty) ? [] : bfs(f, [v.x, v.y], [tx, ty]); if (!route) continue;
      let ok = true; for (const h of route) { const r = await v.step(h as Heading, 450); if (!r.moved) { ok = false; break; } } if (ok) { done = true; break; }
    }
    if (!done) c.blocked(`the mage could not reach a tile next to the warrior at ${w.x},${w.y}`);
  }
  c.ok(Math.abs(w.x - v.x) + Math.abs(w.y - v.y) === 1, `adjacent: warrior ${w.x},${w.y} mage ${v.x},${v.y}`);
  heading(w, v.x > w.x ? Heading.East : v.x < w.x ? Heading.West : v.y > w.y ? Heading.South : Heading.North); await w.sleep(400);
  return { w, v };
}
/** An unsafe map with no creature at all (map 84 Playas del Golfo: Seguro=0 and no NPC in the map file; map 2 has 4 in view and killed a 20 HP character within seconds, maps 11 and 31 are Seguro=1). */
const PVP_MAP = Number(process.env.AO_PVP_MAP ?? 84);
const hpOf = (s: Sess) => s.stats!.hp;

step('CMB-03', async c => {
  // PuedeAtacar (pinned SistemaCombate.bas), in this order: a citizen with the safe toggle ON is refused against a citizen with message 1057 (the doc's 1057/1058); only then the map test
  // ('Estas en un Mapa Seguro?': MapInfo.Seguro = 1 -> message 1062 'zona segura, aqui no podes atacar otros usuarios'); a ZonaSegura trigger tile gives 1063.
  // On an unsafe map with the toggle off UsuarioAtacaUsuario goes on to UsuarioImpacto and UserDamageToUser (CMB-04): the victim gets UserHittedByUser.
  let { w, v } = await duel(c, 751, 62, 57);
  await w.sleep(1300); let m = w.mark(); attack(w); await w.sleep(1500);
  c.ok(localeIds(w, m).includes(Msg.safeCitizen), `Forgat, safe toggle on: message ${Msg.safeCitizen} (no podes atacar ciudadanos, desactiva el seguro)`);
  c.eq(hpOf(v), 20, 'the mage lost nothing');
  m = w.mark(); toggleSeguro(w); await w.sleep(1000); c.ok(w.since(m).some(r => r.name === Safe.off), 'SafeModeOff after the toggle');
  m = w.mark(); await w.sleep(1250); attack(w); await w.sleep(1500);
  const ids = localeIds(w, m);
  c.ok(ids.includes(1062), `Forgat is a Seguro=1 map: toggle off, still refused with message 1062 (got ${ids.join(',') || 'nothing'})`);
  c.eq(hpOf(v), 20, 'still no damage on the safe map');
  // unsafe map
  ({ w, v } = await duel(c, PVP_MAP, 50, 50, false));
  m = w.mark(); toggleSeguro(w); await w.sleep(1000); c.ok(w.since(m).some(r => r.name === Safe.off), `map ${PVP_MAP}: SafeModeOff after the toggle (it is ON again after every login)`);
  c.eq((await miniStats(w)).alignment, 1, 'warrior is a citizen (alignment 1) before attacking');
  const hits: { place: number; damage: number }[] = []; let swings = 0; m = w.mark(); const startHp = hpOf(v); c.note(`HP before the duel: warrior ${hpOf(w)}, mage ${hpOf(v)}`);
  while (swings < 24 && hpOf(v) > 0 && hpOf(w) > 6) { // until the 20 HP mage dies: CMB-09 needs the kill (a victim of level <= 12 is a newbie for ContarMuerte)
    const b = v.mark(); await w.sleep(1250); attack(w); swings++; await w.sleep(1100);
    for (const r of v.since(b)) if (r.name === 'UserHittedByUser') hits.push({ place: (r.packet as any).place, damage: Number((r.packet as any).damage) });
  }
  c.note(`locale ids during the duel (warrior): ${[...new Set(localeIds(w, m))].join(',')}`);
  c.shared.duel = { hits, swings, startHp, endHp: hpOf(v), died: v.since(m).some(r => r.name === 'UpdateHP' && (r.packet as any).hp <= 0) || hpOf(v) <= 0, strength: (await attributes(w)).strength };
  c.ok(hits.length >= 1, `${hits.length} hits in ${swings} swings reached the mage as UserHittedByUser: ${JSON.stringify(hits)}`);
  c.ok(hpOf(v) < startHp, `the mage's HP fell ${startHp} -> ${hpOf(v)}`);
  c.shared.duelPair = { w, v };
});

step('CMB-04', async c => {
  // UserDamageToUser (pinned): BaseDamage = GetUserDamage (CMB-02: sword 1..3, STR, DañoArmas 1.05), body part RandomNumber(1,8) (>6 re-rolled to 2..6; 1 = head: helmet defence only), Defensa = armour + shield
  // RandomNumber(MinDef, MaxDef); Damage = (BaseDamage - Defensa) * GetPhysicalDamageModifier * GetPhysicDamageReduction, floor 0. The mage wears the tunic (OBJ3502 MinDef = MaxDef = 0), no helmet, no shield: defence 0.
  const d = c.shared.duel as { hits: { place: number; damage: number }[]; strength: number } | undefined;
  if (!d) c.blocked('needs the hits recorded by CMB-03');
  const lo = Math.round((3 * 1 + 0 + 1) * 1.05), hi = Math.round((3 * 3 + 3 * 0.2 * Math.max(d!.strength - 15, 0) + 2) * 1.05);
  c.ok(d!.hits.every(h => h.damage >= lo && h.damage <= hi), `every hit in [${lo}, ${hi}] (defence 0): ${d!.hits.map(h => h.damage).join(',')}`);
  c.ok(d!.hits.every(h => h.place >= 1 && h.place <= 6), `body parts ${d!.hits.map(h => h.place).join(',')} are within 1..6 (head, arms, legs, torso)`);
});

step('CMB-05', async c => {
  // UsuarioAtacadoPorUsuario (pinned), called by UsuarioAtacaUsuario BEFORE the hit roll: esCiudadano(attacker) and victim citizen/army -> VolverCriminal: Faccion.Status = 0, FactionScore = 0 if it was citizen.
  // So even a swing that misses makes the attacker a criminal. Status is a flag, there is no numeric reputation (Declares e_Facciones: Criminal 0, Ciudadano 1, Caos 2, Armada 3, Concilio 4, Consejo 5).
  const pair = c.shared.duelPair as { w: Sess; v: Sess } | undefined;
  if (!pair) c.blocked('needs the duel of CMB-03');
  const { w, v } = pair!;
  c.eq((await miniStats(w)).alignment, 0, 'the attacker is now a criminal (alignment 0)');
  c.eq((await miniStats(v)).alignment, 1, 'the victim stays a citizen (alignment 1)');
  const m = w.mark(); toggleSeguro(w); await w.sleep(1000);
  c.ok(localeIds(w, m).includes(Msg.onlyCitizensToggle), `a criminal cannot change the toggle: message ${Msg.onlyCitizensToggle} (solo los ciudadanos pueden cambiar el seguro)`);
  c.ok(!w.since(m).some(r => r.name === Safe.on || r.name === Safe.off), 'no SafeModeOn/Off came back');
});

step('CMB-06', async c => {
  // Pinned Protocol.bas: HandleSafeToggle flips flags.Seguro for a citizen (WriteSafeModeOn/Off) and answers 696 to everybody else (CMB-05); a guild of citizen or army alignment cannot switch it off (message 697).
  // HandlePartyToggle flips SeguroParty -> WritePartySafeOn/Off; HandleSeguroClan / HandleSeguroResu / HandleLegionarySecure flip their flag and WriteClanSeguro / WriteSeguroResu / WriteLegionarySecure carry the NEW value.
  const v = await actor(c, 'mage');
  const flip = async (label: string, send: () => void, names: string[], val?: (p: any) => boolean) => {
    const out: boolean[] = [];
    for (let i = 0; i < 2; i++) {
      const m = v.mark(); send(); await v.sleep(900);
      const r = v.since(m).find(x => names.includes(x.name)); c.ok(!!r, `${label} #${i + 1}: ${r?.name ?? 'no answer'}`);
      out.push(val ? val(r!.packet) : r!.name === names[0]);
    }
    c.ok(out[0] !== out[1], `${label} flips between the two presses (${out.join(' then ')})`);
  };
  await flip('safe toggle (/SEG)', () => v.send({ id: KEY.SafeToggle } as ClientPacket), ['SafeModeOn', 'SafeModeOff']);
  await flip('party safe toggle', () => v.send({ id: KEY.PartySafeToggle } as ClientPacket), ['PartySafeOn', 'PartySafeOff']);
  await flip('clan safe toggle', () => v.send({ id: STC.SeguroClan } as ClientPacket), ['ClanSeguro'], p => !!p.enabled);
  await flip('resurrection safe toggle', () => v.send({ id: STC.SeguroResu } as ClientPacket), ['SeguroResu'], p => !!p.enabled);
  await flip('legionary safe toggle', () => v.send({ id: STC.LegionarySecure } as ClientPacket), ['LegionarySecure'], p => !!p.enabled);
  c.note('the army/citizen-guild lock (message 697) needs a guild of that alignment: asserted in the guild flows, not here');
  // leave the duel: both characters back in Forgat as citizens
  await dbEditBoth(c, { mage: [setUser('is_dead=0, status=1, min_hp=20, pos_map=751, pos_x=60, pos_y=57')], war: [setUser('is_dead=0, status=1, faction_score=0, min_hp=20, pos_map=751, pos_x=62, pos_y=57')] });
});

// ---------- magic: CMB-16 .. CMB-20 ----------
const SC = { paralizar: 1658, inmovilizar: 1659, remover: 1660, invisibilidad: 1657, curarGraves: 1651 } as const;
const spellSlot = (s: Sess, spell: number) => [...s.spells.values()].find(x => x.spell === spell)?.slot;
const mana = (s: Sess) => s.stats!.mana, sta = (s: Sess) => s.stats!.stamina;
const MSG_HAVE_SPELL = 525, MSG_NO_SPELL_ROOM = 777, MSG_VISIBLE_AGAIN = 307;
/** CastSpell then the target click, the way the client's spell cursor does (HandleWorkRequestTarget answers the cast). */
async function cast(s: Sess, slot: number, x: number, y: number) {
  const m = s.mark(); castSpell(s, slot);
  await s.waitFor('WorkRequestTarget', m, 3000).catch(() => undefined);
  workClick(s, x, y, 1); await s.sleep(1100);
  return m;
}

step('CMB-16', async c => {
  // UseInvItem otParchment (pinned InvUsuario.bas): dead refused; ClasePuedeUsarItem and RazaPuedeUsarItem (the four scrolls here forbid only the Pirate class); MinHam > 0 and MinAGU > 0 else message 904;
  // AgregarHechizo (modHechizos.bas): spell already known -> 525 'tenes ese hechizo' and nothing consumed; no free slot of the 40 (MAXUSERHECHIZOS) -> 777; else the first free slot is filled
  // (ChangeSpellSlot) and ONE scroll is consumed. Scrolls come from UPDATEs of the mage's spare inventory rows: OBJ1658 Paralizar (spell 25) x2, 1659 Inmovilizar (26), 1660 Remover Paralisis (27), 1657 Invisibilidad (24), 1651 Curar heridas graves (13).
  await dbEdit(c, 'mage', setUser('is_dead=0, is_poisoned=0, status=1, level=1, exp=0, min_hp=20, min_man=150, min_sta=60, min_ham=100, min_sed=100, pos_map=751, pos_x=60, pos_y=57'),
    'update spell set spell_id=0 where user_id={id} and spell_id in (13, 24, 25, 26, 27, 43);', setSlot(5, SC.paralizar, 2), setSlot(6, SC.inmovilizar, 1), setSlot(7, SC.remover, 1), setSlot(9, SC.invisibilidad, 1), setSlot(10, SC.curarGraves, 1));
  const p = await actor(c, 'mage'); const known0 = [...p.spells.values()].map(s => s.spell).sort((a, b) => a - b);
  c.eq(known0.includes(25), false, 'Paralizar not known yet');
  const use = async (obj: number) => { const it = slotOf(p, obj)!, m = p.mark(); useSlot(p, it.slot); await p.sleep(1400); return m; };
  await use(SC.paralizar);
  c.ok(spellSlot(p, 25) !== undefined, `Paralizar learned into slot ${spellSlot(p, 25)} (ChangeSpellSlot)`);
  c.eq(amountOf(p, SC.paralizar), 1, 'one scroll consumed (2 -> 1)');
  let m = await use(SC.paralizar);
  c.ok(localeIds(p, m).includes(MSG_HAVE_SPELL), `second scroll of the same spell: message ${MSG_HAVE_SPELL} (tenes ese hechizo)`);
  c.eq(amountOf(p, SC.paralizar), 1, 'and it was NOT consumed');
  for (const [obj, spell] of [[SC.inmovilizar, 26], [SC.remover, 27], [SC.invisibilidad, 24], [SC.curarGraves, 13]] as const) {
    await use(obj); c.ok(spellSlot(p, spell) !== undefined, `spell ${spell} learned from scroll ${obj}`); c.eq(amountOf(p, obj), 0, `scroll ${obj} consumed`);
  }
  // hunger refusal: the spare Paralizar scroll, hungry
  await dbEdit(c, 'mage', setUser('min_ham=0'));
  const q = c.player; m = q.mark(); useSlot(q, slotOf(q, SC.paralizar)!.slot); await q.sleep(1400);
  c.ok(localeIds(q, m).includes(Msg.hungry), `hungry: message ${Msg.hungry} (demasiado hambriento y sediento), scroll kept (${amountOf(q, SC.paralizar)})`);
  c.eq(amountOf(q, SC.paralizar), 1, 'scroll not consumed while hungry');
  c.note(`class and race refusal (906) and the full-list refusal (${MSG_NO_SPELL_ROOM}) are not reachable with the starter data: no scroll prohibits a mage, and 40 spell slots need 38 more scrolls`);
  await dbEdit(c, 'mage', setUser('min_ham=100'));
});

step('CMB-17', async c => {
  // PuedeLanzar (pinned modHechizos.bas): alive, Magia >= MinSkill (Dardo 0), Mana >= ManaRequerido (live Hechizos.dat: Dardo Magico 10), MinSta >= StaRequerido (2); cast interval IntervaloUserPuedeCastear (intervalos.ini IntervaloLanzaHechizo 1230 ms).
  // HechizoPropNPC for an eDoDamage spell: Damage = RandomNumber(14, 18) + Porcentaje(Damage, 3 * ELV) (+3% at level 1); then the creature's magic resistance: Louise (NPC 602) MagicResistance 5, MagicDef 10: DiffSkill = 5 - Magia(0) = 5
  // so Damage -= Porcentaje(Damage, MagicDef + DiffSkill * 2 = 20) -> about 11.5..14.8, then DefM (none). Mana -10 and stamina -2 are charged by HandleHechizoNPC.
  await dbEdit(c, 'mage', setUser('is_dead=0, min_hp=20, min_man=150, min_sta=60, min_ham=100, min_sed=100, pos_map=751, pos_x=60, pos_y=57'));
  const p = await actor(c, 'mage'); const dardo = spellSlot(p, 1)!; c.eq(dardo, 1, 'Dardo Magico in slot 1');
  await gmGoto(c, 751, p.x + 3, p.y + 2);
  const mine = await spawnCreature(c, DUMMY_SPELL);
  try {
    const cr = c.gm.chars.get(mine.charIndex) ?? { x: mine.x, y: mine.y };
    await p.until(() => p.chars.has(mine.charIndex), 5000, 'the mage sees the dummy').catch(() => undefined);
    const m0 = mana(p); let hp = 1_000_000; const dmg: number[] = []; const costs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const before = sta(p), b = p.mark(); await cast(p, dardo, cr.x, cr.y);
      const low = Math.min(...p.since(b).filter(r => r.name === 'UpdateSta').map(r => (r.packet as any).stamina as number)); costs.push(before - low);
      for (const r of p.since(b)) if (r.name === 'CharUpdateHP' && (r.packet as any).charIndex === mine.charIndex) { dmg.push(hp - (r.packet as any).hp); hp = (r.packet as any).hp; }
      await p.sleep(300);
    }
    c.ok(dmg.length === 3, `${dmg.length} of 3 casts hit the dummy: damage ${dmg.join(',')}`);
    c.ok(dmg.every(d => d >= 10 && d <= 16), 'every Dardo did 10..16 (14-18 plus 3%, minus the dummy\'s 20% magic reduction)');
    c.near(m0 - mana(p), 30, 30 + 0, `mana spent by three casts (10 each, nothing regenerates mana here) = ${m0 - mana(p)}`);
    c.ok(costs.every(k => k >= 1 && k <= 4), `stamina cost per cast ${costs.join(',')} (StaRequerido 2; a regeneration tick of 1-2 can land in between)`);
    // two casts inside the 1230 ms window: the second one is refused and charges nothing
    const m1 = mana(p); await p.sleep(1300); const b = p.mark(); castSpell(p, dardo); await p.waitFor('WorkRequestTarget', b, 2000).catch(() => undefined); workClick(p, cr.x, cr.y, 1);
    castSpell(p, dardo); workClick(p, cr.x, cr.y, 1); await p.sleep(1500);
    c.eq(m1 - mana(p), 10, 'two casts inside 1230 ms charged mana ONCE');
  } finally { await killMine(c, mine); }
});

/** Level 30 cannot wear the newbie tunic (OBJ3502 Newbie=1: usable up to level 12), and a naked character drains stamina (SUR-12); OBJ32 Vestimenta Comun (MinDef 1, MaxDef 2) has no such limit. */
const COMMON_CLOTHES = 32;
const HIGH = 'level=30, exp=0'; // MaxMAN 1533 and MaxSta 495 at level 30 for this mage (read from UpdateUserStats at login); the spells below need 300-500 mana and 44-200 stamina

step('CMB-18', async c => {
  // Hechizos.Tipo (live Hechizos.dat): 1 uPropiedades (HP, mana, ...), 2 uEstado (paralysis, invisibility ...). Curar heridas graves (13): Tipo 1 SubeHP 1, MinHP 20 MaxHP 50, Magia >= 38, mana 40, stamina 5, Target 3: on yourself it heals
  // 20..50 times GetMagicHealingBonus, capped at MaxHp. Invisibilidad (24): Tipo 2, Magia >= 87, mana 500, stamina 200, Target 1: HechizoEstadoUsuario sets Counters.Invisibilidad = RandomNumber(Duration - 4, Duration + 1) = 16..21 seconds
  // (decremented once per second in PasarSegundo), sends SetInvisible(true); EfectoInvisibilidad ends it with message 307 and SetInvisible(false).
  await dbEdit(c, 'mage', setUser(`is_dead=0, ${HIGH}, min_hp=2, min_man=1533, min_sta=495, min_ham=100, min_sed=100, pos_map=751, pos_x=60, pos_y=57`), setSkill(0, 100), setSlot(8, COMMON_CLOTHES, 1));
  const p = await actor(c, 'mage'); c.eq(p.stats!.level, 30, 'level 30 (DB)'); c.eq(p.stats!.maxMana, 1533, 'MaxMan 1533 at level 30');
  const heal = spellSlot(p, 13), inv = spellSlot(p, 24); if (!heal || !inv) c.blocked('the mage does not know Curar heridas graves / Invisibilidad (CMB-16 gives the scrolls)');
  let m0 = mana(p); const hp0 = p.stats!.hp; await cast(p, heal!, p.x, p.y);
  c.ok(p.stats!.hp > hp0, `self-heal: HP ${hp0} -> ${p.stats!.hp} (20..50 healed, capped at MaxHp ${p.stats!.maxHp})`);
  c.eq(m0 - mana(p), 40, 'Curar heridas graves cost 40 mana');
  await p.sleep(1300); m0 = mana(p); const b = p.mark(); const t0 = Date.now(); await cast(p, inv!, p.x, p.y);
  c.eq(m0 - mana(p), 500, `Invisibilidad cost 500 mana (messages ${localeIds(p, b).join(',')})`);
  const si = series(p, b, 'SetInvisible').filter(x => x.p.charIndex === p.charIndex);
  c.ok(si.some(x => x.p.invisible === true), 'SetInvisible(true) for the own character');
  await p.until(() => series(p, b, 'SetInvisible').some(x => x.p.charIndex === p.charIndex && x.p.invisible === false), 30_000, 'SetInvisible(false)');
  c.near((Date.now() - t0) / 1000, 15, 24, 'seconds invisible (16..21 expected)');
  c.ok(localeIds(p, b).includes(MSG_VISIBLE_AGAIN), `message ${MSG_VISIBLE_AGAIN} (has vuelto a ser visible)`);
});

step('CMB-19', async c => {
  // HechizoEstadoUsuario Paralize (pinned): needs PuedeAtacar (so the caster's safe toggle must be OFF against a citizen, and the map must be unsafe), not already unable to move; Counters.Paralisis = Duration (15) * 0.7 = 10.5 for a Warrior or Hunter target
  // (stored as 10 or 11 and decremented once per second by EfectoParalisisUser), WriteParalizeOK + WritePosUpdate to the victim; a paralysed character cannot walk (HandleWalk answers PosUpdate). Paralizar: Magia >= 50, mana 400, stamina 87.
  // The caster is the level 30 mage, the victim the warrior, both on map 84 for about 25 s (an unsafe map without creatures; a safe map answers 1062).
  await dbEditBoth(c, {
    mage: [setUser(`is_dead=0, is_poisoned=0, status=1, ${HIGH}, min_hp=20, min_man=1533, min_sta=495, min_ham=100, min_sed=100`), setSkill(0, 100), setSlot(8, COMMON_CLOTHES, 1), placeSet(PVP_MAP, ...spotOn(PVP_MAP, 50, 50, 4, 3))],
    war: [setUser('is_dead=0, status=1, faction_score=0, min_hp=20, min_sta=60, min_ham=100, min_sed=100'), placeSet(PVP_MAP, ...(() => { const [x, y] = spotOn(PVP_MAP, 50, 50, 4, 3); return [x + 1, y] as [number, number]; })())],
  });
  const v = await actor(c, 'mage'), w = await actor(c, 'war');
  await v.until(() => spellSlot(v, 25) !== undefined, 10_000, 'the spell list').catch(() => undefined);
  const para = spellSlot(v, 25); if (!para) c.blocked(`Paralizar is not in the mage's list (CMB-16): spells ${[...v.spells.values()].map(s => s.spell).filter(Boolean).join(',')}; level ${v.stats!.level}`);
  if (Math.abs(w.x - v.x) + Math.abs(w.y - v.y) > 3) c.blocked(`the logins landed ${Math.abs(w.x - v.x) + Math.abs(w.y - v.y)} tiles apart`);
  let m = v.mark(); v.send({ id: KEY.SafeToggle } as ClientPacket); await v.sleep(900); c.ok(v.since(m).some(r => r.name === Safe.off), 'caster safe toggle off');
  c.note(`caster stats at login: stamina ${sta(v)}/${v.stats!.maxStamina}, mana ${mana(v)}, level ${v.stats!.level}, hunger ${JSON.stringify(v.hunger)}`);
  const m0 = mana(v); m = w.mark(); const t0 = Date.now(); const mk = await cast(v, para!, w.x, w.y);
  c.eq(m0 - mana(v), 400, `Paralizar cost 400 mana (caster ${v.map}:${v.x},${v.y} target ${w.map}:${w.x},${w.y}; messages ${localeIds(v, mk).join(',')}; caster status ${JSON.stringify(v.since(mk).filter(r => ['ErrorMsg', 'ConsoleMsg'].includes(r.name)).map(r => (r.packet as any).message))})`);
  c.ok(w.since(m).some(r => r.name === 'ParalizeOK'), 'the victim got ParalizeOK');
  const moves: boolean[] = []; let freeAt = -1;
  for (let i = 0; i < 16; i++) { const r = await w.step(Heading.South, 300); moves.push(r.moved); if (r.moved && freeAt < 0) { freeAt = (Date.now() - t0) / 1000; break; } await w.sleep(400); }
  c.ok(moves.slice(0, 3).every(x => !x), `walk refused while paralysed (${moves.slice(0, 6).join(',')})`);
  c.near(freeAt, 8, 14, `seconds until the warrior could walk again (15 x 0.7 = 10.5 expected, ${freeAt.toFixed(1)} measured)`);
  c.shared.paraTarget = { v, w };
});

step('CMB-20', async c => {
  // Inmovilizar (26, Magia >= 60, mana 300, stamina 45, Duration 20): Counters.Inmovilizado = Duration (x0.7 for Warrior/Hunter = 14) and InmovilizadoOK: the target can still turn and attack but not walk.
  // Remover Parálisis (27, Magia >= 45, mana 300, stamina 44): clears Paralizado and Inmovilizado and their counters (EfectoInmoUser / EfectoParalisisUser stop). Same two characters as CMB-19.
  const t = c.shared.paraTarget as { v: Sess; w: Sess } | undefined; if (!t) c.blocked('needs the duel of CMB-19');
  const { v, w } = t!; const inm = spellSlot(v, 26), rem = spellSlot(v, 27); if (!inm || !rem) c.blocked('Inmovilizar / Remover Paralisis not learned (CMB-16)');
  // a Warrior is immune to a new paralysing or immobilising effect for 3 s after CMB-19's paralysis ends (TiempoDeInmunidadParalisisNoMagicas, message 1872)
  c.note(`caster stamina before Inmovilizar ${sta(v)}`);
  await v.sleep(4000); let m = w.mark(); const m0 = mana(v); const mk = await cast(v, inm!, w.x, w.y);
  c.eq(m0 - mana(v), 300, `Inmovilizar cost 300 mana (messages ${localeIds(v, mk).join(',')})`);
  c.ok(w.since(m).some(r => r.name === 'InmovilizadoOK'), 'the victim got InmovilizadoOK');
  const walk = await w.step(Heading.South, 400); c.ok(!walk.moved, 'immobilised: walking is refused');
  m = w.mark(); heading(w, Heading.West); await w.sleep(700); c.ok(!w.since(m).some(r => r.name === 'PosUpdate'), 'but turning on the spot is accepted');
  await v.sleep(900); const m1 = mana(v); m = w.mark(); await cast(v, rem!, w.x, w.y);
  c.eq(m1 - mana(v), 300, 'Remover Paralisis cost 300 mana');
  const walk2 = await w.step(Heading.South, 400); c.ok(walk2.moved, 'after Remover Paralisis the warrior walks at once (well before the 14 s)');
  // restore both characters: level 1, citizens, back in Forgat
  await dbEditBoth(c, { mage: [setUser('is_dead=0, status=1, level=1, exp=0, min_hp=20, min_man=150, min_sta=60, pos_map=751, pos_x=60, pos_y=57'), setSkill(0, 0), setSlot(8, 3502, 1)], war: [setUser('is_dead=0, status=1, faction_score=0, min_hp=20, pos_map=751, pos_x=62, pos_y=57')] });
});

step('CMB-15', async c => {
  // Pinned Protocol.bas HandleWorkLeftClick, skill Proyectiles (12): a weapon with Proyectil = 1 and the matching arrows (otArrows, Subtipo = bow's Municion) equipped, else message 709 'no tenes municiones' and the
  // arrows are unequipped; interval IntervaloPermiteUsarArcos (IntervaloFlechasCazadores 1200 ms); QuitarSta(RandomNumber(1, 10)) when MinSta >= 10; ConsumeAmunition takes ONE arrow per shot.
  // Damage (GetUserDamageWithItem, bow OBJ3491 MinHIT 1 MaxHIT 2 + arrow OBJ3492 1..1, ModClase DañoProyectiles 0.87 for a Warrior, Balance.dat): (3 * (1..2 + 1) + 3 * 0.2 * max(STR - 15, 0) + RandomNumber(1, 2)) * 0.87.
  const { w, mine, at } = await meleeSetup(c, DUMMY_MELEE);
  try {
    c.ok(await ensureEquipped(w, 3491), 'bow equipped'); c.ok(await ensureEquipped(w, 3492), 'arrows equipped');
    const str = (await attributes(w)).strength, arrows0 = amountOf(w, 3492), lo = Math.round((3 * 2 + 3 * 0.2 * Math.max(str - 15, 0) + 1) * 0.87), hi = Math.round((3 * 3 + 3 * 0.2 * Math.max(str - 15, 0) + 2) * 0.87);
    const dmg: number[] = []; let hp = 1_000_000, shots = 0, ranged = 0;
    for (; shots < 8; shots++) {
      const b = w.mark(); attack(w); await w.waitFor('WorkRequestTarget', b, 2500).catch(() => undefined);
      workClick(w, at.x, at.y, 12); await w.sleep(1500);
      const r = w.since(b); if (r.some(x => x.name === 'ArmaMov' && (x.packet as any).isRanged)) ranged++;
      for (const x of r) if (x.name === 'CharUpdateHP' && (x.packet as any).charIndex === mine.charIndex) { if (hp - (x.packet as any).hp > 0) dmg.push(hp - (x.packet as any).hp); hp = (x.packet as any).hp; }
    }
    c.ok(ranged >= 6, `${ranged} of ${shots} shots sent ArmaMov with isRanged (the arrow animation)`);
    c.eq(arrows0 - amountOf(w, 3492), ranged, `one arrow consumed per shot (${arrows0} -> ${amountOf(w, 3492)})`);
    c.ok(dmg.length >= 1 && dmg.length < shots, `${dmg.length} hits in ${shots} shots: ${dmg.join(',')} (chance 50%)`);
    c.ok(dmg.every(d => d >= lo - 1 && d <= hi + 1), `every hit in [${lo}, ${hi}] (STR ${str}, DañoProyectiles 0.87)`);
    // without arrows: message 709 and nothing is shot
    equipSlot(w, slotOf(w, 3492)!.slot); await w.sleep(900); const nb = w.mark(); attack(w); await w.waitFor('WorkRequestTarget', nb, 2000).catch(() => undefined); workClick(w, at.x, at.y, 12); await w.sleep(1500);
    c.ok(localeIds(w, nb).includes(709) && series(w, nb, 'ArmaMov').length === 0, `arrows unequipped: message 709 (no tenes municiones) and no shot (messages ${localeIds(w, nb).join(',')})`);
  } finally { await killMine(c, mine); }
});

step('CMB-22', async c => {
  // Llamado a la Naturaleza (spell 7, live Hechizos.dat: Tipo 4 uInvocacion, Magia >= 35, mana 120, stamina 30, Target 4 terrain): HechizoInvocacion (pinned modHechizos.bas) spawns the spell's creatures next to the click as the caster's PETS,
  // at most MAXMASCOTAS = 3 per user. Safe maps refuse it (message 785, 'una gran fuerza impide invocar criaturas en este mapa': Forgat), so it runs on map 84. PetLeave (Protocol.bas HandlePetLeave) releases every pet (they are removed), PetStand and PetFollow change what they do. Magia is raised through the DB (the starter mage has 0).
  await dbEdit(c, 'mage', setUser('is_dead=0, status=1, level=1, exp=0, min_hp=20, min_man=150, min_sta=60, min_ham=100, min_sed=100'), placeSet(PVP_MAP, ...spotOn(PVP_MAP, 50, 50, 4, 3)), setSkill(0, 100));
  const p = await actor(c, 'mage'); await p.until(() => spellSlot(p, 7) !== undefined, 8000, 'spell list').catch(() => undefined);
  const slot = spellSlot(p, 7); if (!slot) c.blocked('Llamado a la Naturaleza is not in the mage\'s list');
  const before = new Set([...p.chars.keys()]); const m0 = mana(p), b = p.mark();
  await cast(p, slot!, p.x + 1, p.y);
  await p.until(() => p.since(b).some(r => r.name === 'CharacterCreate' && (r.packet as any).npc === 1), 6000, 'pets').catch(() => undefined); await p.sleep(1500);
  const pets = p.since(b).filter(r => r.name === 'CharacterCreate' && (r.packet as any).charIndex !== p.charIndex).map(r => r.packet as any);
  void before; c.note(`packets after the cast: ${[...new Set(p.since(b).map(r => r.name))].join(',')}; mage at ${p.map}:${p.x},${p.y}; CharacterCreate ${JSON.stringify(p.since(b).filter(r => r.name === 'CharacterCreate').map(r => { const q = r.packet as any; return [q.charIndex, q.name, q.npc, q.body, q.x, q.y]; }))}`);
  c.eq(m0 - mana(p), 120, `Llamado a la Naturaleza cost 120 mana (messages ${localeIds(p, b).join(',')})`);
  c.ok(pets.length >= 1 && pets.length <= 3, `${pets.length} creatures appeared next to the mage: ${pets.map(x => `${x.name}@${x.x},${x.y}`).join(' ')} (MAXMASCOTAS 3)`);
  // select the first pet (left click on its tile: HandlePetStand/Follow/Leave work on flags.TargetNPC and refuse with message 757 without a target)
  let m = p.mark(); p.send({ id: PET.PetStand } as ClientPacket); await p.sleep(700);
  c.ok(localeIds(p, m).includes(757), `PetStand without a selected pet: message 757 (selecciona un personaje con click izquierdo), got ${localeIds(p, m).join(',')}`);
  const first = p.chars.get(pets[0]!.charIndex)!; click(p, first.x, first.y); await p.sleep(700);
  m = p.mark(); p.send({ id: PET.PetStand } as ClientPacket); await p.sleep(900);
  c.ok(p.since(m).some(r => r.name === 'ChatOverHead' && (r.packet as any).charIndex === first.charIndex) || !localeIds(p, m).includes(757), 'PetStand on the selected pet was accepted (the pet answers with Expresar)');
  m = p.mark(); p.send({ id: PET.PetFollow } as ClientPacket); await p.sleep(900); c.ok(!localeIds(p, m).includes(757), 'PetFollow on the selected pet was accepted');
  m = p.mark(); p.send({ id: PET.PetLeave } as ClientPacket); await p.sleep(1500);
  c.ok(series(p, m, 'CharacterRemove').some(x => x.p.charIndex === first.charIndex), 'PetLeave removed the selected pet only');
  m = p.mark(); p.send({ id: PET.PetLeaveAll } as ClientPacket); await p.sleep(2000);
  const gone = new Set(series(p, m, 'CharacterRemove').map(x => x.p.charIndex as number));
  c.ok(pets.slice(1).every(x => gone.has(x.charIndex)), `PetLeaveAll removed the other ${pets.length - 1} pets (${[...gone].length} CharacterRemove)`);
  c.ok(localeIds(p, m).includes(1278), 'message 1278 (liberaste a tus mascotas)');
  await dbEdit(c, 'mage', setSkill(0, 0), placeSet(751, 60, 57));
});

step('CMB-09', async c => {
  // ContarMuerte (pinned Modulo_UsUaRiOs.bas) is skipped when the victim is a newbie (ELV <= 12, LimiteNewbie), so killing the level 1 mage of CMB-03 moves NO counter: ciudadanosMatados and criminalesMatados stay 0 and the killer gains no
  // FactionScore. The same function holds the real rules (a kill counts once per killer per FactionReKillTime 600000 ms, score 10 +/- level difference, x1.5 across Armada/Caos, cap 20, minus 1 per assist inside 8000 ms): those need
  // a victim above level 12, which would make the starter characters unequippable (newbie items stop at 12), so they stay manual.
  const d = c.shared.duel as { died?: boolean } | undefined, pair = c.shared.duelPair as { w: Sess } | undefined;
  if (!d || !pair) c.blocked('needs the duel of CMB-03');
  if (!d!.died) c.blocked('the victim of CMB-03 survived this run (the loop stops at 6 HP), so there is no kill to count');
  const ms = await miniStats(pair!.w);
  c.eq(ms.citizensKilled, 0, 'ciudadanosMatados after killing a newbie citizen');
  c.eq(ms.criminalsKilled, 0, 'criminalesMatados');
  c.eq(ms.alignment, 0, 'the killer is a criminal (CMB-05)');
});

step('CMB-07', async c => c.blocked('manual: UserCanAttackNpc sets TurnPK only against citizen-faction creatures (royal guards, which kill a level 1 character) and DoRobar needs the Ladron class and 15 stamina; neither exists as a safe fixture'));
step('CMB-08', async c => c.blocked('manual: HandleDonateGold needs a criminal inside a city with a Revividor (priest) in 3 tiles and 2500 gold; criminals are pushed out of NoPKs maps (VolverCriminal), so the walk to the priest needs a hand-held session'));
step('CMB-10', async c => c.blocked('manual: EnlistarArmadaReal needs ELV >= 25 and 100 FactionScore (rangos_faccion.dat), which the newbie starter items cannot survive (OBJ Newbie=1 stops at ELV 12), plus an Enlistador NPC of the faction'));
step('CMB-11', async c => c.blocked('manual: EnlistarCaos needs a criminal with FactionScore >= 100 and ELV >= 25 next to a Caos enlister; same level problem as CMB-10'));
step('CMB-12', async c => c.blocked('manual: /RECOMPENSA needs an enlisted character at the rank score and level of rangos_faccion.dat (25/30/35/40/43)'));
step('CMB-13', async c => c.blocked('manual: LeaveFaction needs an enlisted character (CMB-10) beside its enlister'));
step('CMB-14', async c => c.blocked('manual: needs an Armada member (CMB-10) next to a citizen: msgs 1055/1056 come from the Armada branch of PuedeAtacar'));
step('CMB-21', async c => c.blocked('manual: Ceguera, Estupidez and Maldicion have no learnable scroll in the starter data and only NPC casters apply them'));
step('CMB-23', async c => c.blocked('manual: DoDomar needs a Druid (taming points = CHA * Domar / 6 for druids, / 118 for everybody else) and a tameable creature; the harness characters are a mage and a warrior'));
step('CMB-24', async c => c.blocked('manual: Apunalar needs a dagger user of a class with a backstab chance (Assassin, Hunter, Bard); the harness characters are a mage and a warrior'));
step('CMB-25', async c => c.blocked('manual: Cleave, Provoke and DivineBlood come from class effects (EffectsOverTime.dat) of a Warrior or Cleric at the toggled feature level'));
step('CMB-26', async c => c.blocked('manual: guild war declarations need two guild leaders (guild creation needs level and gold); the clan-safe toggle is asserted in CMB-06'));
