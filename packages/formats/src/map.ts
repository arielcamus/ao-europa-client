/*
 * TypeScript adaptation of Argentum 20 client CODIGO/Recursos.bas:
 * ReadCsmHeader, ReadMapGraphics, CargarMapa, ValidCsmEnd; and TileEngine.bas: LegalPos.
 * Optimized map format designed by Juan Martín Sotuyo Dodero (Maraxus).
 * Copyright (C) 2022 Noland Studios. GNU AGPL version 3 or any later version.
 * WITHOUT ANY WARRANTY, including MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See ../../../LICENSE and ../../../NOTICE.
 */
import { BinaryReader, FormatError } from './binary.js';

export const MAP_SIZE = 100;
export const TILE_SIZE = 32;
export const FIVE_LAYER_SIGNATURE = 0x324c3557; // W5L2 on disk
export interface MapGraphic { x: number; y: number; grh: number }
export interface MapMetadata {
  name: string; backup: number; restriction: string; music: [number, number]; safe: boolean;
  zone: string; terrain: string; ambient: string; baseLight: number; letterGrh: number;
  extra: [number, number, string]; rain: boolean; snow: boolean; fog: boolean;
}
export interface GameMap {
  format: 'legacy' | 'five-layer';
  /** MapSize is reserved/zero in many installed resources. Runtime coordinates are 1..100. */
  storedBounds: [number, number, number, number];
  metadata: MapMetadata;
  /** Five arrays, indexed by layer - 1. Legacy layer 3 becomes 4, layer 4 becomes 5. */
  layers: MapGraphic[][];
  /** Row-major, zero-based storage for the one-based world coordinates. Low 4 bits = entry headings. */
  blocked: Uint8Array;
  triggers: Int16Array;
  objects: { x: number; y: number; id: number; amount: number }[];
  /** Validated legacy W2B1 extension, ignored by the paired VB6 runtime. */
  legacyBridgeGraphics: MapGraphic[];
  /** Some installed legacy maps retain stale bytes after their declared sections. */
  trailingBytes: number;
}
export function tileIndex(x: number, y: number): number { return (y - 1) * MAP_SIZE + x - 1; }
export function inMap(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 1 && y >= 1 && x <= MAP_SIZE && y <= MAP_SIZE;
}
/** Blocked-tile subset only: no navigation, water, NPC, door, or trigger game rules. */
export function canEnter(map: GameMap, x: number, y: number, heading: number): boolean {
  return inMap(x, y) && Number.isInteger(heading) && heading >= 1 && heading <= 4 &&
    (map.blocked[tileIndex(x, y)]! & (1 << (heading - 1))) === 0;
}
function position(r: BinaryReader): { x: number; y: number } {
  const x = r.i16(), y = r.i16();
  if (!inMap(x, y)) throw new FormatError(`Map coordinate outside 1..100: ${x},${y}`);
  return { x, y };
}
function graphic(r: BinaryReader): MapGraphic {
  const pos = position(r), grh = r.i32();
  if (grh <= 0) throw new FormatError(`Invalid map GRH ${grh}`);
  return { ...pos, grh };
}

export function parseCsm(bytes: Uint8Array): GameMap {
  const r = new BinaryReader(bytes);
  const signature = r.i32();
  const modern = signature === FIVE_LAYER_SIGNATURE;
  const blockedCount = modern ? r.count() : signature;
  if (blockedCount < 0 || blockedCount > 10_000) throw new FormatError('Invalid blocked count');
  const layerCounts = modern ? [r.count(), r.count(), r.count(), r.count(), r.count()] :
    [r.count(), r.count(), 0, r.count(), r.count()];
  const triggers = r.count(), lights = r.count(), particles = r.count();
  const npcs = r.count(), objects = r.count(), exits = r.count();
  const storedBounds: GameMap['storedBounds'] = [r.i16(), r.i16(), r.i16(), r.i16()];
  const metadata: MapMetadata = {
    name: r.string(), backup: r.u8(), restriction: r.string(), music: [r.i32(), r.i32()],
    safe: r.u8() !== 0, zone: r.string(), terrain: r.string(), ambient: r.string(),
    baseLight: r.i32(), letterGrh: r.i32(), extra: [r.i32(), r.i32(), r.string()],
    rain: r.u8() !== 0, snow: r.u8() !== 0, fog: r.u8() !== 0,
  };
  const map: GameMap = {
    format: modern ? 'five-layer' : 'legacy', storedBounds, metadata,
    blocked: new Uint8Array(10_000), triggers: new Int16Array(10_000),
    layers: [], objects: [], legacyBridgeGraphics: [], trailingBytes: 0,
  };
  for (let i = 0; i < blockedCount; i++) {
    const { x, y } = position(r);
    map.blocked[tileIndex(x, y)] = r.u8();
  }
  for (const count of layerCounts) map.layers.push(Array.from({ length: count }, () => graphic(r)));
  for (let i = 0; i < triggers; i++) {
    const { x, y } = position(r);
    map.triggers[tileIndex(x, y)] = r.i16();
  }
  // File order differs from header order: particles precede lights, objects precede NPCs.
  for (let i = 0; i < particles; i++) { position(r); r.skip(4); }
  for (let i = 0; i < lights; i++) { position(r); r.skip(5); }
  for (let i = 0; i < objects; i++) map.objects.push({ ...position(r), id: r.i16(), amount: r.i16() });
  for (let i = 0; i < npcs; i++) { position(r); r.skip(2); }
  for (let i = 0; i < exits; i++) { position(r); r.skip(6); }
  if (r.remaining && !modern) {
    // CargarMapa stops before this tail. mapa1.csm in Recursos @89615f3 has
    // 1,419 undeclared bytes; do not mistake these for extra layer/exit records.
    const tail = r.offset;
    if (r.remaining >= 4 && r.i32() === 0x31423257) {
      map.legacyBridgeGraphics = Array.from({ length: r.count() }, () => graphic(r));
    } else {
      r.offset = tail;
      map.trailingBytes = r.remaining;
      r.skip(r.remaining);
    }
  }
  r.end();
  return map;
}
