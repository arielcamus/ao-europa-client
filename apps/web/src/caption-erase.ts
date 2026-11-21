/*
 * Finding and painting out the captions baked into interface bitmaps (pure pixel code, see ui-captions.ts). AGPL-3.0-or-later; see NOTICE.
 */
export type CaptionFont = 'serif' | 'sans' | 'book';

/** A caption baked into an interface bitmap: its words and the box (bitmap px) the search for its letters is limited to. */
export interface CaptionSpec {
  text: string;
  box: readonly [x: number, y: number, width: number, height: number];
  /** `serif`: the engraved capitals of buttons and titles (Cinzel); `sans`: the option rows (Tahoma); `book`: mixed-case serif labels (Georgia). */
  font?: CaptionFont;
  /** Dark letters on a light ground (parchment); by default the letters are the bright pixels. */
  dark?: boolean;
}

/** A caption as found in one bitmap: the box its letters fill and their colour. */
export interface FoundCaption {
  text: string;
  font: CaptionFont;
  x: number; y: number; width: number; height: number;
  color: string;
  /** Letter pixels found (a box with none keeps the bitmap as it was). */
  pixels: number;
}

const luminance = (px: Uint8ClampedArray | Uint8Array, i: number) => 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;

/**
 * Find each caption's letters in an RGBA bitmap and paint them over with the surrounding texture, in place. A letter pixel is clearly
 * brighter (or, `dark`, darker) than the box's median; the mask grows by two pixels (anti-aliasing, outline) and one more down-right (shadow).
 */
export function eraseCaptions(px: Uint8ClampedArray | Uint8Array, width: number, height: number, specs: readonly CaptionSpec[]): FoundCaption[] {
  return specs.map(spec => {
    const x0 = Math.max(0, spec.box[0]), y0 = Math.max(0, spec.box[1]);
    const x1 = Math.min(width, spec.box[0] + spec.box[2]), y1 = Math.min(height, spec.box[1] + spec.box[3]);
    const w = x1 - x0, h = y1 - y0, font = spec.font ?? 'serif';
    const none: FoundCaption = { text: spec.text, font, x: x0, y: y0, width: 0, height: 0, color: '#fff', pixels: 0 };
    if (w <= 2 || h <= 2) return none;
    const lum = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lum[y * w + x] = luminance(px, ((y0 + y) * width + x0 + x) * 4);
    const sorted = Float32Array.from(lum).sort();
    const median = sorted[sorted.length >> 1]!, mad = Float32Array.from(lum, v => Math.abs(v - median)).sort()[lum.length >> 1]!;
    const gap = Math.max(22, 4 * mad), sign = spec.dark ? -1 : 1;
    const core = new Uint8Array(w * h);
    for (let i = 0; i < core.length; i++) if (sign * (lum[i]! - median) > gap) core[i] = 1;
    // Grey or white letters next to a coloured icon (the gear, a bottle, keys): when most candidates are grey, the coloured ones are the icon.
    const chroma = (i: number) => {
      const o = ((y0 + Math.floor(i / w)) * width + x0 + (i % w)) * 4;
      return Math.max(px[o]!, px[o + 1]!, px[o + 2]!) - Math.min(px[o]!, px[o + 1]!, px[o + 2]!);
    };
    let grey = 0, all = 0;
    for (let i = 0; i < core.length; i++) if (core[i]) { all++; if (chroma(i) < 48) grey++; }
    if (grey > 0.5 * all) for (let i = 0; i < core.length; i++) if (core[i] && chroma(i) >= 48) core[i] = 0;
    // A frame or separator line crossing the box is not a letter: drop thin pieces that run most of the box.
    const seen = new Uint8Array(w * h);
    for (let i = 0; i < core.length; i++) if (core[i] && !seen[i]) {
      const piece = [i]; seen[i] = 1;
      let px0 = w, py0 = h, px1 = -1, py1 = -1;
      for (let k = 0; k < piece.length; k++) {
        const x = piece[k]! % w, y = Math.floor(piece[k]! / w);
        px0 = Math.min(px0, x); px1 = Math.max(px1, x); py0 = Math.min(py0, y); py1 = Math.max(py1, y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx, Y = y + dy, q = Y * w + X;
          if (X >= 0 && Y >= 0 && X < w && Y < h && core[q] && !seen[q]) { seen[q] = 1; piece.push(q); }
        }
      }
      const pw = px1 - px0 + 1, ph = py1 - py0 + 1;
      if ((ph <= 2 && pw >= 0.6 * w) || (pw <= 2 && ph >= 0.9 * h)) for (const q of piece) core[q] = 0;
    }
    let bx0 = w, by0 = h, bx1 = -1, by1 = -1, count = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (core[y * w + x]) {
      count++; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
    }
    if (count < 6) return none;
    // Colour: the mean of the strongest third of the letter pixels (brightest, or darkest for dark letters).
    const letters: number[] = [];
    for (let i = 0; i < core.length; i++) if (core[i]) letters.push(i);
    letters.sort((a, b) => sign * (lum[b]! - lum[a]!));
    const top = letters.slice(0, Math.max(1, Math.ceil(letters.length / 3)));
    const rgb = [0, 1, 2].map(c => Math.round(top.reduce((sum, i) => sum + px[((y0 + Math.floor(i / w)) * width + x0 + (i % w)) * 4 + c]!, 0) / top.length));
    // Mask: letters, two pixels around them (anti-aliasing and the dark outline) and one more down-right (the drop shadow).
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (core[y * w + x]) {
      for (let dy = -2; dy <= 3; dy++) for (let dx = -2; dx <= 3; dx++) {
        if ((dy === 3 && dx < 0) || (dx === 3 && dy < 0)) continue;
        const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h) mask[Y * w + X] = 1;
      }
    }
    // Fill each masked pixel from the nearest untouched texture left, right, above and below it (inside the box), weighted by 1 / distance:
    // the brushed faces run horizontally, the title bars fade vertically, and a letter is never more than a few pixels from either.
    const source = Uint8ClampedArray.from(px.subarray((y0 * width + x0) * 4, ((y1 - 1) * width + x1) * 4));
    const at = (x: number, y: number, c: number) => source[(y * width + x) * 4 + c]!; // box-local x, y
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const near: [number, number, number][] = [];
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        for (let d = 1, X = x + dx, Y = y + dy; X >= 0 && Y >= 0 && X < w && Y < h; d++, X += dx, Y += dy) {
          if (!mask[Y * w + X]) { near.push([X, Y, 1 / d]); break; }
        }
      }
      const total = near.reduce((sum, [, , weight]) => sum + weight, 0);
      for (let c = 0; c < 3; c++) {
        px[((y0 + y) * width + x0 + x) * 4 + c] = total
          ? Math.round(near.reduce((sum, [X, Y, weight]) => sum + at(X, Y, c) * weight, 0) / total)
          : median;
      }
    }
    return { text: spec.text, font, x: x0 + bx0, y: y0 + by0, width: bx1 - bx0 + 1, height: by1 - by0 + 1, color: `rgb(${rgb.join(',')})`, pixels: count };
  });
}

