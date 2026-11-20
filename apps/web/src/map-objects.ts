/*
 * Ground objects, per-tile blocking and the roof rule of the classic client.
 * Adapted 2026-11-20 from client Protocol.bas HandleObjectCreate/ObjectDelete/BlockPosition, TileEngine.bas HayTecho
 * and Graficos_Renderizado.bas (layer-4 roof fade). AGPL-3.0-or-later; no warranty. See ../../../LICENSE.
 */
export const ALL_SIDES = 15;
/** Declares.bas: PRIMER_TRIGGER_TECHO. */
export const FIRST_ROOF_TRIGGER = 60;
/** e_Trigger: BAJOTECHO, ZONASEGURA, NADOBAJOTECHO. */
const ROOF_TRIGGERS = new Set([1, 4, 16]);
/** TileEngine.HayTecho */
export const hayTecho = (trigger: number) => trigger >= FIRST_ROOF_TRIGGER || ROOF_TRIGGERS.has(trigger);

export interface GroundObject { objIndex: number; amount: number; elementalTags: number }
export const tileKey = (x: number, y: number) => (y - 1) * 100 + x - 1;

export class MapObjects {
  readonly objects = new Map<number, GroundObject>();
  /** Side bits from BlockPosition; a tile absent here has no server override. */
  readonly blocked = new Map<number, number>();
  clear() { this.objects.clear(); this.blocked.clear(); }
  create(x: number, y: number, object: GroundObject) { this.objects.set(tileKey(x, y), object); }
  delete(x: number, y: number) { this.objects.delete(tileKey(x, y)); }
  /** HandleBlockPosition: Blocked = (Blocked And Not ALL_SIDES) Or sides. */
  block(x: number, y: number, sides: number) { this.blocked.set(tileKey(x, y), sides & ALL_SIDES); }
  objectAt(x: number, y: number) { return this.objects.get(tileKey(x, y)); }
}

/**
 * Roof fade state, one alpha per roof tile (client GrhBlend 20..255). While the player is under a roof, tiles with the
 * SAME trigger fade out (floor ~8%); all others fade back in. Rates match `timerTicksPerFrame * 12` of 255 per ~16 ms frame.
 */
export class RoofFade {
  private alpha = new Map<number, number>();
  static readonly FLOOR = 20 / 255;
  alphaOf(key: number) { return this.alpha.get(key) ?? 1; }
  step(key: number, hidden: boolean, dtMs: number): number {
    const rate = (12 / 255) * (dtMs / 16);
    const current = this.alpha.get(key) ?? 1;
    const next = hidden ? Math.max(RoofFade.FLOOR * 0.4, current - rate) : Math.min(1, current + rate);
    this.alpha.set(key, next);
    return next;
  }
  clear() { this.alpha.clear(); }
}

/** Which roof tiles hide: the player's tile must itself be a roof tile and the roof tile must share its trigger. */
export function roofHidden(triggers: Uint16Array, playerKey: number, tile: number): boolean {
  const own = triggers[playerKey] ?? 0;
  return hayTecho(own) && triggers[tile] === own;
}

export interface ObjectGraphic { grh: number; type: number }
/** Reads GrhIndex/ObjType per [OBJn] of Dat/Obj.dat (ObjType 6 = door). */
export function parseObjectGraphics(text: string): Map<number, ObjectGraphic> {
  const result = new Map<number, ObjectGraphic>();
  let current: ObjectGraphic | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[OBJ(\d+)\]$/i.exec(line);
    if (header) { current = { grh: 0, type: 0 }; result.set(Number(header[1]), current); continue; }
    if (!current) continue;
    const grh = /^GrhIndex\s*=\s*(\d+)/i.exec(line); if (grh) { current.grh = Number(grh[1]); continue; }
    const type = /^ObjType\s*=\s*(\d+)/i.exec(line); if (type) current.type = Number(type[1]);
  }
  return result;
}
export const DOOR_OBJECT_TYPE = 6;
