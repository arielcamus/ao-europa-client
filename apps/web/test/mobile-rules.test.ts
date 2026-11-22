// AGPL-3.0-or-later. See ../../../LICENSE.
import { describe, expect, it } from 'vitest';
import { Heading } from '@ao/protocol';
import {
  bestDamage, bestHeal, chooseAction, clickTileFor, cheapestDamageCost, defaultPrefer, headingTowards, hostility, joystickHeading, mobileZoom, crispZoom,
  shouldShowMeditate, spellFromDat,
} from '../src/mobile-rules.js';
import type { ActionContext, MobileSpell } from '../src/mobile-rules.js';

const section = (entries: Record<string, string>) => new Map(Object.entries(entries));
// Real Dat/Hechizos.dat shapes (pre-HOO): Dardo Mágico has TargetEffectType, Curar Heridas Leves does not.
const dardo = spellFromDat(1, 1, section({ nombre: 'Dardo Mágico', subehp: '2', minhp: '14', maxhp: '18', manarequerido: '10', starequerido: '2', target: '3', targeteffecttype: '2' }));
const flecha = spellFromDat(2, 2, section({ nombre: 'Flecha Mágica', subehp: '2', minhp: '18', maxhp: '25', manarequerido: '20', target: '3' }));
const curar = spellFromDat(3, 5, section({ nombre: 'Curar Heridas Leves', subehp: '1', minhp: '5', maxhp: '10', manarequerido: '6', target: '3' }));
const remover = spellFromDat(4, 10, section({ nombre: 'Remover Parálisis', removerparalisis: '1', manarequerido: '30', target: '3' }));
const paralizar = spellFromDat(5, 9, section({ nombre: 'Paralizar', paraliza: '1', manarequerido: '50', target: '3' }));
const spells: MobileSpell[] = [dardo, flecha, curar, remover, paralizar];
const ctx = (over: Partial<ActionContext>): ActionContext => ({
  kind: 'hostile', dead: false, mana: 100, hp: 50, maxHp: 50, adjacent: false, paralyzed: false, spells, prefer: 'magic', ...over,
});
const rule = (over: Partial<ActionContext>) => chooseAction(ctx(over));

describe('spellFromDat', () => {
  it('reads damage, heal, paralysis and status spells, falling back when TargetEffectType is missing', () => {
    expect(dardo).toMatchObject({ name: 'Dardo Mágico', mana: 10, stamina: 2, subeHp: 2, target: 3, effect: 'negative' });
    expect(flecha.effect).toBe('negative');
    expect(curar.effect).toBe('positive');
    expect(remover).toMatchObject({ effect: 'positive', removesParalysis: true });
    expect(paralizar.effect).toBe('negative');
    expect(spellFromDat(9, 99, undefined)).toMatchObject({ name: 'Hechizo 99', effect: 'neutral', mana: 0 });
  });
  it('picks the strongest affordable damage and heal; ties go to the cheaper, then the lower slot', () => {
    expect(bestDamage(spells, 100)).toBe(flecha);
    expect(bestDamage(spells, 15)).toBe(dardo);
    expect(bestDamage(spells, 5)).toBeUndefined();
    expect(bestHeal(spells, 100)).toBe(curar);
    const twin = { ...dardo, slot: 7 }, cheap = { ...dardo, slot: 8, mana: 9 };
    expect(bestDamage([twin, dardo], 100)).toBe(dardo);
    expect(bestDamage([dardo, cheap], 100)).toBe(cheap);
    expect(cheapestDamageCost(spells)).toBe(10);
    expect(defaultPrefer(spells)).toBe('magic');
    expect(defaultPrefer([curar])).toBe('melee');
  });
});

