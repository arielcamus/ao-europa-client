/*
 * Character sprite layering, adapted 2026-11-20 from client Graficos_Renderizado.bas Char_Render
 * (draw order per heading, weapon offset for dwarves, body x+1 below body 488).
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty. See NOTICE.
 */
import { graphicAnimation, readBody } from './assets.js';
import type { Animation, Body, GraphicIndex, Ini } from './assets.js';
import { readEquipment } from './character-data.js';
import type { EquipmentSet } from './character-data.js';
import type { Character } from './characters.js';

export interface CharacterResources {
  graphics: GraphicIndex; bodies: Ini; molds: Ini; heads: number[][]; helmets: number[][];
  weapons: Ini; shields: Ini; animation(id: number): Animation;
}
/** One sprite of a character. `walks` layers advance with the walking clock, the head never animates. */
export interface Layer { animation: Animation; x: number; y: number; walks: boolean }

export class CharacterSprites {
  private bodyCache = new Map<number, Body | null>();
  private rawHeadY = new Map<number, number>();
  private weaponCache = new Map<number, EquipmentSet>();
  private shieldCache = new Map<number, EquipmentSet>();
  constructor(private readonly resources: CharacterResources) {}

  body(id: number): Body | undefined {
    let body = this.bodyCache.get(id);
    if (body === undefined) {
      try {
        body = readBody(this.resources.bodies, this.resources.molds, this.resources.graphics, id);
        this.rawHeadY.set(id, Number(this.resources.bodies.get(`body${id}`)?.get('headoffsety') ?? 0) + body.bodyY);
      } catch { body = null; }
      this.bodyCache.set(id, body);
    }
    return body ?? undefined;
  }
  /** BodyData(Body).HeadOffset.y = -26 marks dwarves: their weapon/shield sit 7 px lower. */
  private isDwarf(id: number) { return this.rawHeadY.get(id) === -26; }
  headOffsetY(char: Character): number { return this.body(char.body)?.headY ?? 0; }

  /** Sprites bottom to top, in the VB6 order for the character's heading. */
  layers(char: Character, heading: number): Layer[] {
    const body = this.body(char.body);
    if (!body) return [];
    const h = heading - 1;
    const weapon = this.equipment(this.weaponCache, this.resources.weapons, 'arma', char.weapon)[h];
    const shield = this.equipment(this.shieldCache, this.resources.shields, 'esc', char.shield)[h];
    const offArma = this.isDwarf(char.body) ? 7 : 0;
    const walk = body.walk[h];
    const headGrh = this.resources.heads[char.head]?.[h];
    const helmetGrh = this.resources.helmets[char.helmet]?.[h];
    const out: Layer[] = [];
    const add = (animation: Animation | undefined, x: number, y: number, walks: boolean) => { if (animation) out.push({ animation, x, y, walks }); };
    const bodyLayer = () => add(walk, body.bodyX + (char.body < 488 ? 1 : 0), body.bodyY, true);
    const headLayers = () => {
      if (headGrh) add(this.resources.animation(headGrh), body.headX, body.headY, false);
      if (helmetGrh) add(this.resources.animation(helmetGrh), body.headX, body.headY, false);
    };
    const w = (dy: number) => add(weapon, 0, dy, true);
    const s = (dy: number) => add(shield, 0, dy, true);
    // Heading 1 North, 2 East, 3 South, 4 West.
    if (heading === 2) { s(0); bodyLayer(); headLayers(); w(offArma); }
    else if (heading === 1) { w(offArma); s(0); bodyLayer(); headLayers(); }
    else if (heading === 4) { w(0); bodyLayer(); headLayers(); s(offArma); }
    else { bodyLayer(); headLayers(); s(offArma); w(offArma); }
    return out;
  }
  private equipment(cache: Map<number, EquipmentSet>, source: Ini, prefix: 'arma' | 'esc', id: number): EquipmentSet {
    let set = cache.get(id);
    if (!set) { set = id > 0 ? readEquipment(source, this.resources.molds, this.resources.graphics, prefix, id) : []; cache.set(id, set); }
    return set;
  }
}
export { graphicAnimation };
