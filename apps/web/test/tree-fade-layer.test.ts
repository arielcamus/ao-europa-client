import { describe, expect, it } from 'vitest';
import { TREE_GRH_INDICES, layer4TreeCoversPlayer, rowSlot, treeCoversPlayer } from '../src/map-objects.js';

// Pinned client 619e69d, TileEngine_RenderScreen.bas row pass: object trees fade at |dx| < 3, |dy| < 8; the map's Graphic(3)
// sprites flagged FLAG_ARBOL (clsTileEngineHelper.ValidTreeIndices) at |dx| <= 3, |dy| < 12; both only when the tree is south of the player.
describe('row-layer tree fade (RenderScreen FLAG_ARBOL)', () => {
  it('knows the pinned ValidTreeIndices', () => {
    expect(TREE_GRH_INDICES.size).toBe(123);
    for (const grh of [643, 12164, 55642, 32135]) expect(TREE_GRH_INDICES.has(grh)).toBe(true);
    expect(TREE_GRH_INDICES.has(1)).toBe(false);
  });
  it('covers a wider area than the object-tree rule', () => {
    const player = { x: 50, y: 50 };
    expect(layer4TreeCoversPlayer(player, 53, 61)).toBe(true);
    expect(treeCoversPlayer(player, 53, 61)).toBe(false);
    expect(layer4TreeCoversPlayer(player, 54, 51)).toBe(false);
    expect(layer4TreeCoversPlayer(player, 50, 62)).toBe(false);
  });
  it('never fades a tree north of or level with the player', () => {
    expect(layer4TreeCoversPlayer({ x: 50, y: 50 }, 50, 50)).toBe(false);
    expect(layer4TreeCoversPlayer({ x: 50, y: 50 }, 50, 49)).toBe(false);
  });
});

// Ariel 21 Nov: the priest drawn over the altar one row south of him (Nix temple, altar Graphic(3) 49383 at 25,54, priest at 25,53).
describe('row pass order (RenderScreen "Layer 3 & chars")', () => {
  it('draws a row\'s characters, then its objects, then the next row', () => {
    expect(rowSlot(53, 'characters')).toBeLessThan(rowSlot(53, 'objects'));
    expect(rowSlot(53, 'objects')).toBeLessThan(rowSlot(54, 'characters'));
    // the altar (row 54) covers the priest (row 53) whatever row the player stands on
    expect(rowSlot(54, 'objects')).toBeGreaterThan(rowSlot(53, 'characters'));
  });
});
