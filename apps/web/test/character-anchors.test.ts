import { describe, expect, it } from 'vitest';
import { characterAnchors } from '../src/character-render.js';

// engine.bas Char_Render (live): OffArma = (7 if dwarf) - BodyOffset.y; OffHead = HeadOffset.y - 1 - BodyOffset.y;
// the composed texture is presented at PixelOffset + BodyOffset, so the net offsets from the tile are below.
describe('characterAnchors (engine.bas Char_Render)', () => {
  it('human: no +1 on body x, head at HeadOffset.y - 1', () => {
    const a = characterAnchors({ bodyX: 0, bodyY: 0, headOffsetX: 0, headOffsetY: -8 }, false);
    expect(a.body).toEqual({ x: 0, y: 0 });
    expect(a.equipment).toEqual({ x: 0, y: 0 });
    expect(a.head).toEqual({ x: 0, y: -9 });
  });
  it('body offset cancels in OffHead and OffArma: head and weapon do not move with BodyOffset.y', () => {
    const a = characterAnchors({ bodyX: 3, bodyY: -5, headOffsetX: 2, headOffsetY: -20 }, false);
    expect(a.body).toEqual({ x: 3, y: -5 });
    expect(a.equipment).toEqual({ x: 3, y: 0 });
    expect(a.head).toEqual({ x: 5, y: -21 });
  });
  it('dwarf: weapon and shield 7 px lower', () => {
    expect(characterAnchors({ bodyX: 0, bodyY: 0, headOffsetX: 0, headOffsetY: -26 }, true).equipment.y).toBe(7);
  });
});
