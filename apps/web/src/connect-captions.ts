/*
 * Crisp buttons on the account and character-creation screens. AGPL-3.0-or-later; see NOTICE.
 *
 * The login screen's buttons are interface BMPs, so ui-captions.ts already redraws their baked captions as live text. The account and
 * creation screens are different: their buttons (CREAR | CREATE, JUGAR | PLAY, VOLVER, CREAR PERSONAJE) and the back / close icons live
 * INSIDE the big Grh sprites of graficos.ind (3839, 727), which connect-ui.ts draws as plain CSS backgrounds, so ui-captions never saw them
 * and their 9-11 px letters and 1 px glyphs were upscaled with the window (Ariel, 22 Nov: "Ingresar, Crear, Jugar, Back button... look old/blurry").
 * Same treatment as ui-captions.ts, applied to a Grh frame: the letters (and the two icon glyphs) are found by pixel inside the boxes below,
 * painted over with the texture around them, and redrawn as SVG: vector, crisp at any scale. Nothing is written to disk.
 */
import { eraseCaptions } from './caption-erase.js';
import type { CaptionSpec } from './caption-erase.js';
import { captionGeometry, CAPTION_SHADOW } from './ui-captions.js';

/** A small icon-button glyph drawn as vector over the erased bitmap one. */
export interface GlyphSpec { kind: 'back' | 'close' | 'trash' | 'transfer'; box: readonly [x: number, y: number, width: number, height: number] }
export interface CrispArt { captions: readonly CaptionSpec[]; glyphs?: readonly GlyphSpec[] }

/** Boxes are in Grh-frame pixels. Keyed by Grh id. */
export const CONNECT_ART: Readonly<Record<number, CrispArt>> = {
  // RenderAccountCharacters: the frame strip. The thin "|" between the two languages is kept (it is part of the frame art).
  3839: {
    captions: [
      { text: 'CREAR', box: [272, 718, 58, 22] }, { text: 'CREATE', box: [338, 718, 66, 22] },
      { text: 'JUGAR', box: [630, 718, 58, 22] }, { text: 'PLAY', box: [694, 718, 46, 22] },
    ],
    glyphs: [{ kind: 'back', box: [24, 22, 24, 24] }, { kind: 'close', box: [977, 22, 24, 24] }, { kind: 'trash', box: [15, 682, 24, 28] }, { kind: 'transfer', box: [976, 680, 30, 30] }],
  },
  // RenderUICrearPJ: the creation frame (512 x 401).
  727: { captions: [{ text: 'VOLVER', box: [96, 352, 80, 28] }, { text: 'CREAR PERSONAJE', box: [298, 352, 154, 28] }] },
};

const SVG = 'http://www.w3.org/2000/svg';
/** A filled vector shape of an icon glyph: [tag, attributes]. The delete (bin) and transfer (arrow + character) icons of the account screen. */
export type GlyphShape = readonly [tag: 'rect' | 'path', attrs: Record<string, string>];
export const TRASH_COLOR = '#c8141f', ARROW_COLOR = '#f5b82b', FIGURE_COLOR = '#74685a';
export function glyphShapes(kind: 'trash' | 'transfer', x: number, y: number, w: number, h: number): GlyphShape[] {
  const f = (v: number) => v.toFixed(2);
  if (kind === 'trash') {
    const u = w / 24, v = h / 28, X = (n: number) => f(x + n * u), Y = (n: number) => f(y + n * v);
    return [
      ['rect', { x: X(8), y: Y(1), width: f(8 * u), height: f(3 * v), fill: 'none', stroke: TRASH_COLOR, 'stroke-width': f(1.6 * u) }], // handle
      ['rect', { x: X(1), y: Y(4.5), width: f(22 * u), height: f(3 * v), fill: TRASH_COLOR }], // lid
      ['path', { d: `M${X(3)} ${Y(9)} H${X(21)} L${X(19.6)} ${Y(27)} H${X(4.4)} Z`, fill: 'none', stroke: TRASH_COLOR, 'stroke-width': f(1.8 * u), 'stroke-linejoin': 'miter' }], // body
      ['path', { d: [8.8, 12, 15.2].map(n => `M${X(n)} ${Y(11.5)} V${Y(24.5)}`).join(' '), fill: 'none', stroke: TRASH_COLOR, 'stroke-width': f(1.6 * u) }], // slots
    ];
  }
  const u = w / 30, v = h / 30, X = (n: number) => f(x + n * u), Y = (n: number) => f(y + n * v);
  return [
    ['path', { d: `M${X(18)} ${Y(9)} L${X(10)} ${Y(5)} L${X(10.6)} ${Y(9.6)} C${X(4)} ${Y(11)} ${X(1.5)} ${Y(17)} ${X(2)} ${Y(24)} C${X(4)} ${Y(17.5)} ${X(7)} ${Y(15.5)} ${X(11.4)} ${Y(15.2)} L${X(12)} ${Y(19.8)} Z`, fill: ARROW_COLOR }], // arrow
    ['path', { d: `M${X(22.6)} ${Y(6)} a${f(3.6 * u)} ${f(3.8 * v)} 0 1 1 0.01 0 Z M${X(16.4)} ${Y(28)} V${Y(18)} C${X(16.4)} ${Y(14)} ${X(19)} ${Y(12.6)} ${X(22.6)} ${Y(12.6)} C${X(26.2)} ${Y(12.6)} ${X(28.8)} ${Y(14)} ${X(28.8)} ${Y(18)} V${Y(28)} Z`, fill: FIGURE_COLOR }], // character
  ];
}
export interface CrispResult { url: string; svg: SVGSVGElement; found: { text: string; pixels: number }[] }