describe('chooseAction: the rule table, one test per row', () => {
  it('1 dead: any tap looks (LeftClick, e.g. the priest)', () => expect(rule({ dead: true })).toEqual({ kind: 'look', rule: 'dead' }));
  it('0 dead-priest: a dead player tapping a priest is resurrected (LeftClick + /RESUCITAR)', () => {
    expect(rule({ dead: true, kind: 'priest' })).toEqual({ kind: 'command', line: '/RESUCITAR', label: 'Resucitar', rule: 'dead-priest' });
  });
  it('1b priest-heal: a hurt player tapping a priest is healed (/CURAR); unhurt, it is a LeftClick', () => {
    expect(rule({ kind: 'priest', hp: 10 })).toMatchObject({ kind: 'command', line: '/CURAR', rule: 'priest-heal' });
    expect(rule({ kind: 'priest' })).toEqual({ kind: 'look', rule: 'npc' });
  });
  it('2 npc: merchants, bankers and priests get a LeftClick', () => expect(rule({ kind: 'npc', adjacent: true })).toEqual({ kind: 'look', rule: 'npc' }));
  it('3 player: never attacked by a plain tap', () => expect(rule({ kind: 'player', adjacent: true, pinned: 1 })).toEqual({ kind: 'look', rule: 'player' }));
  it('4 none: an empty tile is looked at', () => expect(rule({ kind: 'none' })).toEqual({ kind: 'look', rule: 'none' }));
  it('5 self-paralysis: paralysed with Remover Parálisis affordable', () => expect(rule({ kind: 'self', paralyzed: true })).toMatchObject({ kind: 'cast', spell: remover, rule: 'self-paralysis' }));
  it('6 self-heal: hurt with a heal affordable', () => expect(rule({ kind: 'self', hp: 20 })).toMatchObject({ kind: 'cast', spell: curar, rule: 'self-heal' }));
  it('7 self-look: full life, nothing to cure', () => {
    expect(rule({ kind: 'self' })).toEqual({ kind: 'look', rule: 'self-look' });
    expect(rule({ kind: 'self', hp: 20, mana: 2 })).toEqual({ kind: 'look', rule: 'self-look' });
  });
  it('8 pin-melee: melee when adjacent, else a hint', () => {
    expect(rule({ pinned: 'melee', adjacent: true })).toEqual({ kind: 'melee', rule: 'pin-melee' });
    expect(rule({ pinned: 'melee' })).toMatchObject({ kind: 'hint', rule: 'pin-melee', meditate: false });
  });
  it('9 pin-spell: the pinned spell beats the strongest one', () => expect(rule({ pinned: 1 })).toMatchObject({ kind: 'cast', spell: dardo, rule: 'pin-spell' }));
  it('10 pin-no-mana: melee if adjacent, else ask to meditate', () => {
    expect(rule({ pinned: 5, mana: 20, adjacent: true })).toEqual({ kind: 'melee', rule: 'pin-no-mana' });
    expect(rule({ pinned: 5, mana: 20 })).toMatchObject({ kind: 'hint', text: 'Sin maná para Paralizar', meditate: true, rule: 'pin-no-mana' });
  });
  it('11 magic: a caster casts its strongest affordable attack, even next to the creature', () => expect(rule({ adjacent: true })).toMatchObject({ kind: 'cast', spell: flecha, rule: 'magic' }));
  it('12 ranged: an equipped bow shoots', () => expect(rule({ prefer: 'melee', rangedSlot: 4 })).toEqual({ kind: 'ranged', slot: 4, rule: 'ranged' }));
  it('13 melee-adjacent: a fighter next to the creature hits it', () => expect(rule({ prefer: 'melee', adjacent: true })).toEqual({ kind: 'melee', rule: 'melee-adjacent' }));
  it('13b a caster without mana still hits when adjacent', () => expect(rule({ mana: 2, adjacent: true })).toEqual({ kind: 'melee', rule: 'melee-adjacent' }));
  it('14 magic-fallback: a fighter out of reach casts what it has', () => expect(rule({ prefer: 'melee' })).toMatchObject({ kind: 'cast', spell: flecha, rule: 'magic-fallback' }));
  it('15 no-mana: knows attacks, cannot afford any, out of reach', () => expect(rule({ mana: 2 })).toMatchObject({ kind: 'hint', text: 'Sin maná', meditate: true, rule: 'no-mana' }));
  it('15b no-mana: mana is fine but stamina is not ("Estás muy cansado."): no Meditar flash', () => {
    const tired = [{ ...dardo, stamina: 2 }, { ...flecha, stamina: 3 }];
    expect(rule({ spells: tired, stamina: 1 })).toMatchObject({ kind: 'hint', text: 'Sin energía', meditate: false, rule: 'no-mana' });
    expect(rule({ spells: tired, stamina: 2 })).toMatchObject({ kind: 'cast', spell: tired[0], rule: 'magic' });
    expect(rule({ spells: tired, stamina: 1, pinned: 2 })).toMatchObject({ kind: 'hint', text: 'Sin energía para Flecha Mágica', meditate: false });
  });
  it('16 approach: no attack spells, out of reach', () => expect(rule({ spells: [curar], prefer: 'melee' })).toMatchObject({ kind: 'hint', meditate: false, rule: 'approach' }));
  it('an unknown pinned slot is ignored (the spell was moved or forgotten)', () => expect(rule({ pinned: 33 })).toMatchObject({ rule: 'magic' }));
});

