// AGPL-3.0-or-later. CMB-01..26 (combat, magic, PvP, safe zones, citizen/criminal, factions). Expected numbers come from the pinned server (9ccd7fad,
// `git show 9ccd7fad:Codigo/<file>`) and the live server's own Dat (C:\ao\server-9ccd\Dat), cited per step. Creatures are the GM helper's own (static dummies:
// NPC 612 "Blanco" for melee, NPC 602 "Louise" for spells) and are removed afterwards; characters are the harness's own two (mage, warrior).
import { SessionClientPacketId as SCP, KeysClientPacketId as KEY, StatusClientPacketId as STC, Heading } from '@ao/protocol';
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

// ---------- PvP: CMB-03 .. CMB-06 ----------
const Safe = { on: 'SafeModeOn', off: 'SafeModeOff' };
const toggleSeguro = (s: Sess) => s.send({ id: KEY.SafeToggle } as ClientPacket);
/** Both own characters side by side (mage east of the warrior, warrior facing east) on `map`; both alive, fed, dressed; the warrior wields the sword. */
async function duel(c: Ctx, map: number, cx: number, cy: number, dressed = true) {
  const [x, y] = spotOn(map, cx, cy, 4, 3);
  const w0 = await actor(c, 'war'), v0 = await actor(c, 'mage');
  if (dressed) { await ensureEquipped(w0, 3500); await ensureEquipped(w0, 3487); void v0; } // done while still on the safe map; the equipment persists through the relog
  await dbEditBoth(c, {
    mage: [setUser('is_dead=0, is_poisoned=0, status=1, min_hp=20, min_sta=60, min_ham=100, min_sed=100'), placeSet(map, x + 1, y)],
    war: [setUser('is_dead=0, status=1, faction_score=0, min_hp=20, min_sta=60, min_ham=100, min_sed=100, heading=2'), placeSet(map, x, y)],
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
  ({ w, v } = await duel(c, 2, 50, 50, false));
  m = w.mark(); toggleSeguro(w); await w.sleep(1000); c.ok(w.since(m).some(r => r.name === Safe.off), 'map 2: SafeModeOff after the toggle (it is ON again after every login)');
  c.eq((await miniStats(w)).alignment, 1, 'warrior is a citizen (alignment 1) before attacking');
  const hits: { place: number; damage: number }[] = []; let swings = 0; m = w.mark(); const startHp = hpOf(v); c.note(`HP before the duel: warrior ${hpOf(w)}, mage ${hpOf(v)}`);
  while (swings < 16 && hits.length < 4 && hpOf(v) > 6 && hpOf(w) > 6) {
    const b = v.mark(); await w.sleep(1250); attack(w); swings++; await w.sleep(1100);
    for (const r of v.since(b)) if (r.name === 'UserHittedByUser') hits.push({ place: (r.packet as any).place, damage: Number((r.packet as any).damage) });
  }
  c.shared.duel = { hits, swings, startHp, endHp: hpOf(v), strength: (await attributes(w)).strength };
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
    setSlot(5, SC.paralizar, 2), setSlot(6, SC.inmovilizar, 1), setSlot(7, SC.remover, 1), setSlot(9, SC.invisibilidad, 1), setSlot(10, SC.curarGraves, 1));
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
