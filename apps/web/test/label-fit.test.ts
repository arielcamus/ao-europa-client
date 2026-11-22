import { describe, expect, it } from 'vitest';
import { BASE_LABEL_PX, MIN_LABEL_PX, fitFontSize } from '../src/label-fit.js';
import { paintOverLogoPixels } from '../src/logo-patch.js';

describe('fitFontSize', () => {
  it('keeps the classic size for text that fits', () => { expect(fitFontSize('90 / 100', 51 + 8)).toBe(BASE_LABEL_PX); });
  it('shrinks 180 / 180 into the 51 px stamina box instead of clipping it', () => {
    const size = fitFontSize('180 / 180', 51);
    expect(size).toBeLessThan(BASE_LABEL_PX); expect(size).toBeGreaterThanOrEqual(MIN_LABEL_PX);
  });
  it('fits +19% in the 22 px resistance box + slack, never below the floor', () => {
    expect(fitFontSize('+19%', 22 + 8)).toBeGreaterThanOrEqual(MIN_LABEL_PX);
    expect(fitFontSize('+9999999%', 10)).toBe(MIN_LABEL_PX);
  });
});
describe('paintOverLogoPixels', () => {
  it('blends the pixel left of the box into the pixel right of it, row by row, leaving the rest alone', () => {
    const width = 8, px = new Uint8ClampedArray(width * 1 * 4).fill(255);
    px.set([0, 0, 0, 255], 0); px.set([100, 100, 100, 255], 5 * 4); // x=0 left edge, x=5 right edge; box = x 1..4
    paintOverLogoPixels(px, width, [1, 0, 4, 1]);
    expect([...px.slice(4, 7)]).toEqual([20, 20, 20]); expect([...px.slice(16, 19)]).toEqual([80, 80, 80]);
    expect([...px.slice(24, 27)]).toEqual([255, 255, 255]);
  });
});
