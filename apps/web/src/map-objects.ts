/*
 * Ground objects, per-tile blocking and the roof rule of the classic client.
 * Adapted 2026-11-20 from client Protocol.bas HandleObjectCreate/ObjectDelete/BlockPosition, TileEngine.bas HayTecho
 * and Graficos_Renderizado.bas (layer-4 roof fade). AGPL-3.0-or-later; no warranty. See ../../../LICENSE.
 */
import { parseIni } from './assets.js';
import type { Ini, MapFileObject } from './assets.js';
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

/**
 * Client-side data deviation (QA 21 Nov). The classic server marks building interiors with castle-entry triggers (bank 29, carpinteria 32,
 * 26..33, 51..54 on mapa1) and NO tile of mapa1 carries a roof trigger (1, 4, 16 or >= 60), so the faithful HayTecho/RoofsLight rule never
 * fades any roof there and the body disappears under it. The client treats the 21..59 interior markers as roof triggers (+60 keeps them apart
 * from the real ones). Only the roof/indoor logic reads this copy; the server and every other reader keep the file's own triggers.
 */
export const INTERIOR_TRIGGERS = { first: 21, last: 59, offset: 60 };
export function roofTriggers(triggers: Uint16Array): Uint16Array {
  const out = new Uint16Array(triggers);
  for (let i = 0; i < out.length; i++) {
    const t = out[i]!;
    if (t >= INTERIOR_TRIGGERS.first && t <= INTERIOR_TRIGGERS.last) out[i] = t + INTERIOR_TRIGGERS.offset;
  }
  return out;
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
/** GrhIndex/ObjType per [OBJn] of the shared, already parsed Dat/Obj.dat (object-catalog.ts loads and parses it once). */
export function objectGraphicsFromIni(ini: Ini): Map<number, ObjectGraphic> {
  const result = new Map<number, ObjectGraphic>();
  for (const [name, section] of ini) {
    const header = /^obj(\d+)$/.exec(name); if (!header) continue;
    result.set(Number(header[1]), { grh: Number.parseInt(section.get('grhindex') ?? '', 10) || 0, type: Number.parseInt(section.get('objtype') ?? '', 10) || 0 });
  }
  return result;
}
/** Same from raw text (tests); the app goes through loadObjectIni so there is ONE parse of Obj.dat. */
export const parseObjectGraphics = (text: string) => objectGraphicsFromIni(parseIni(text));
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
  fixedAt: (x: number, y: number) => GroundObject | undefined = () => undefined,
) {
  // The server's MapData holds the map-file objects too (trees, signs, deposits, decorations), so a fixed object on a tile is
  // "an object on (x,y)" for HandleWorldAction exactly like a server-sent one.
  const objectAt = (x: number, y: number) => objects.objectAt(x, y) ?? fixedAt(x, y);
  const door = (x: number, y: number) => { const o = objectAt(x, y); return o !== undefined && isDoor(o.objIndex); };
  const hasDoor = door(tile.x, tile.y) || door(tile.x + 1, tile.y) || door(tile.x + 1, tile.y + 1) || door(tile.x, tile.y + 1);
  // The server checks the tile itself first; a door on a neighbour is only reached when the tile holds no object.
  const viaOwn = door(tile.x, tile.y) || (objectAt(tile.x, tile.y) === undefined && (door(tile.x + 1, tile.y) || door(tile.x + 1, tile.y + 1) || door(tile.x, tile.y + 1)));
  if (!hasDoor || !viaOwn) return undefined;
  const blocked = (x: number, y: number) => occupied(x, y) || occupied(x, y + 1);
  if (!blocked(tile.x, tile.y)) return tile;
  for (const candidate of [{ x: tile.x - 1, y: tile.y }, { x: tile.x - 1, y: tile.y - 1 }, { x: tile.x, y: tile.y - 1 }]) {
    if (candidate.x < 1 || candidate.y < 1) continue;
    if (objectAt(candidate.x, candidate.y) !== undefined || blocked(candidate.x, candidate.y)) continue;
    // The candidate must reach the door through the server's neighbour order.
    const reaches = (candidate.x + 1 === tile.x && candidate.y === tile.y) || (candidate.x + 1 === tile.x && candidate.y + 1 === tile.y) || (candidate.x === tile.x && candidate.y + 1 === tile.y);
    if (reaches) return candidate;
  }
  return undefined;
}

