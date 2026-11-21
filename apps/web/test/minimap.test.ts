import { describe, expect, it } from 'vitest';
import { ALLY_BOX, minimapDotPixel, minimapDotPosition, minimapTile, minimapUrl, parseQuestNpcDots } from '../src/minimap.js';
import { canvasResolution, classicScale, fitBox } from '../src/classic-layout.js';

describe('minimap (frmMain.SetMinimapPosition, mode 0)', () => {
  it('stretches the playable area (tiles 13..87 x 10..90) over the 100px picture, centring the 5px dot', () => {
    // (50-11-2)*100/74 = 50 ; minus 5\2 + 1 = 3 ; (50-9-1)*100/80 = 50 ; minus 3
    const at = (x: number, y: number) => { const p = minimapDotPosition(x, y); return [p.left, p.top]; };
    expect(at(50, 50)[0]).toBeCloseTo(47, 9); expect(at(50, 50)[1]).toBeCloseTo(47, 9);
    expect(at(13, 10)[0]).toBeCloseTo(-3, 9); expect(at(13, 10)[1]).toBeCloseTo(-3, 9);
    expect(at(87, 90)[0]).toBeCloseTo(97, 9); expect(at(87, 90)[1]).toBeCloseTo(97, 9);
  });
  it('puts the player dot on the whole pixel the VB6 formula gives: corners, edges and centre of the playable area', () => {
    // Hand-computed from frmMain.SetMinimapPosition with HalfWindowTileWidth 11, HalfWindowTileHeight 9, personaje(0) 5 x 5:
    //   left = (x - 13) * 100 / 74 - 3, top = (y - 10) * 100 / 80 - 3, then the nearest pixel.
    const table: [number, number, number, number][] = [
      [13, 10, -3, -3], [87, 10, 97, -3], [13, 90, -3, 97], [87, 90, 97, 97], // the four corners of the picture
      [50, 50, 47, 47], // centre
      [14, 11, -2, -2], // (1 * 1.3514 - 3 = -1.65, 1.25 - 3 = -1.75)
      [62, 41, 63, 36], // (49 * 1.3514 - 3 = 63.22, 31 * 1.25 - 3 = 35.75)
      [86, 89, 96, 96], // (73 * 1.3514 - 3 = 95.65, 79 * 1.25 - 3 = 95.75)
      [30, 70, 20, 72], // (17 * 1.3514 - 3 = 19.97, 60 * 1.25 - 3 = 72)
    ];
    for (const [x, y, left, top] of table) expect(minimapDotPixel(x, y), `tile ${x},${y}`).toEqual({ left, top });
    // The dot's centre (box + 2) is the tile's pixel on the picture: the centre tile 50,50 is pixel 49,49 of the 100 x 100 picture.
    expect(minimapDotPixel(50, 50).left + 2).toBe(49);
  });
  it('places the ally circles from their 10 x 4 box (personaje(1..5): Width \\ 2 = 5, Height \\ 2 = 2)', () => {
    expect(ALLY_BOX).toEqual({ width: 10, height: 4 });
    expect(minimapDotPixel(50, 50, 10, 4)).toEqual({ left: 44, top: 47 }); // 50 - 5 - 1, 50 - 2 - 1
  });
  it('quest markers land on the same pixel as a dot on that tile (ConvertToMinimapPosition with the 2 x 0 marker)', () => {
    const bytes = new Uint8Array(2 + 800), view = new DataView(bytes.buffer);
    view.setInt16(0, 1, true);
    [[1, 13, 10, 1], [2, 87, 90, 2], [3, 50, 50, 1]].forEach((slot, i) => slot.forEach((v, j) => view.setInt16(2 + i * 8 + j * 2, v, true)));
    // x = (x - 13) * 100 / 74 - 1 - 1, y = (y - 10) * 100 / 80 - 0 - 1: the 2 x 2 square starts one pixel up-left of the tile pixel.
    expect(parseQuestNpcDots(bytes).get(1)).toEqual([{ x: -2, y: -1, state: 1 }, { x: 98, y: 99, state: 2 }, { x: 48, y: 49, state: 1 }]);
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
  it('counts whole numbers in device pixels: a Retina 1.5x is 3 device pixels per art pixel', () => {
    // MacBook 14" window, 1512x982 at DPR 2: 2.56 device px per art px. Fill keeps 1.279 (whole 2 would waste 22%); whole letterboxes at CSS 1.
    expect(classicScale(1512, 982, 2, 'fill')).toBeCloseTo(982 / 768); expect(classicScale(1512, 982, 2, 'whole')).toBe(1);
    expect(classicScale(1600, 1180, 2, 'fill')).toBe(1.5); // 3.07 device px: snaps to 3 (wastes 2%)
    expect(classicScale(1600, 1180, 2)).toBeCloseTo(1180 / 768); // the default counts CSS pixels, as before
    expect(classicScale(1920, 1080, 1, 'fill')).toBeCloseTo(1080 / 768); expect(classicScale(1920, 1080, 1, 'whole')).toBe(1);
    expect(classicScale(2560, 1440, 1, 'whole')).toBe(1); expect(classicScale(2100, 1600, 1, 'whole')).toBe(2);
    // Phones shrink exactly as before (fewer device pixels than art pixels).
    expect(classicScale(390, 844, 2, 'fill')).toBeCloseTo(390 / 1024); expect(classicScale(390, 844, 2, 'whole')).toBeCloseTo(390 / 1024);
    expect(classicScale(800, 700, 2, 'fill')).toBeCloseTo(800 / 1024); expect(classicScale(800, 700, 2, 'whole')).toBe(0.5);
  });
  it('renders the world canvas at the on-screen device pixels with fill/whole, phones and the default keep DPR (max 2)', () => {
    expect(canvasResolution(982 / 768, 2)).toBe(2); expect(canvasResolution(1.40625, 1)).toBe(1); // default: as before
    expect(canvasResolution(982 / 768, 2, 'fill')).toBeCloseTo(2 * 982 / 768); expect(canvasResolution(1, 1, 'whole')).toBe(1);
    expect(canvasResolution(1.40625, 1, 'fill')).toBe(1.40625); expect(canvasResolution(3, 2, 'fill')).toBe(4);
    expect(canvasResolution(390 / 1024, 2, 'fill')).toBe(2); expect(canvasResolution(390 / 1024, 1, 'fill')).toBe(1); expect(canvasResolution(390 / 1024, 3, 'fill')).toBeCloseTo(390 * 3 / 1024);
  });
  it('sizes the centring box so the art starts on a whole device pixel', () => {
    expect(fitBox(1024, 1920, 1)).toBe(1024); expect(fitBox(1024, 1921, 1)).toBe(1025); // 897 left over would centre at x 448.5
    expect(fitBox(1024 * 982 / 768, 1512, 2)).toBe(1310); // 2618.67 device px -> 2619, odd room 405 -> 2620
    expect((1512 - fitBox(1024 * 982 / 768, 1512, 2)) / 2 * 2 % 1).toBe(0);
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
