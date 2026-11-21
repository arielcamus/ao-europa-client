import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseIni } from '../src/assets.js';
import { BIG_COLUMNS, BIG_TILE, CELL_PX, bigMapCell, bigMapPlayer, cellDraws, centeredDot, centeredView, clanCallMarker, findMap, parseWorlds } from '../src/world-map.js';
import { cByte, minimapTile } from '../src/minimap.js';
import { WorldFx } from '../src/fx-world.js';
import { WorldServerPacketId as W, decodeServerPacket, encodeServerPacket } from '@ao/protocol';

const DAT = '[INIT]\nTOTALWORLDS=2\n[WORLDMAP1]\nALTO=2\nANCHO=3\n1=842\n2=0\n3=133\n4=67\n5=1\n6=2\n[WORLDMAP2]\nALTO=1\nANCHO=1\n1=300\n';
const worlds = parseWorlds(parseIni(DAT));

describe('mapsworlddata.dat (Cargarmapsworlddata)', () => {
  it('reads each world as a row-major grid of map numbers', () => {
    expect(worlds).toEqual([{ ancho: 3, alto: 2, indice: [842, 0, 133, 67, 1, 2] }, { ancho: 1, alto: 1, indice: [300] }]);
  });
  it('finds a map: world and 1-based cell, first world wins, 0 and unknown are absent', () => {
    expect(findMap(worlds, 1)).toEqual({ world: 1, cell: 5 });
    expect(findMap(worlds, 300)).toEqual({ world: 2, cell: 1 });
    expect(findMap(worlds, 0)).toBeUndefined(); expect(findMap(worlds, 999)).toBeUndefined();
  });
});

describe('centred minimap (ModMinimap.RenderMinimapCentered)', () => {
  it('centres the 100 px crop on the player tile inside the map cell of the 200 px-per-map world picture', () => {
    // map 1 = cell 5: column 1, row 1. Tile (50,50): (1 + (50-14+.5)/74) * 200 = 298.65 -> 299 ; (1 + (50-11+.5)/80) * 200 = 298.75 -> 299.
    const v = centeredView(worlds[0]!, 5, 50, 50, 0);
    expect([v.srcW, v.srcH, v.srcX, v.srcY]).toEqual([100, 100, 249, 249]);
    expect([v.gridX, v.gridY, v.cellW, v.cellH]).toEqual([1, 1, 200, 200]);
  });
  it('zooms with CenteredMinimapZoom: a smaller crop zooms in, clamped to +-50; a crop never leaves the picture', () => {
    expect(centeredView(worlds[0]!, 5, 50, 50, -50).srcW).toBe(50);
    expect(centeredView(worlds[0]!, 5, 50, 50, 50).srcW).toBe(150);
    expect(centeredView(worlds[0]!, 5, 50, 50, 500).srcW).toBe(150);
    const corner = centeredView(worlds[0]!, 1, 14, 11, 0); // top-left of the picture: the crop is pushed back inside
    expect([corner.srcX, corner.srcY]).toEqual([0, 0]);
    const far = centeredView(worlds[1]!, 1, 87, 90, 50); // a one-cell world is 200 px: a 150 px crop ends at the edge
    expect(far.srcX + far.srcW).toBeLessThanOrEqual(200);
  });
  it('clamps tiles outside 14..87 x 11..90 before centring', () => {
    expect(centeredView(worlds[0]!, 5, 1, 1, 0)).toEqual(centeredView(worlds[0]!, 5, 14, 11, 0));
    expect(centeredView(worlds[0]!, 5, 100, 100, 0)).toEqual(centeredView(worlds[0]!, 5, 87, 90, 0));
  });
  it('puts the player dot in the middle and projects an ally onto the crop', () => {
    const v = centeredView(worlds[0]!, 5, 50, 50, 0);
    expect(centeredDot(v, 0, 50, 50)).toEqual({ x: 50, y: 50 });
    const ally = centeredDot(v, 1, 60, 50);
    expect(ally.x).toBeGreaterThan(50); expect(ally.y).toBeGreaterThanOrEqual(49); expect(ally.y).toBeLessThanOrEqual(51);
  });
  it('lists the 100x100 map pictures the crop touches and where they land in the control', () => {
    const inside = cellDraws(worlds[0]!, centeredView(worlds[0]!, 5, 50, 50, 0)); // crop 249..349 sits inside cell 5
    expect(inside.map(d => d.cell)).toEqual([5]);
    const edge = centeredView(worlds[0]!, 5, 14, 11, 0); // crop 151..251 spans four cells
    const draws = cellDraws(worlds[0]!, edge);
    expect(draws.map(d => d.cell).sort()).toEqual([1, 2, 4, 5]);
    for (const set of [inside, draws]) expect(set.reduce((sum, d) => sum + d.dw * d.dh, 0)).toBeCloseTo(100 * 100, 4); // the pieces tile the control exactly
    expect(CELL_PX).toBe(200);
  });
});

