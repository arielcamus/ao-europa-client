import { describe, expect, it } from 'vitest';
import { eraseCaptions } from '../src/caption-erase.js';
import { CAPTIONS } from '../src/ui-captions-data.js';
import { captionsFor } from '../src/ui-captions.js';

/** A 60x20 dark brushed face (rows vary, columns repeat) with optional bright "letters" and a frame line on row 2. */
function face(letters: [number, number, number, number][], { line = false, dark = false } = {}) {
  const w = 60, h = 20, px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, v = dark ? 200 + (y % 3) * 4 + (x % 2) : 30 + (y % 3) * 4 + (x % 2);
    px.set([v, v, v - 2, 255], i);
  }
  if (line) for (let x = 0; x < w; x++) px.set([180, 180, 180, 255], (2 * w + x) * 4);
  for (const [x0, y0, lw, lh] of letters) for (let y = y0; y < y0 + lh; y++) for (let x = x0; x < x0 + lw; x++) {
    const v = dark ? 20 : 235; px.set([v, v, v, 255], (y * w + x) * 4);
  }
  return { w, h, px };
}
const lum = (px: Uint8ClampedArray, w: number, x: number, y: number) => px[(y * w + x) * 4]!;

describe('painting out baked captions', () => {
  it('finds the letters, reports their box and colour, and fills them with the face around them', () => {
    const { w, h, px } = face([[10, 6, 2, 9], [14, 6, 6, 2], [14, 13, 6, 2], [24, 6, 2, 9]]);
    const [found] = eraseCaptions(px, w, h, [{ text: 'AB', box: [5, 3, 50, 16] }]);
    expect(found).toMatchObject({ text: 'AB', font: 'serif', x: 10, y: 6, width: 16, height: 9, color: 'rgb(235,235,235)' });
    for (let y = 6; y < 15; y++) for (const x of [10, 15, 25]) expect(lum(px, w, x, y)).toBeLessThan(60); // no bright letter pixel left
  });
  it('keeps a frame line that crosses the box, and handles dark letters on parchment', () => {
    const lined = face([[20, 8, 3, 8]], { line: true });
    eraseCaptions(lined.px, lined.w, lined.h, [{ text: 'I', box: [0, 0, 60, 20] }]);
    expect(lum(lined.px, lined.w, 30, 2)).toBe(180);
    expect(lum(lined.px, lined.w, 21, 10)).toBeLessThan(60);
    const parchment = face([[20, 8, 3, 8]], { dark: true });
    const [found] = eraseCaptions(parchment.px, parchment.w, parchment.h, [{ text: 'I', box: [10, 4, 30, 14], dark: true }]);
    expect(found).toMatchObject({ x: 20, width: 3, color: 'rgb(20,20,20)' });
    expect(lum(parchment.px, parchment.w, 21, 10)).toBeGreaterThan(180);
  });
  it('reports the height of the capitals alone when an accent floats above them (CONTRASEÑA beside EMAIL)', () => {
    const plain = face([[10, 8, 2, 8], [14, 8, 6, 2], [14, 14, 6, 2]]);
    expect(eraseCaptions(plain.px, plain.w, plain.h, [{ text: 'AB', box: [5, 3, 50, 16] }])[0]!.capHeight).toBeUndefined();
    // Two capitals 8 px tall on the line, a 2 px tilde detached 2 px above one of them: the box is 12 tall, the capitals 8.
    const accented = face([[10, 8, 2, 8], [14, 8, 6, 2], [14, 14, 6, 2], [24, 8, 2, 8], [24, 4, 5, 2]]);
    const [found] = eraseCaptions(accented.px, accented.w, accented.h, [{ text: 'AÑ', box: [5, 1, 50, 18] }]);
    expect(found).toMatchObject({ y: 4, height: 12, capHeight: 8 });
  });
  it('leaves a box without letters untouched', () => {
    const { w, h, px } = face([]), copy = Uint8ClampedArray.from(px);
    expect(eraseCaptions(px, w, h, [{ text: 'X', box: [0, 0, 60, 20] }])[0]!.pixels).toBe(0);
    expect(px).toEqual(copy);
  });
  it('looks captions up by file name, any language prefix or button state', () => {
    expect(captionsFor('boton-video-off')).toBe(CAPTIONS['boton-video']);
    expect(captionsFor('es_ventanaprincipal')).toBe(CAPTIONS.ventanaprincipal);
    expect(captionsFor('boton-cerrar-default')).toBeUndefined();
    for (const [name, specs] of Object.entries(CAPTIONS)) for (const spec of specs) {
      expect(spec.text.trim(), name).toBe(spec.text); expect(spec.text.length, name).toBeGreaterThan(1);
      expect(spec.box.every(v => Number.isInteger(v) && v >= 0), `${name} ${spec.text}`).toBe(true);
    }
  });
});
