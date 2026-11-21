import { describe, expect, it } from 'vitest';
import { parseQuestNpcDots, questDotPixels } from '../src/minimap.js';

/** One map record as CargarNPCsMapData reads it: Integer map, then 100 x (NPCNumber, x, y, state). */
const record = (map: number, slots: [number, number, number, number][]) => {
  const bytes = new Uint8Array(2 + 800), view = new DataView(bytes.buffer);
  view.setInt16(0, map, true);
  slots.forEach((slot, i) => slot.forEach((value, j) => view.setInt16(2 + i * 8 + j * 2, value, true)));
  return bytes;
};
describe('quest NPC markers of the per-map minimap (ListNPCMapData, DibujarMiniMapa)', () => {
  it('reads the records, skips empty slots and converts tile to minimap pixel (ConvertToMinimapPosition, marker 2 x 0)', () => {
    const bytes = new Uint8Array([...record(1, [[419, 26, 16, 2]]), 0, 0, ...record(4, [[7, 50, 50, 1], [0, 0, 0, 0]])]);
    const dots = parseQuestNpcDots(bytes);
    expect([...dots.keys()]).toEqual([1, 4]);
    // x = (26 - 11 - 2) * (100/74) - 2 = 15.57 -> 16 ; y = (16 - 9 - 1) * (100/80) - 1 = 6.5 -> 6 (half to even)
    expect(dots.get(1)).toEqual([{ x: 16, y: 6, state: 2 }]);
    expect(dots.get(4)).toHaveLength(1);
  });
  it('paints a 2x2 square (cyan state 1, yellow otherwise) with the 8 grey pixels around it', () => {
    const pixels = questDotPixels({ x: 10, y: 20, state: 1 });
    expect(pixels).toHaveLength(12);
    expect(pixels.filter(p => p[2] === 'rgb(0,198,254)').map(p => `${p[0]},${p[1]}`).sort()).toEqual(['10,20', '10,21', '11,20', '11,21']);
    expect(pixels.filter(p => p[2] === '#808080').map(p => `${p[0]},${p[1]}`).sort()).toEqual(['10,19', '10,22', '11,19', '11,22', '12,20', '12,21', '9,20', '9,21']);
    expect(questDotPixels({ x: 0, y: 0, state: 2 })[0]![2]).toBe('rgb(255,201,14)');
  });
});
