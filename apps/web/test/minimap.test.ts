import { describe, expect, it } from 'vitest';
import { minimapDotPosition, minimapTile, minimapUrl } from '../src/minimap.js';
import { classicScale } from '../src/classic-layout.js';

describe('minimap (frmMain.SetMinimapPosition, mode 0)', () => {
  it('stretches the playable area (tiles 13..87 x 10..90) over the 100px picture, centring the 5px dot', () => {
    // (50-11-2)*100/74 = 50 ; minus 5\2 + 1 = 3 ; (50-9-1)*100/80 = 50 ; minus 3
    // VB6 assigns the Single to Shape.Left/Top unrounded; the page keeps the fraction and the browser snaps the box when it paints.
    const at = (x: number, y: number) => { const p = minimapDotPosition(x, y); return [p.left, p.top]; };
    expect(at(50, 50)[0]).toBeCloseTo(47, 9); expect(at(50, 50)[1]).toBeCloseTo(47, 9);
    expect(at(13, 10)[0]).toBeCloseTo(-3, 9); expect(at(13, 10)[1]).toBeCloseTo(-3, 9);
    expect(at(87, 90)[0]).toBeCloseTo(97, 9); expect(at(87, 90)[1]).toBeCloseTo(97, 9);
    expect(minimapDotPosition(51, 50).left).not.toBe(Math.round(minimapDotPosition(51, 50).left)); // a fractional pixel survives (<= 1 px from the old rounding)
  });
  it('maps a minimap pixel back to a tile (GetMinimapPosition)', () => {
    const t = minimapTile(50, 50);
    expect(t.x).toBeCloseTo(50, 5); expect(t.y).toBeCloseTo(50, 5);
    expect(minimapTile(0, 0)).toEqual({ x: 13, y: 11 });
  });
  it('loads the precomputed per-map picture', () => { expect(minimapUrl(73)).toBe('/ao-assets/Minimapas/mapa73.bmp'); });
});

describe('classic window scale', () => {
  it('shrinks on small screens exactly as before', () => {
    expect(classicScale(390, 844)).toBeCloseTo(390 / 1024); expect(classicScale(1024, 768)).toBe(1);
  });
  it('grows to fill a large window, whole number when it wastes little, otherwise fractional', () => {
    expect(classicScale(2048, 1536)).toBe(2); expect(classicScale(2100, 1600)).toBe(2);
    expect(classicScale(1440, 1000)).toBeCloseTo(1000 / 768); // 1.30: whole 1 would waste 23%
    expect(classicScale(1536, 1152)).toBe(1.5);
  });
});

describe('map tile hit testing under CSS scale', () => {
  it('gives the same tile for a click at 1x, 1.5x and 2x', async () => {
    const { WorldRenderer } = await import('../src/renderer.js');
    const at = (scale: number, tileDx: number, tileDy: number) => {
      const fake = {
        host: { getBoundingClientRect: () => ({ left: 10 * scale + 100, top: 150 * scale + 20, width: 736 * scale, height: 608 * scale }) },
        app: { screen: { width: 736, height: 608 } },
      };
      const session = { visualPosition: () => ({ x: 50, y: 50 }) };
      // The character is drawn at the viewport centre; click tileDx/tileDy tiles away from it, at this scale.
      const cx = 10 * scale + 100 + 368 * scale, cy = 150 * scale + 20 + 304 * scale;
      return (WorldRenderer.prototype.tileAt as (...a: unknown[]) => unknown).call(fake, session, cx + tileDx * 32 * scale, cy + tileDy * 32 * scale, 0);
    };
    for (const scale of [1, 1.5, 2]) {
      expect(at(scale, 0, 0), `centre @${scale}`).toEqual({ x: 50, y: 50 });
      expect(at(scale, 3, 0), `east @${scale}`).toEqual({ x: 53, y: 50 });
      expect(at(scale, -2, 4), `south-west @${scale}`).toEqual({ x: 48, y: 54 });
    }
  });
});
