/*
 * Character sprite layering, from the LIVE client engine.bas Char_Render (draw order per heading,
 * OffArma / OffHead, composed texture presented at PixelOffset + BodyOffset). Never Graficos_Renderizado.bas:
 * it is not in Argentum20.vbp.
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
/** `part` marks the weapon and shield layers, which also play one pass when the server sends ArmaMov / EscudoMov (a swing). */
export interface Layer { animation: Animation; x: number; y: number; walks: boolean; part?: 'weapon' | 'shield' | undefined }

/**
 * Net pixel offsets from the tile origin of each part of a headed character, engine.bas Char_Render:
 * the composed texture is presented at (PixelOffsetX + BodyOffset.x, PixelOffsetY + BodyOffset.y) and its
 * parts drawn at TextureX/TextureY + (0, 0) for the body, (0, OffArma) for weapon and shield and
 * (HeadOffset.x, OffHead) for head and helmet, with OffArma = (7 if dwarf) - BodyOffset.y and
 * OffHead = HeadOffset.y - 1 - BodyOffset.y (the breathing `ease` terms are 0 at rest). No +1 on body x.
 * `headOffsetX/Y` is BodyData.HeadOffset as loaded (Recursos.bas: ini HeadOffset + BodyOffset), so the head lands at
 * y = HeadOffset.y - 1 and x = BodyOffset.x + HeadOffset.x.
 */
export function characterAnchors(body: { bodyX: number; bodyY: number; headOffsetX: number; headOffsetY: number }, dwarf: boolean) {
  const offArma = (dwarf ? 7 : 0) - body.bodyY;
  const offHead = body.headOffsetY - 1 - body.bodyY;
  return {
    body: { x: body.bodyX, y: body.bodyY },
    equipment: { x: body.bodyX, y: body.bodyY + offArma },
    head: { x: body.bodyX + body.headOffsetX, y: body.bodyY + offHead },
  };
}

export class CharacterSprites {
  private bodyCache = new Map<number, Body | null>();
  private weaponCache = new Map<number, EquipmentSet>();
  private shieldCache = new Map<number, EquipmentSet>();
  constructor(private readonly resources: CharacterResources) {}

  body(id: number): Body | undefined {
    let body = this.bodyCache.get(id);
    if (body === undefined) {
      try {
        body = readBody(this.resources.bodies, this.resources.molds, this.resources.graphics, id);
      } catch { body = null; }
      this.bodyCache.set(id, body);
    }
    return body ?? undefined;
  }
  /** BodyData(Body).HeadOffset.y = -26 marks dwarves: their weapon/shield sit 7 px lower. */
  /** Protocol.bas: .EsEnano = (.Body.HeadOffset.y = -26), on the COMBINED offset (mount bodies such as 3057, 3075, 3077, 4763 count too). */
  private isDwarf(id: number) { return this.body(id)?.headY === -26; }
  /**
   * BodyData(id).HeadOffset as the pinned client loads it (Recursos.bas CargarCuerpos: ini HeadOffsetX/Y + BodyOffset), i.e. readBody's
   * headX/headY. Char_Render, the quest marker and the portrait all use this combined value.
   */
  headOffset(id: number): { x: number; y: number } { const body = this.body(id); return body ? { x: body.headX, y: body.headY } : { x: 0, y: 0 }; }
  headOffsetY(char: Character): number { return this.body(char.body)?.headY ?? 0; }

  /** Sprites bottom to top, in the VB6 order for the character's heading. */
  layers(char: Character, heading: number): Layer[] {
    const body = this.body(char.body);
    if (!body) return [];
    const h = heading - 1;
    const weapon = this.equipment(this.weaponCache, this.resources.weapons, 'arma', char.weapon)[h];
    const shield = this.equipment(this.shieldCache, this.resources.shields, 'esc', char.shield)[h];
    const head = this.headOffset(char.body);
    const anchors = characterAnchors({ bodyX: body.bodyX, bodyY: body.bodyY, headOffsetX: head.x, headOffsetY: head.y }, this.isDwarf(char.body));
    const walk = body.walk[h];
    const headGrh = this.resources.heads[char.head]?.[h];
    const helmetGrh = this.resources.helmets[char.helmet]?.[h];
    const out: Layer[] = [];
    const add = (animation: Animation | undefined, x: number, y: number, walks: boolean, part?: Layer['part']) => { if (animation) out.push({ animation, x, y, walks, part }); };
    const bodyLayer = () => add(walk, anchors.body.x, anchors.body.y, true);
    const headLayers = () => {
      if (headGrh) add(this.resources.animation(headGrh), anchors.head.x, anchors.head.y, false);
      if (helmetGrh) add(this.resources.animation(helmetGrh), anchors.head.x, anchors.head.y, false);
    };
    const w = () => add(weapon, anchors.equipment.x, anchors.equipment.y, true, 'weapon');
    const s = () => add(shield, anchors.equipment.x, anchors.equipment.y, true, 'shield');
    // Heading 1 North, 2 East, 3 South, 4 West.
    if (heading === 2) { s(); bodyLayer(); headLayers(); w(); }
    else if (heading === 1) { w(); s(); bodyLayer(); headLayers(); }
    else if (heading === 4) { w(); bodyLayer(); headLayers(); s(); }
    else { bodyLayer(); headLayers(); s(); w(); }
    return out;
  }
  private equipment(cache: Map<number, EquipmentSet>, source: Ini, prefix: 'arma' | 'esc', id: number): EquipmentSet {
    let set = cache.get(id);
    if (!set) { set = id > 0 ? readEquipment(source, this.resources.molds, this.resources.graphics, prefix, id) : []; cache.set(id, set); }
    return set;
  }
}
export { graphicAnimation };