describe('GetMinimapPosition and CByte (the right click sends /TELEP)', () => {
  it('maps a pixel to the tile with the mode-0 stretch, VB6 CByte rounds half to even', () => {
    expect(minimapTile(50, 50)).toEqual({ x: 50, y: expect.closeTo(50, 6) });
    expect([cByte(2.5), cByte(3.5), cByte(49.4), cByte(49.6)]).toEqual([2, 4, 49, 50]);
  });
});

describe('frmMapaGrande geometry', () => {
  it('finds the cell and its corner under a pixel of the 27 px grid', () => {
    expect(bigMapCell(0, 0)).toEqual({ cell: 1, left: 0, top: 0 });
    expect(bigMapCell(28, 54)).toEqual({ cell: 2 + 2 * 19, left: 27, top: 54 });
  });
  it('places the player marker inside the cell (ActualizarPosicion) and the clan-call marker at x / 4.5', () => {
    expect(bigMapPlayer(1, 50, 50)).toEqual({ left: 13.5 - 2, top: 13.5 - 2 });
    expect(bigMapPlayer(2, 0, 100)).toEqual({ left: BIG_TILE - 2, top: BIG_TILE - 2 });
    expect(clanCallMarker(20, 45, 90)).toEqual({ left: 0 + 10, top: BIG_TILE + 20, squareLeft: 0, squareTop: BIG_TILE });
  });
});

describe('Ubicacion (144) and ShowFrmMapa (138)', () => {
  it('round-trips both packets', () => {
    for (const packet of [{ id: W.Ubicacion, member: 2, x: 40, y: 50, map: 1 }, { id: W.ShowFrmMapa, expMult: 2, goldMult: 3 }] as const) {
      expect(decodeServerPacket(encodeServerPacket(packet as never))).toMatchObject(packet);
    }
  });
  it('an ally dot follows Ubicacion only on the player map and x = 0 hides it (HandleUbicacion)', () => {
    const world = new WorldFx(() => 0, { currentMap: () => 1 });
    world.receive({ id: W.Ubicacion, member: 2, x: 40, y: 50, map: 1 } as never);
    expect(world.allies.get(2)).toEqual({ x: 40, y: 50 });
    world.receive({ id: W.Ubicacion, member: 3, x: 41, y: 51, map: 9 } as never); expect(world.allies.has(3)).toBe(false);
    world.receive({ id: W.Ubicacion, member: 2, x: 0, y: 0, map: 0 } as never); expect(world.allies.has(2)).toBe(false);
  });
  it('ShowFrmMapa counts openings and keeps the multipliers', () => {
    const world = new WorldFx(() => 0);
    world.receive({ id: W.ShowFrmMapa, expMult: 2, goldMult: 3 } as never);
    expect(world.mapForm).toEqual({ opened: 1, expMult: 2, goldMult: 3 });
  });
});