/** eObjType values the renderer cares about (Declares.bas). */
export const ObjType = {
  Tree: 4, Door: 6, Sign: 8, CastleSpawner: 10, Teleport: 19, Decoration: 20, Deposit: 22, Anvil: 27, Forge: 28, Mailbox: 47, FishingPool: 52,
} as const;
/**
 * Client TileEngine_Map.EsObjetoFijo (signs, trees, deposits, decorations): CambioDeArea keeps these on the map, and the client reads
 * every object of the map file anyway. The SERVER's ModAreas only skips its own GameLogic.EsObjetoFijo, which is written
 * `OBJType = OBJType = otSignBoards Or ...`: VB6 compares `(OBJType = OBJType) = 8`, i.e. `True = 8`, always False, so signs are NOT
 * fixed there and the server DOES send them with ObjectCreate (trees, deposits and decorations are not sent). Keeping signs in this
 * set is harmless: a server-sent sign lands on the same tile and wins (`objects.objectAt ?? fixed`).
 */
const FIXED_TYPES = new Set<number>([ObjType.Sign, ObjType.Tree, ObjType.Deposit, ObjType.Decoration]);
/** Same file, second pass of each row (drawn after that row's characters, with layer 4): "big objects". */
const BIG_PASS = new Set<number>([ObjType.Tree, ObjType.Door, ObjType.Sign, ObjType.Deposit, ObjType.Mailbox, ObjType.Anvil, ObjType.Forge, ObjType.Decoration, ObjType.CastleSpawner]);
export const drawsOverCharacters = (type: number) => BIG_PASS.has(type);

/** Fixed objects stored in the map file, keyed by tile (CargarMapa fills MapData.OBJInfo/ObjGrh from them). */
export function fixedObjects(objects: readonly MapFileObject[], graphics: ReadonlyMap<number, ObjectGraphic>): Map<number, GroundObject> {
  const result = new Map<number, GroundObject>();
  for (const object of objects) {
    const info = graphics.get(object.objIndex);
    if (info && info.grh > 0 && FIXED_TYPES.has(info.type)) result.set(tileKey(object.x, object.y), { objIndex: object.objIndex, amount: object.amount, elementalTags: 0 });
  }
  return result;
}

export type DrawPass = 'ground' | 'row';
export interface ObjectDraw { pass: DrawPass; grh: number; type: number }
/**
 * What the renderer draws for the object on a tile, in order. Trees and the other big objects are drawn twice, exactly like
 * RenderScreen: once with the walkable layers and once in the row pass over characters.
 */
export function objectDraws(object: GroundObject | undefined, graphics: ReadonlyMap<number, ObjectGraphic>): ObjectDraw[] {
  const info = object ? graphics.get(object.objIndex) : undefined;
  if (!info || info.grh <= 0) return [];
  const draws: ObjectDraw[] = [];
  // The ground pass is a Select Case whose `Case Else` draws every other type too (items on the floor, but also anvils and castle
  // spawners), so EVERY object with a graphic is drawn once under the characters.
  draws.push({ pass: 'ground', grh: info.grh, type: info.type });
  if (BIG_PASS.has(info.type)) draws.push({ pass: 'row', grh: info.grh, type: info.type });
  return draws;
}

/** Declares.bas ARBOL_MIN_ALPHA / ARBOL_ALPHA_TIME: a tree in front of the player fades to 130/255 in 150 ms and back. */
const TREE_MIN_ALPHA = 130 / 255, TREE_FADE_MS = 150;
/** RenderScreen tree test for objects: within 2 tiles sideways and 7 rows, with the tree south of the player. */
export const treeCoversPlayer = (player: { x: number; y: number }, x: number, y: number) =>
  Math.abs(player.x - x) < 3 && Math.abs(player.y - y) < 8 && player.y < y;
export class TreeFade {
  private alpha = new Map<number, number>();
  step(key: number, covers: boolean, dtMs: number): number {
    const current = this.alpha.get(key) ?? 1;
    if (current === 1 && !covers) return 1;
    const rate = (1 - TREE_MIN_ALPHA) * (dtMs / TREE_FADE_MS);
    const next = covers ? Math.max(TREE_MIN_ALPHA, current - rate) : Math.min(1, current + rate);
    if (next === 1) this.alpha.delete(key); else this.alpha.set(key, next);
    return next;
  }
  clear() { this.alpha.clear(); }
}
