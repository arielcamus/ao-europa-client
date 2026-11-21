import { describe, expect, it } from 'vitest';
import { characterAnchors } from '../src/character-render.js';

// engine.bas Char_Render (live), HeadOffset already includes BodyOffset (Recursos.bas): OffArma = (7 if dwarf) - BodyOffset.y; OffHead = HeadOffset.y - 1 - BodyOffset.y;
// the composed texture is presented at PixelOffset + BodyOffset, so the net offsets from the tile are below.
describe('characterAnchors (engine.bas Char_Render)', () => {
  it('human: no +1 on body x, head at HeadOffset.y - 1', () => {
    const a = characterAnchors({ bodyX: 0, bodyY: 0, headOffsetX: 0, headOffsetY: -8 }, false);
    expect(a.body).toEqual({ x: 0, y: 0 });
    expect(a.equipment).toEqual({ x: 0, y: 0 });
    expect(a.head).toEqual({ x: 0, y: -9 });
  });
  it('mounted rider, body 3075 (ini HeadOffsetY -58, BodyOffsetY 32): HeadOffset is combined, so -26, a dwarf in VB6', () => {
    // Recursos.bas CargarCuerpos: HeadOffset = ini HeadOffset + BodyOffset. The head sits 59 px above the body, as the pinned client draws it.
    const a = characterAnchors({ bodyX: 0, bodyY: 32, headOffsetX: 0, headOffsetY: -58 + 32 }, true);
    expect(a.body).toEqual({ x: 0, y: 32 });
    expect(a.head).toEqual({ x: 0, y: -27 });
    expect(a.head.y - a.body.y).toBe(-59);
    expect(a.equipment).toEqual({ x: 0, y: 7 }); // EsEnano: weapon 7 px lower
  });
  it('body x offset applies to the composed texture and again through the combined HeadOffset.x', () => {
    const a = characterAnchors({ bodyX: 3, bodyY: -5, headOffsetX: 2 + 3, headOffsetY: -20 - 5 }, false);
    expect(a.body).toEqual({ x: 3, y: -5 });
    expect(a.equipment).toEqual({ x: 3, y: 0 });
    expect(a.head).toEqual({ x: 8, y: -26 });
  });
  it('dwarf: weapon and shield 7 px lower', () => {
    expect(characterAnchors({ bodyX: 0, bodyY: 0, headOffsetX: 0, headOffsetY: -26 }, true).equipment.y).toBe(7);
  });
});
