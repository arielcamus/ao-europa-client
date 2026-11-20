// AGPL-3.0-or-later. Node-only local resource adapter; never imported by the browser.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { inMap, parseCsm, tileIndex } from '@ao/formats';
import type { GameMap } from '@ao/formats';

export interface StandinWorld { id: number; map: GameMap; spawn: { x: number; y: number } }

export async function loadWorld(root: string, id = 1, requestedSpawn?: { x: number; y: number }): Promise<StandinWorld> {
  if (!Number.isInteger(id) || id < 1 || id > 32767) throw new Error('Invalid AO_MAP_ID');
  const folder = join(root, 'Mapas');
  const filename = (await readdir(folder)).find(name => name.toLowerCase() === `mapa${id}.csm`);
  if (!filename) throw new Error(`Missing ${folder}/mapa${id}.csm; set AO_ASSETS to Recursos`);
  const map = parseCsm(await readFile(join(folder, filename)));
  const ground = new Set(map.layers[0]!.map(tile => tileIndex(tile.x, tile.y)));
  const free = (x: number, y: number) => inMap(x, y) && ground.has(tileIndex(x, y)) && (map.blocked[tileIndex(x, y)]! & 15) === 0;
  if (requestedSpawn) {
    if (!free(requestedSpawn.x, requestedSpawn.y)) throw new Error('Requested spawn must be on an unblocked map tile');
    return { id, map, spawn: requestedSpawn };
  }
  // Stable nearest free tile to the center; never spawn inside a wall.
  const candidates = map.layers[0]!.filter(tile => free(tile.x, tile.y));
  candidates.sort((a, b) => Math.abs(a.x - 50) + Math.abs(a.y - 50) - Math.abs(b.x - 50) - Math.abs(b.y - 50));
  const spawn = candidates[0];
  if (!spawn) throw new Error(`Map ${id} has no free ground tile`);
  return { id, map, spawn: { x: spawn.x, y: spawn.y } };
}