/** SVG strokes of a glyph inside its found box (bitmap px). */
export function glyphPath(kind: GlyphSpec['kind'], x: number, y: number, w: number, h: number): string {
  if (kind === 'trash' || kind === 'transfer') return '';
  if (kind === 'back') return `M${x + w * 0.72} ${y + h * 0.08} L${x + w * 0.2} ${y + h / 2} L${x + w * 0.72} ${y + h * 0.92}`;
  return `M${x + w * 0.08} ${y + h * 0.08} L${x + w * 0.92} ${y + h * 0.92} M${x + w * 0.92} ${y + h * 0.08} L${x + w * 0.08} ${y + h * 0.92}`;
}

/**
 * The frame region of a sheet with its captions painted out, and the SVG overlay that redraws them. `draw` paints the frame onto a canvas
 * (connect-ui owns the sheet); returns undefined when there is nothing to redraw (the caller keeps the plain picture).
 */
export async function crispFrame(draw: (ctx: CanvasRenderingContext2D) => void, width: number, height: number, art: CrispArt): Promise<CrispResult | undefined> {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) return undefined;
  draw(ctx);
  const data = ctx.getImageData(0, 0, width, height);
  const glyphSpecs: CaptionSpec[] = (art.glyphs ?? []).map(g => ({ text: g.kind, box: g.box, font: 'sans' }));
  const found = eraseCaptions(data.data, width, height, [...art.captions, ...glyphSpecs]);
  if (!found.some(f => f.pixels > 0)) return undefined;
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return undefined;
  await document.fonts?.load('700 12px Cinzel').catch(() => undefined);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'ui-caption cs-crisp'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('preserveAspectRatio', 'none');
  found.forEach((f, n) => {
    if (!f.pixels) return;
    if (n >= art.captions.length) {
      const glyph = art.glyphs![n - art.captions.length]!;
      if (glyph.kind === 'trash' || glyph.kind === 'transfer') {
        for (const [tag, attrs] of glyphShapes(glyph.kind, f.x, f.y, f.width, f.height)) {
          const shape = document.createElementNS(SVG, tag);
          for (const [name, value] of Object.entries(attrs)) shape.setAttribute(name, value);
          shape.setAttribute('data-role', 'glyph'); shape.setAttribute('data-glyph', glyph.kind); svg.append(shape);
        }
        return;
      }
      for (const [dx, stroke, role] of [[CAPTION_SHADOW.offset, CAPTION_SHADOW.color, 'shadow'], [0, f.color, 'glyph']] as const) {
        const path = document.createElementNS(SVG, 'path');
        path.setAttribute('d', glyphPath(glyph.kind, f.x + dx, f.y + dx, f.width, f.height)); path.setAttribute('data-role', role); path.setAttribute('data-glyph', glyph.kind);
        path.setAttribute('fill', 'none'); path.setAttribute('stroke', stroke); path.setAttribute('stroke-width', '2.4'); path.setAttribute('stroke-linecap', 'square'); path.setAttribute('stroke-linejoin', 'miter');
        svg.append(path);
      }
      return;
    }
    const geometry = captionGeometry(f); if (!geometry) return;
    for (const [dx, fill, role] of [[CAPTION_SHADOW.offset, CAPTION_SHADOW.color, 'shadow'], [0, f.color, 'text']] as const) {
      const text = document.createElementNS(SVG, 'text');
      text.textContent = f.text; text.setAttribute('data-role', role); text.setAttribute('data-caption', f.text);
      text.setAttribute('x', String(geometry.x + dx)); text.setAttribute('y', String(geometry.y + dx));
      text.setAttribute('font-size', geometry.size.toFixed(3)); text.setAttribute('font-family', 'Cinzel, serif'); text.setAttribute('font-weight', '700');
      text.setAttribute('fill', fill); text.setAttribute('textLength', geometry.length.toFixed(3)); text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      svg.append(text);
    }
  });
  return { url: URL.createObjectURL(blob), svg, found: found.map(f => ({ text: f.text, pixels: f.pixels })) };
}
