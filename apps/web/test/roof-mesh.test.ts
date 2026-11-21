import { describe, expect, it } from 'vitest';
import { fillQuad } from '../src/roof-mesh.js';

describe('roof quads (RenderScreen layer 5: one colour per corner, clsBatch.Draw order)', () => {
  it('lays the quad out BL, TL, BR, TR with each corner colour, its uv and the roof alpha', () => {
    const out = { positions: new Float32Array(8), uvs: new Float32Array(8), colors: new Uint8Array(16) };
    const red = { r: 255, g: 0, b: 0 }, green = { r: 0, g: 255, b: 0 }, blue = { r: 0, g: 0, b: 255 }, grey = { r: 9, g: 9, b: 9 };
    // Pixi uvs: TL (x0,y0), TR (x1,y1), BR (x2,y2), BL (x3,y3).
    const texture = { width: 64, height: 96, uvs: { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.2, x2: 0.3, y2: 0.6, x3: 0.1, y3: 0.6 } };
    fillQuad(out, texture, 10.4, 20, [red, green, blue, grey], 0.5);
    expect(Array.from(out.positions)).toEqual([10, 116, 10, 20, 74, 116, 74, 20]);
    expect(Array.from(out.uvs).map(v => Math.round(v * 10) / 10)).toEqual([0.1, 0.6, 0.1, 0.2, 0.3, 0.6, 0.3, 0.2]);
    expect(Array.from(out.colors)).toEqual([255, 0, 0, 128, 0, 255, 0, 128, 0, 0, 255, 128, 9, 9, 9, 128]);
  });
});
