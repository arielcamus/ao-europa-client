import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap, tileIndex } from '../src/assets.js';
import { ObjType, TreeFade, fixedObjects, objectDraws, parseObjectGraphics, tileKey, treeCoversPlayer } from '../src/map-objects.js';

// Original synthetic data. Object 150 is a tree like Ullathorpe's (map 1, tile 28,50); 200 is a floor item, 6 a door.
const OBJ_DAT = '[OBJ150]\nGrhIndex=12160\nObjType=4\n[OBJ200]\nGrhIndex=500\nObjType=11\n[OBJ6]\nGrhIndex=700\nObjType=6\n[OBJ30]\nGrhIndex=900\nObjType=8\n[OBJ31]\nGrhIndex=0\nObjType=4\n';

/** A legacy CSM with one particle, one light and the given objects, so the sections BEFORE the objects must be skipped right. */
function mapWithObjects(objects: Array<[number, number, number, number]>) {
  const chunks: Buffer[] = [];
  const n = (value: number, size: number) => { const b = Buffer.alloc(size); b.writeIntLE(value, 0, size); chunks.push(b); };
  const text = (value: string) => { const b = Buffer.from(value, 'latin1'); n(b.length, 2); chunks.push(b); };
  n(0, 4); for (let i = 0; i < 4; i++) n(0, 4);                        // blocked, four layers
  n(1, 4); n(1, 4); n(1, 4); n(0, 4); n(objects.length, 4); n(0, 4);  // triggers, lights, particles, npcs, objects, exits
  for (let i = 0; i < 4; i++) n(0, 2);
  text('Arboleda'); n(0, 1); text(''); n(0, 4); n(0, 4); n(1, 1); text(''); text(''); text('');
  for (let i = 0; i < 4; i++) n(0, 4);
  text(''); n(0, 1); n(0, 1); n(0, 1);
  n(5, 2); n(5, 2); n(61, 2);                                           // trigger
  n(7, 2); n(7, 2); n(99, 4);                                           // particle x,y,index
  n(8, 2); n(8, 2); n(1, 1); n(2, 1); n(3, 1); n(127, 1); n(4, 1);      // light x,y,RGBA,range
  for (const [x, y, index, amount] of objects) { n(x, 2); n(y, 2); n(index, 2); n(amount, 2); }
  return Buffer.concat(chunks);
}

describe('trees and other fixed objects live in the map file, not in server packets', () => {
  const graphics = parseObjectGraphics(OBJ_DAT);
  it('reads the object section after skipping particles and lights', () => {
    const map = parseMap(mapWithObjects([[28, 50, 150, 1], [30, 43, 200, 3]]));
    expect(map.triggers[tileIndex(5, 5)]).toBe(61);
    expect(map.objects).toEqual([{ x: 28, y: 50, objIndex: 150, amount: 1 }, { x: 30, y: 43, objIndex: 200, amount: 3 }]);
  });
  it('keeps only what the server never sends (trees, signs, deposits, decorations), as TileEngine_Map.EsObjetoFijo', () => {
    const map = parseMap(mapWithObjects([[28, 50, 150, 1], [30, 43, 200, 3], [10, 10, 6, 1], [11, 11, 30, 1], [12, 12, 31, 1]]));
    const fixed = fixedObjects(map.objects, graphics);
    expect([...fixed.keys()].sort()).toEqual([tileKey(11, 11), tileKey(28, 50)].sort()); // item, door and graphic-less tree excluded
    expect(fixed.get(tileKey(28, 50))?.objIndex).toBe(150);
  });
  it('draws a tree twice like RenderScreen: under characters and again in the row pass over them', () => {
    expect(objectDraws({ objIndex: 150, amount: 1, elementalTags: 0 }, graphics)).toEqual([
      { pass: 'ground', grh: 12160, type: ObjType.Tree }, { pass: 'row', grh: 12160, type: ObjType.Tree },
    ]);
    expect(objectDraws({ objIndex: 200, amount: 1, elementalTags: 0 }, graphics)).toEqual([{ pass: 'ground', grh: 500, type: 11 }]);
    expect(objectDraws(undefined, graphics)).toEqual([]);
  });
  it('draws an anvil and a castle spawner in the ground pass too: the Select Case Else is not only for items', () => {
    const dat = parseObjectGraphics('[OBJ1]\nObjType=27\nGrhIndex=700\n[OBJ2]\nObjType=10\nGrhIndex=701\n[OBJ3]\nObjType=19\nGrhIndex=702\n');
    const of = (objIndex: number) => objectDraws({ objIndex, amount: 1, elementalTags: 0 }, dat).map(d => d.pass);
    expect(of(1)).toEqual(['ground', 'row']); // anvil: Else under characters, big object over them
    expect(of(2)).toEqual(['ground', 'row']); // castle spawner
    expect(of(3)).toEqual(['ground']);        // teleport: ground list only
  });
  it('fades a tree to 130/255 in 150 ms when it is south of the player, and back', () => {
    expect(treeCoversPlayer({ x: 28, y: 45 }, 28, 50)).toBe(true);
    expect(treeCoversPlayer({ x: 28, y: 52 }, 28, 50)).toBe(false); // player south of the tree
    expect(treeCoversPlayer({ x: 40, y: 45 }, 28, 50)).toBe(false);
    const fade = new TreeFade(); let alpha = 1;
    for (let i = 0; i < 12; i++) alpha = fade.step(1, true, 16);
    expect(alpha).toBeCloseTo(130 / 255, 5);
    for (let i = 0; i < 12; i++) alpha = fade.step(1, false, 16);
    expect(alpha).toBe(1);
  });
  // Opt-in against the real Ullathorpe map when the local resources are present (never bundled).
  const real = process.env.AO_ASSETS ? `${process.env.AO_ASSETS}/Mapas/mapa1.csm` : '';
  it.skipIf(!real || !existsSync(real))('map 1 (Ullathorpe) has its tree at 28,50 as object 150 (Arbol, grh 12160)', () => {
    const map = parseMap(readFileSync(real));
    expect(map.objects.find(o => o.x === 28 && o.y === 50)).toMatchObject({ objIndex: 150 });
    const dat = parseObjectGraphics(readFileSync(`${process.env.AO_ASSETS}/Dat/Obj.dat`, 'latin1'));
    expect(fixedObjects(map.objects, dat).size).toBeGreaterThan(80);
    expect(objectDraws(fixedObjects(map.objects, dat).get(tileKey(28, 50)), dat).map(d => d.pass)).toEqual(['ground', 'row']);
  });
});
