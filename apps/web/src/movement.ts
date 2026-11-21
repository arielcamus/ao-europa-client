import { Heading } from '@ao/protocol';
import { ALL_SIDES } from './map-objects.js';

/** Declares.bas FLAG_AGUA / FLAG_COSTA (bits of MapData.Blocked above the four side bits) and the eTrigger values LegalPos reads. */
const FLAG_AGUA = 0x20, FLAG_COSTA = 0x80;
const T = { DETALLEAGUA: 8, VALIDONADO: 11, NADOBAJOTECHO: 16, VALIDOPUENTE: 17, NADOCOMBINADO: 18, BLOQ15: 201 } as const;

/** CASPER_BODY_IDLE / CASPER_BODY_NAVIGATING (Declares.bas): the ghost bodies of a dead character (CharacterCreate: Muerto). */
export const isDeadBody = (body: number) => body === 829 || body === 87;

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