// Ariel, 21 Nov: "I'm in the dungeon newbie. The minimap looks good, but the big map shows me in the wrong place." The pinned grid
// (mapsworlddata.dat, Recursos 043cdf20) and the pinned client agree with ours; the world-2 picture is the one that moved (847f4a23).
// docs/DATA-PATCHES.md section 9, tools/data-patches/apply-worldmap-picture.py.
const assetsRoot = process.env.AO_ASSETS;
const gridFile = assetsRoot ? join(assetsRoot, 'init', 'mapsworlddata.dat') : '';
describe.skipIf(!gridFile || !existsSync(gridFile))('frmMapaGrande on the real mapsworlddata.dat', () => {
  const real = () => parseWorlds(parseIni(readFileSync(gridFile, 'latin1')));
  it('finds the Newbie Dungeon and a few others where CalcularPosicionMAPA does (world, 1-based cell)', () => {
    const grid = real();
    expect(grid.map(w => [w.ancho, w.alto])).toEqual([[19, 22], [19, 22], [19, 22]]); // TotalWorlds = 3: [WORLDMAP4] is never read
    const at = (map: number) => findMap(grid, map);
    // The Newbie Dungeon is a 2 x 2 block on the dungeon world: 37 168 / 264 167 at columns 10-11, rows 11-12.
    expect([37, 168, 264, 167].map(at)).toEqual([{ world: 2, cell: 220 }, { world: 2, cell: 221 }, { world: 2, cell: 239 }, { world: 2, cell: 240 }]);
    expect(at(1)).toEqual({ world: 1, cell: 253 }); // Ullathorpe, column 5 row 13
    expect(at(22)).toEqual({ world: 1, cell: 311 }); // a field south of Ullathorpe
    expect(at(40)).toEqual({ world: 2, cell: 276 }); // Catacumbas
    expect(at(751)).toEqual({ world: 3, cell: 200 }); // Forgat
  });
  it('puts Shape1 for map 167 tile (50,93) inside cell 240: x = 11 * 27 + 50 * 27 / 100 - 2, y = 12 * 27 + 93 * 27 / 100 - 2', () => {
    const { left, top } = bigMapPlayer(240, 50, 93);
    expect(left).toBeCloseTo(297 + 13.5 - 2, 6); expect(top).toBeCloseTo(324 + 25.11 - 2, 6);
    expect(bigMapCell(left + 2, top + 2).cell).toBe(240);
  });
  const picture = (world: number) => join(assetsRoot!, 'interface', `es_mapa${world}.bmp`);
  /** Maps whose 27 px cell of the world picture is (almost) all black; the world's filler number (300 / 400) is skipped. */
  const onBlack = (world: number) => {
    const b = readFileSync(picture(world)), off = b.readUInt32LE(10), w = b.readInt32LE(18), h = b.readInt32LE(22), bpp = b.readUInt16LE(28);
    const stride = Math.ceil((w * bpp) / 8 / 4) * 4, rows = Math.abs(h);
    const lit = (x: number, y: number) => { const i = off + (h > 0 ? rows - 1 - y : y) * stride + x * (bpp / 8); return Math.max(b[i]!, b[i + 1]!, b[i + 2]!) > 24; };
    const indice = real()[world - 1]!.indice, counts = new Map<number, number>();
    for (const m of indice) counts.set(m, (counts.get(m) ?? 0) + 1);
    const filler = [...counts].sort((a, c) => c[1] - a[1])[0]![0];
    const dark: number[] = [];
    indice.forEach((map, i) => {
      if (!map || map === filler) return;
      const col = i % BIG_COLUMNS, row = Math.floor(i / BIG_COLUMNS); let n = 0;
      for (let y = row * BIG_TILE; y < Math.min(row * BIG_TILE + BIG_TILE, rows); y++) for (let x = col * BIG_TILE; x < Math.min(col * BIG_TILE + BIG_TILE, w); x++) if (lit(x, y)) n++;
      if (n < 20) dark.push(map);
    });
    return dark;
  };
  it('worlds 1 and 3: every mapped cell of the picture has art', () => {
    for (const world of [1, 3]) if (existsSync(picture(world))) expect(onBlack(world)).toEqual([]);
  });
  const patched = assetsRoot && existsSync(picture(2)) && createHash('sha256').update(readFileSync(picture(2))).digest('hex') === '80e768afb1c3adad522162bdb8f53d22276bdec1130270287307ebcb62bbce12';
  it.skipIf(!patched)('world 2 with the 043cdf20 picture (section 9 applied): the Newbie Dungeon and Catacumbas have art', () => {
    const dark = onBlack(2);
    for (const map of [37, 168, 264, 167, 40, 41, 42, 43, 44, 45]) expect(dark).not.toContain(map);
    expect(dark.length).toBeLessThanOrEqual(5); // 162, 163, 173, 577, 578: small dark maps
  });
});
