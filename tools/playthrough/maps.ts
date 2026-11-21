// AGPL-3.0-or-later. Map reader for the playthrough harness: wraps the client's own parseMap (apps/web/src/assets.ts) and adds what the
// harness needs from the CSM header and tail (Seguro, restrict, tile exits) plus the server's HayAgua graphic ranges.
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../../apps/web/src/assets.js';
import type { WorldMap } from '../../apps/web/src/assets.js';

export interface TileExit { x: number; y: number; map: number; dx: number; dy: number }
export interface MapFacts { id: number; map: WorldMap; name: string; safe: boolean; restrict: string; zone: string; exits: TileExit[] }
const ASSETS = () => process.env.AO_ASSETS ?? `${process.env.HOME}/Projects/ao-reference/Recursos-prehoo`;
const WATER: [number, number][] = [[1505, 1520], [124, 139], [24223, 24238], [24303, 24318], [468, 483], [44668, 44683], [24143, 24158], [12628, 12643], [2948, 2963]];
/** General.HayAgua: the layer-1 graphic is a water graphic. */
export const isWater = (m: WorldMap, x: number, y: number) => { const g = m.layers[0]![(y - 1) * 100 + x - 1]!; return WATER.some(([a, b]) => g >= a && g <= b); };
export const isBlocked = (m: WorldMap, x: number, y: number) => x < 1 || y < 1 || x > 100 || y > 100 || (m.blocked[(y - 1) * 100 + x - 1]! & 1) !== 0;
export const walkable = (m: WorldMap, x: number, y: number) => !isBlocked(m, x, y) && !isWater(m, x, y);

const cache = new Map<number, MapFacts | null>();
export function loadMap(id: number): MapFacts | null {
  if (cache.has(id)) return cache.get(id)!;
  const file = `${ASSETS()}/Mapas/mapa${id}.csm`;
  if (!existsSync(file)) { cache.set(id, null); return null; }
  const bytes = new Uint8Array(readFileSync(file));
  const map = parseMap(bytes);
  // header again for the facts parseMap discards (tMapHeader counts, name, backup, restrict, music, safe, zone)
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let o = 0;
  const i32 = () => { const n = v.getInt32(o, true); o += 4; return n; }, u8 = () => v.getUint8(o++), i16 = () => { const n = v.getInt16(o, true); o += 2; return n; };
  const text = () => { const n = v.getUint16(o, true); o += 2; const s = new TextDecoder('windows-1252').decode(bytes.subarray(o, o + n)); o += n; return s; };
  const first = i32(), five = first === 0x324c3557; if (five) i32();
  for (let i = 0; i < (five ? 5 : 4); i++) i32();
  const counts = Array.from({ length: 6 }, () => i32()); o += 8; const name = text(); u8(); const restrict = text(); o += 8; const safe = u8() === 1; const zone = text();
  void counts; void i16;
  // tile exits are the last section: 5 x Int16 each, right after the NPC section parseMap read
  const exits: TileExit[] = [];
  const exitCount = counts[5]!;
  let at = bytes.length - map.trailingBytes;
  for (let i = 0; i < exitCount && at + 10 <= bytes.length; i++, at += 10) exits.push({ x: v.getInt16(at, true), y: v.getInt16(at + 2, true), map: v.getInt16(at + 4, true), dx: v.getInt16(at + 6, true), dy: v.getInt16(at + 8, true) });
  const facts = { id, map, name, safe, restrict, zone, exits };
  cache.set(id, facts); return facts;
}

/** BFS over walkable tiles (4-neighbour, the way the player walks). Returns the heading list or undefined. */
export function path(m: WorldMap, from: [number, number], to: [number, number], blockedExtra: Set<number> = new Set()): number[] | undefined {
  const key = (x: number, y: number) => y * 101 + x, prev = new Map<number, [number, number]>(), q: [number, number][] = [from];
  prev.set(key(...from), [-1, 0]);
  const dirs: [number, number, number][] = [[0, -1, 1], [1, 0, 2], [0, 1, 3], [-1, 0, 4]];
  while (q.length) {
    const [x, y] = q.shift()!;
    if (x === to[0] && y === to[1]) { const out: number[] = []; let k = key(x, y); while (prev.get(k)![0] !== -1) { const [h, pk] = prev.get(k)!; out.push(h); k = pk; } return out.reverse(); }
    for (const [dx, dy, h] of dirs) { const nx = x + dx, ny = y + dy, nk = key(nx, ny); if (prev.has(nk) || !walkable(m, nx, ny) || blockedExtra.has(nk)) continue; prev.set(nk, [h, key(x, y)]); q.push([nx, ny]); }
  }
  return undefined;
}

/** obj.dat: ObjType, Llave and Name per object index (e_OBJType: 6 doors, 9 keys, 19 teleport, 31 ships, 36 passage ticket, 44 saddles). */
export interface ObjFact { type: number; name: string; llave: number; clave: number; radio: number }
let objCache: Map<number, ObjFact> | undefined;
export function objects(): Map<number, ObjFact> {
  if (objCache) return objCache;
  const file = [`${ASSETS()}/Dat/Obj.dat`, `${ASSETS()}/Dat/obj.dat`].find(existsSync)!;
  const out = new Map<number, ObjFact>(); let cur: ObjFact | undefined;
  for (const raw of readFileSync(file, 'latin1').split(/\r?\n/)) {
    const line = raw.trim(), h = /^\[OBJ(\d+)\]/i.exec(line);
    if (h) { cur = { type: 0, name: '', llave: 0, clave: 0, radio: 0 }; out.set(Number(h[1]), cur); continue; }
    const kv = /^([A-Za-z]+)=(.*)$/.exec(line); if (!kv || !cur) continue;
    const k = kv[1]!.toLowerCase(), val = kv[2]!.trim();
    if (k === 'objtype') cur.type = Number(val); else if (k === 'name') cur.name = val; else if (k === 'llave') cur.llave = Number(val); else if (k === 'clave') cur.clave = Number(val); else if (k === 'radio') cur.radio = Number(val);
  }
  return objCache = out;
}
