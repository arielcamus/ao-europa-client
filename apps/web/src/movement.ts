import { Heading } from '@ao/protocol';
import { ALL_SIDES } from './map-objects.js';

/** Declares.bas FLAG_AGUA / FLAG_COSTA (bits of MapData.Blocked above the four side bits) and the eTrigger values LegalPos reads. */
const FLAG_AGUA = 0x20, FLAG_COSTA = 0x80;
const T = { DETALLEAGUA: 8, VALIDONADO: 11, NADOBAJOTECHO: 16, VALIDOPUENTE: 17, NADOCOMBINADO: 18, BLOQ15: 201 } as const;

/** CASPER_BODY_IDLE / CASPER_BODY_NAVIGATING (Declares.bas): the ghost bodies of a dead character (CharacterCreate: Muerto). */
export const isDeadBody = (body: number) => body === 829 || body === 87;

/**
 * TileEngine.Init_TileEngine: MinXBorder = 1 + ScaleWidth \ 64, MaxXBorder = 100 - ScaleWidth \ 64, same for Y with ScaleHeight. The classic
 * renderer is 736x608, so x 12..89 and y 10..91; the server's LegalWalk uses the same box (XWindow 23, YWindow 18 -> 1 + 23 \ 2, 1 + 18 \ 2).
 * LegalPos refuses any tile outside it, so MoveTo never sends a Walk the server would only bounce with a PosUpdate.
 */
export const MIN_X_BORDER = 12, MAX_X_BORDER = 89, MIN_Y_BORDER = 10, MAX_Y_BORDER = 91;
export const inWalkBorders = (x: number, y: number) => x >= MIN_X_BORDER && x <= MAX_X_BORDER && y >= MIN_Y_BORDER && y <= MAX_Y_BORDER;

/** TileEngine_Map.HayAgua: layer-1 graphics that are water. */
const WATER_GRH: [number, number][] = [[1505, 1520], [124, 139], [24223, 24238], [24303, 24318], [468, 483], [44668, 44683], [24143, 24158], [12628, 12643], [2948, 2963]];
/**
 * Recursos.ReadMapGraphics derives two Blocked bits from the graphics, never stored in the CSM: FLAG_AGUA when layer 1 is water, FLAG_COSTA when layer 2 or 3
 * has a graphic. LegalPos needs them (a sailor may only enter water, a walker only land), the server computes the same on load.
 */
export function graphicFlags(layer1: number, layer2: number, layer3: number): number {
  return (WATER_GRH.some(([a, b]) => layer1 >= a && layer1 <= b) ? FLAG_AGUA : 0) | (layer2 > 0 || layer3 > 0 ? FLAG_COSTA : 0);
}

export interface LegalTile { blocked: number; trigger: number }
export interface LegalOccupant { dead: boolean; invisible: boolean; privilege: number; dontBlockTile: boolean }
export interface LegalContext {
  /** The tile's Blocked byte (static map flags with the server's BlockPosition side override applied) and trigger; undefined = map not loaded. */
  tile: LegalTile | undefined;
  occupant: LegalOccupant | undefined;
  ownPrivilege: number;
  sailing: boolean; swimming: boolean; riding: boolean;
  /** UserStats.estado = 1 (dead): a ghost may enter shallow water in a boat. */
  dead: boolean;
}

/**
 * TileEngine.LegalPos (the live VB6 client): may the player predict a step onto x,y with this heading?
 * Map bounds are checked by the caller. A character blocks the tile unless it is dead (ghost body), invisible with a HIGHER privilege
 * than ours, or flagged eDontBlockTile. UserAvisadoBarca (the boat warning chat line) is not modelled: it is a message, not a rule.
 * WORKERONLY (needs the Trabajador class) is left to the server.
 */
export function legalPos(heading: Heading, c: LegalContext): boolean {
  const o = c.occupant;
  if (o && !(o.dead || (o.invisible && o.privilege > c.ownPrivilege) || o.dontBlockTile)) return false;
  const tile = c.tile;
  if (!tile) return true; // map data not loaded yet: the server decides
  if ((tile.blocked & 2 ** (heading - 1)) !== 0) return false;
  if (c.riding && tile.trigger > 9) return false;
  if (tile.trigger === T.BLOQ15) return false;
  if (c.swimming && (tile.trigger === T.DETALLEAGUA || tile.trigger === T.NADOBAJOTECHO)) return true;
  const water = (tile.blocked & FLAG_AGUA) !== 0 && (tile.blocked & FLAG_COSTA) === 0;
  if (c.sailing !== water && tile.trigger !== T.VALIDOPUENTE) return false;
  if (c.swimming && ![T.DETALLEAGUA, T.NADOCOMBINADO, T.VALIDONADO, T.NADOBAJOTECHO].includes(tile.trigger as never)) return false;
  if (c.sailing && !c.swimming && !c.dead && (tile.trigger === 8 || tile.trigger === 11)) return false;
  return true;
}

/** MapData.Blocked of a tile: the map file's byte, with the four side bits replaced by the server's BlockPosition when it sent one. */
export const effectiveBlocked = (staticBlocked: number, override: number | undefined) =>
  override === undefined ? staticBlocked : (staticBlocked & ~ALL_SIDES) | override;