describe('shouldShowMeditate', () => {
  const base = { dead: false, mana: 50, maxMana: 100, meditating: false, cheapestDamageCost: 10, hasManaPotion: true };
  it('takes the blue potion\'s place when mana is missing and there is no blue potion', () => {
    expect(shouldShowMeditate({ ...base, hasManaPotion: false })).toBe(true);
    expect(shouldShowMeditate({ ...base, hasManaPotion: false, mana: 100 })).toBe(false);
  });
  it('appears when mana is under 30% or below the cheapest attack, stays while meditating', () => {
    expect(shouldShowMeditate(base)).toBe(false);
    expect(shouldShowMeditate({ ...base, mana: 29 })).toBe(true);
    expect(shouldShowMeditate({ ...base, maxMana: 20, mana: 9 })).toBe(true);
    expect(shouldShowMeditate({ ...base, mana: 100, meditating: true })).toBe(true);
  });
  it('never for the dead, for full mana or for characters without mana', () => {
    expect(shouldShowMeditate({ ...base, mana: 0, dead: true })).toBe(false);
    expect(shouldShowMeditate({ ...base, mana: 100 })).toBe(false);
    expect(shouldShowMeditate({ ...base, mana: 0, maxMana: 0 })).toBe(false);
  });
});

describe('joystick and facing', () => {
  it('four directions by the dominant axis, nothing in the dead zone', () => {
    expect(joystickHeading(5, 5, 14)).toBeUndefined();
    expect(joystickHeading(30, 0, 14)).toBe(Heading.East);
    expect(joystickHeading(-30, 10, 14)).toBe(Heading.West);
    expect(joystickHeading(10, 30, 14)).toBe(Heading.South);
    expect(joystickHeading(-12, -30, 14)).toBe(Heading.North);
  });
  it('clickTileFor: the tile above the feet, because LookatTile checks y + 1 first', () => {
    expect(clickTileFor({ x: 50, y: 49 })).toEqual({ x: 50, y: 48 });
    expect(clickTileFor({ x: 50, y: 1 })).toEqual({ x: 50, y: 1 });
  });
  it('headingTowards only for the four neighbours', () => {
    expect(headingTowards({ x: 5, y: 5 }, { x: 6, y: 5 })).toBe(Heading.East);
    expect(headingTowards({ x: 5, y: 5 }, { x: 5, y: 4 })).toBe(Heading.North);
    expect(headingTowards({ x: 5, y: 5 }, { x: 6, y: 6 })).toBeUndefined();
    expect(headingTowards({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeUndefined();
  });
});

describe('mobileZoom', () => {
  const tiles = (area: number, z: number) => area / (32 * z);
  const crisp = (z: number, dpr: number) => Math.abs(z * dpr - Math.round(z * dpr)) < 1e-9;
  it('iPhone portrait (390 wide, dpr 3), cerca: at least 11 tiles across, 1x so it is crisp', () => {
    const z = mobileZoom(390, 438, 'cerca', 3);
    expect(z).toBe(1);
    expect(tiles(390, z)).toBeGreaterThanOrEqual(11);
  });
  it('iPhone landscape (750x342 with the bars), cerca: the whole 17x13 classic range, 2 device pixels per art pixel', () => {
    const z = mobileZoom(750, 342, 'cerca', 3);
    expect(z).toBeCloseTo(2 / 3, 9);
    expect(tiles(342, z)).toBeGreaterThanOrEqual(13); expect(tiles(750, z)).toBeGreaterThanOrEqual(17);
  });
  it('Android with a fractional ratio (Pixel 5, dpr 2.75): still a whole number of device pixels per art pixel', () => {
    const z = mobileZoom(393, 500, 'cerca', 2.75);
    expect(crisp(z, 2.75)).toBe(true);
    expect(tiles(393, z)).toBeGreaterThanOrEqual(11); expect(tiles(393, z)).toBeLessThan(13);
  });
  it('a snap that would shrink the world more than 20% keeps the exact fit (readable beats crisp)', () => {
    expect(crispZoom(0.5625, 3)).toBe(0.5625); // 1/3 would be 59% of it
    expect(crispZoom(1.108, 3)).toBe(1);
    expect(crispZoom(1.3, 1)).toBe(1.3); // dpr 1: 1x would lose 23%
  });
  it('tablet: four more tiles each way', () => {
    const z = mobileZoom(820, 920, 'cerca', 2);
    expect(tiles(820, z)).toBeGreaterThanOrEqual(15);
    expect(crisp(z, 2)).toBe(true);
  });
  it('medio shows more than cerca, lejos the whole 23x19 view', () => {
    for (const [w, h] of [[390, 438], [750, 342]] as const) {
      const cerca = mobileZoom(w, h, 'cerca', 3), medio = mobileZoom(w, h, 'medio', 3), lejos = mobileZoom(w, h, 'lejos', 3);
      expect(medio).toBeLessThanOrEqual(cerca); expect(lejos).toBeLessThanOrEqual(medio);
      expect(736 * lejos).toBeLessThanOrEqual(w + 0.01); expect(608 * lejos).toBeLessThanOrEqual(h + 0.01);
    }
  });
  it('an empty area (not laid out yet) is 1x', () => { expect(mobileZoom(0, 0, 'cerca', 3)).toBe(1); });
});

describe('hostility', () => {
  it('Hostile=1 or an attackable non-merchant creature is a target; merchants and unknown NPCs are not', () => {
    expect(hostility(section({ hostile: '1', attackable: '1' }))).toBe('hostile');
    expect(hostility(section({ attackable: '1', npctype: '0' }))).toBe('hostile');
    expect(hostility(section({ attackable: '1', comercia: '1' }))).toBe('npc');
    expect(hostility(section({ attackable: '0', npctype: '4' }))).toBe('npc');
    expect(hostility(section({ attackable: '1', npctype: '4' }))).toBe('npc');
    expect(hostility(undefined)).toBe('npc');
    expect(hostility(section({ npctype: '1', attackable: '0' }))).toBe('priest');
    // Guardia Imperial (NPC 260, type 2) and Guardia del Caos (NPC 271, type 8) are Hostile=1 but never a tap target; dragons (6) are.
    expect(hostility(section({ npctype: '2', hostile: '1', attackable: '1' }))).toBe('npc');
    expect(hostility(section({ npctype: '8', hostile: '1', attackable: '1' }))).toBe('npc');
    expect(hostility(section({ npctype: '6', hostile: '1', attackable: '1' }))).toBe('hostile');
  });
});
