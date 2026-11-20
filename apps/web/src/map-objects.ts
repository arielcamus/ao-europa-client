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
 * Roof lights of the LIVE VB6 renderer (TileEngine_RenderScreen.bas "Layer 5 loop", Recursos.bas RoofsLight): ONE alpha per roof
 * trigger (a trigger for which HayTecho holds). Each frame the roof of the trigger the player stands on fades to 0 at
 * `timerTicksPerFrame * 48` of 255, every other roof fades back up to 255. A roof tile uses the alpha of NearRoof(x, y), the first
 * roof trigger in its 3x3 neighbourhood; with none it is drawn opaque.
 */
export class RoofLights {
  private readonly alpha = new Map<number, number>();
  /** Start of a map: every roof trigger present on it is opaque. */
  reset(triggers: Uint16Array) {
    this.alpha.clear();
    for (const t of triggers) if (t && hayTecho(t)) this.alpha.set(t, 1);
  }
  /** One frame. `ticks` = timerTicksPerFrame (1 at the VB6 reference rate of 16 ms). */
  update(playerTrigger: number, dtMs: number) {
    const step = (48 / 255) * (dtMs / 16);
    for (const [trigger, value] of this.alpha) {
      this.alpha.set(trigger, trigger === playerTrigger ? Math.max(0, value - step) : Math.min(1, value + step));
    }
  }
  alphaOf(trigger: number) { return this.alpha.get(trigger) ?? 1; }
  get size() { return this.alpha.size; }
}

/** TileEngine.NearRoof: trigger of the first HayTecho tile in the 3x3 block around (x, y), or 0. */
export function nearRoof(triggers: Uint16Array, x: number, y: number): number {
  for (let ly = y - 1; ly <= y + 1; ly++) for (let lx = x - 1; lx <= x + 1; lx++) {
    if (lx < 1 || lx > 100 || ly < 1 || ly > 100) continue;
    const t = triggers[tileKey(lx, ly)] ?? 0;
    if (hayTecho(t)) return t;
  }
  return 0;
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

/**
 * Tile to LeftClick for a tap, following the reference server (Protocol.HandleLeftClick -> WorldActions.HandleWorldAction):
 * the server SKIPS the world action when any character, including the player, stands on (x,y) or (x,y+1); otherwise an object on
 * (x,y) is used directly, and only when (x,y) has none it tries (x+1,y), (x+1,y+1), (x,y+1) in that order. The VB6 client sends the
 * tapped tile. Only when a character stands on the tile or right below it do we fall back to a tile whose
 * (x+1,y), (x+1,y+1) or (x,y+1) neighbour is the tapped one: (x-1,y), (x-1,y-1), (x,y-1), choosing one without an object
 * and without a character on it or below it. Returns undefined when the tap is not on/next to a door.
 */
export function doorClickTile(
  objects: MapObjects, isDoor: (objIndex: number) => boolean, tile: { x: number; y: number },
  occupied: (x: number, y: number) => boolean = () => false,
) {
  const door = (x: number, y: number) => { const o = objects.objectAt(x, y); return o !== undefined && isDoor(o.objIndex); };
  const hasDoor = door(tile.x, tile.y) || door(tile.x + 1, tile.y) || door(tile.x + 1, tile.y + 1) || door(tile.x, tile.y + 1);
  // The server checks the tile itself first; a door on a neighbour is only reached when the tile holds no object.
  const viaOwn = door(tile.x, tile.y) || (objects.objectAt(tile.x, tile.y) === undefined && (door(tile.x + 1, tile.y) || door(tile.x + 1, tile.y + 1) || door(tile.x, tile.y + 1)));
  if (!hasDoor || !viaOwn) return undefined;
  const blocked = (x: number, y: number) => occupied(x, y) || occupied(x, y + 1);
  if (!blocked(tile.x, tile.y)) return tile;
  for (const candidate of [{ x: tile.x - 1, y: tile.y }, { x: tile.x - 1, y: tile.y - 1 }, { x: tile.x, y: tile.y - 1 }]) {
    if (candidate.x < 1 || candidate.y < 1) continue;
    if (objects.objectAt(candidate.x, candidate.y) !== undefined || blocked(candidate.x, candidate.y)) continue;
    // The candidate must reach the door through the server's neighbour order.
    const reaches = (candidate.x + 1 === tile.x && candidate.y === tile.y) || (candidate.x + 1 === tile.x && candidate.y + 1 === tile.y) || (candidate.x === tile.x && candidate.y + 1 === tile.y);
    if (reaches) return candidate;
  }
  return undefined;
}
