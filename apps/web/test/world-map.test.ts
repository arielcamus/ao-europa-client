import { describe, expect, it } from 'vitest';
import { parseIni } from '../src/assets.js';
import { BIG_TILE, CELL_PX, bigMapCell, bigMapPlayer, cellDraws, centeredDot, centeredView, clanCallMarker, findMap, parseWorlds } from '../src/world-map.js';
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
