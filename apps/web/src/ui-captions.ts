/*
 * Live captions over the original interface bitmaps. AGPL-3.0-or-later; see NOTICE.
 *
 * The classic forms bake their captions into the BMPs (es_ventanaprincipal "AJUSTES", es_configuracion-vacio "CONFIGURACIÓN", the tab
 * buttons...). Scaled to a large window, those 9-11 px letters are what looks blurry (Ariel, 21 Nov). Here, in the browser and only for the
 * bitmaps listed in CAPTIONS (ui-captions-data.ts), the caption pixels are found inside their box, painted over with the texture around them
 * (caption-erase.ts) and the same words are drawn on top as SVG text: vector, so crisp at any scale. Cinzel for the engraved capitals,
 * Tahoma for the option rows, Georgia for mixed-case serif labels.
 * Position, size and colour come from the original pixels (the box the letters filled and their brightest colour), so each state of a
 * button (default / over / off) keeps its own look. Nothing is written to disk; the original files stay untouched.
 */

import { eraseCaptions } from './caption-erase.js';
import type { CaptionSpec, FoundCaption } from './caption-erase.js';
import { CAPTIONS } from './ui-captions-data.js';
export { CAPTIONS };

/** CAPTIONS entry of an interface file name (`boton-video-off` -> `boton-video`). */
// Keys keep the file's own spelling (VentanaPrincipal-hechizos), requests come in any case: look up by lower case.
const BY_LOWER = new Map(Object.entries(CAPTIONS).map(([key, specs]) => [key.toLowerCase(), specs] as const));
export function captionsFor(name: string): readonly CaptionSpec[] | undefined {
  const base = name.toLowerCase().replace(/^(es|en)_/, '');
  return BY_LOWER.get(base) ?? BY_LOWER.get(base.replace(/-(default|over|off|on|pressed)$/, ''));
}

export const CAPTION_FONTS = { serif: '700 100px Cinzel', sans: '400 100px Tahoma, Verdana, sans-serif', book: '400 100px Georgia, "Times New Roman", serif' } as const;
const FAMILY = { serif: 'Cinzel, serif', sans: 'Tahoma, Verdana, sans-serif', book: 'Georgia, "Times New Roman", serif' } as const;
const WEIGHT = { serif: 700, sans: 400, book: 400 } as const;

/** Geometry of the SVG text that covers exactly the box the original letters filled. */
export interface CaptionText { x: number; y: number; size: number; length: number }
let measurer: CanvasRenderingContext2D | null | undefined;
export function captionGeometry(found: FoundCaption): CaptionText | undefined {
  measurer ??= typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!measurer || !found.pixels) return undefined;
  measurer.font = CAPTION_FONTS[found.font];
  const m = measurer.measureText(found.text);
  const ink = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, tall = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  if (!(ink > 0) || !(tall > 0)) return undefined;
  // Capitals: as tall as the original letters, stretched to their width. Mixed case (option rows, labels): sized to the original's width, so the
  // lines of one window keep one size whatever their accents and descenders, and sat on the same bottom edge (no taller than 1.25x).
  const capitals = found.font === 'serif';
  const byHeight = 100 * found.height / tall, size = capitals ? byHeight : Math.min(100 * found.width / ink, 1.25 * byHeight);
  const stretch = found.width / (ink * size / 100);
  return {
    size,
    // actualBoundingBoxLeft is the ink's distance LEFT of the origin (negative when the first glyph starts right of it): origin = ink left + ABL.
    x: found.x + m.actualBoundingBoxLeft * size / 100 * stretch,
    y: capitals ? found.y + m.actualBoundingBoxAscent * size / 100 : found.y + found.height - m.actualBoundingBoxDescent * size / 100,
    length: m.width * size / 100 * stretch,
  };
}

/** The drop shadow under the live text, in bitmap px: the baked captions carry a soft one (about half black, one pixel down-right). */
export const CAPTION_SHADOW = { offset: 0.75, color: 'rgba(0,0,0,.5)' } as const;

const SVG = 'http://www.w3.org/2000/svg';
interface Captioned { width: number; height: number; captions: FoundCaption[] }
/** Captioned picture URLs (what loadInterface hands out) and what was found in them. */
const registry = new Map<string, Captioned>();

/** Make the captioned copy of a decoded bitmap (`file`: its original file name): returns its URL, or undefined when nothing was found. */
export async function captionedUrl(image: HTMLImageElement, specs: readonly CaptionSpec[], file = ''): Promise<string | undefined> {
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) return undefined;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const captions = eraseCaptions(data.data, canvas.width, canvas.height, specs).filter(found => found.pixels > 0);
  if (!captions.length) return undefined;
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return undefined;
  // The fragment keeps the original file name in the URL (`blob:...#es_ventanaretos.bmp`): what a window shows stays readable in the DOM.
  const url = `${URL.createObjectURL(blob)}${file ? `#${file}` : ''}`;
  registry.set(url, { width: canvas.width, height: canvas.height, captions });
  await document.fonts?.load('700 12px Cinzel').catch(() => undefined);
  return url;
}
/** What was found in a captioned picture (tests, the overlay). */
export const captionsOf = (url: string) => registry.get(url);

function overlay(info: Captioned): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'ui-caption'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', `0 0 ${info.width} ${info.height}`); svg.setAttribute('preserveAspectRatio', 'none');
  for (const found of info.captions) {
    const geometry = captionGeometry(found); if (!geometry) continue;
    for (const [dx, fill, role] of [[CAPTION_SHADOW.offset, CAPTION_SHADOW.color, 'shadow'], [0, found.color, 'text']] as const) {
      const text = document.createElementNS(SVG, 'text');
      text.textContent = found.text; text.setAttribute('data-role', role); text.setAttribute('data-caption', found.text);
      text.setAttribute('x', String(geometry.x + dx)); text.setAttribute('y', String(geometry.y + dx));
      text.setAttribute('font-size', geometry.size.toFixed(3)); text.setAttribute('font-family', FAMILY[found.font]);
      text.setAttribute('font-weight', String(WEIGHT[found.font])); text.setAttribute('fill', fill);
      text.setAttribute('textLength', geometry.length.toFixed(3)); text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      svg.append(text);
    }
  }
  return svg;
}

const cssUrl = (value: string) => /^url\("?(.*?)"?\)$/.exec(value.trim())?.[1] ?? '';
/**
 * The pictures an element shows, by state: an <img> its src, a background its inline background-image, and a VbWindow button (vb-window.ts)
 * its --normal / --over / --off pictures, which style.css swaps on :hover / :active.
 */
const pictures = (element: Element): [state: string, url: string][] => {
  if (element instanceof HTMLImageElement) return [['', element.getAttribute('src') ?? '']];
  const style = (element as HTMLElement).style; if (!style) return [];
  const states = (['normal', 'over', 'off'] as const).map(state => [state, cssUrl(style.getPropertyValue(`--${state}`))] as [string, string]).filter(([, url]) => url);
  return states.length ? states : [['', cssUrl(style.backgroundImage ?? '')]];
};
const OWNER = new WeakMap<Element, { key: string; svgs: SVGSVGElement[] }>();

/** Put (or move, or remove) the live captions of one element's pictures: inside it for a background, next to it for an <img>. */
function sync(element: Element) {
  const shown = pictures(element).filter(([, url]) => registry.has(url)), key = shown.map(([state, url]) => `${state}=${url}`).join(' ');
  const current = OWNER.get(element);
  if (current && current.key !== key) { current.svgs.forEach(svg => svg.remove()); OWNER.delete(element); }
  if (!shown.length) return;
  let entry = OWNER.get(element);
  if (!entry) {
    entry = { key, svgs: shown.map(([state, url]) => { const svg = overlay(registry.get(url)!); if (state) svg.dataset.state = state; return svg; }) };
    OWNER.set(element, entry);
  }
  const info = registry.get(shown[0]![1])!;
  for (const svg of entry.svgs) {
    if (element instanceof HTMLImageElement) {
      if (svg.previousElementSibling !== element) element.after(svg);
      Object.assign(svg.style, { position: 'absolute', pointerEvents: 'none', left: `${element.offsetLeft}px`, top: `${element.offsetTop}px`, width: `${element.offsetWidth || info.width}px`, height: `${element.offsetHeight || info.height}px` });
      svg.style.display = element.hidden || getComputedStyle(element).display === 'none' ? 'none' : '';
    } else {
      // Under the element's own controls, as the baked text was: a window's caption must not draw over the buttons placed on it (the
      // ventanacrearcuenta CANCELAR / CREAR CUENTA under their boton-* pictures read double-struck, #113).
      if (svg.parentElement !== element) element.prepend(svg);
      const stretched = svg.dataset.state !== undefined || getComputedStyle(element).backgroundSize.startsWith('100%');
      Object.assign(svg.style, { position: 'absolute', pointerEvents: 'none', left: '0', top: '0', width: stretched ? '100%' : `${info.width}px`, height: stretched ? '100%' : `${info.height}px` });
    }
  }
}

/** The element shows a captioned picture right now (tests: computed style, so CSS states count) and the caption drawn on it. */
export function captionState(element: Element): { captioned: boolean; drawn: string[] } {
  const url = element instanceof HTMLImageElement ? element.getAttribute('src') ?? '' : cssUrl(getComputedStyle(element).backgroundImage);
  if (!registry.has(url)) return { captioned: false, drawn: [] };
  const layers = element instanceof HTMLImageElement ? [element.nextElementSibling] : [...element.children];
  const drawn = layers.filter((svg): svg is SVGSVGElement => svg instanceof SVGSVGElement && svg.classList.contains('ui-caption') && getComputedStyle(svg).display !== 'none' && svg.getBoundingClientRect().width > 0)
    .flatMap(svg => [...svg.querySelectorAll('text[data-role="text"]')].map(text => text.textContent ?? ''));
  return { captioned: true, drawn };
}

/** Watch `root` for captioned pictures (any window, any state change) and keep their live captions in place. */
export function installCaptions(root: HTMLElement) {
  const scan = (node: Node) => {
    if (!(node instanceof Element)) return;
    if (registry.size) { sync(node); node.querySelectorAll('img, [style*="background-image"]').forEach(sync); }
  };
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') sync(record.target as Element);
      else record.addedNodes.forEach(scan);
    }
  }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'style', 'hidden'] });
  scan(root);
  return { rescan: () => scan(root) };
}

/** How well the live text covers the original letters of one caption (tests): the share of each that lies within 1 px of the other (the smaller). */
export interface CaptionMatch { text: string; found: boolean; overlap: number }
/**
 * Draw each caption's live text where the overlay puts it and compare it with the letters it replaces: a check of place and size (the words
 * themselves are checked by text recognition in e2e/ui-captions.spec.ts).
 */
export function verifyCaptions(image: HTMLImageElement, specs: readonly CaptionSpec[]): CaptionMatch[] {
  const width = image.naturalWidth, height = image.naturalHeight;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const original = ctx.getImageData(0, 0, width, height).data, erased = Uint8ClampedArray.from(original);
  const found = eraseCaptions(erased, width, height, specs);
  return found.map((caption, n) => {
    const text = caption.text, spec = specs[n]!;
    if (!caption.pixels) return { text, found: false, overlap: 0 };
    const geometry = captionGeometry(caption); if (!geometry) return { text, found: true, overlap: 0 };
    const x0 = Math.max(0, caption.x - 3), y0 = Math.max(0, caption.y - 3), w = Math.min(width, caption.x + caption.width + 3) - x0, h = Math.min(height, caption.y + caption.height + 3) - y0;
    // The original letters: what the paint-out changed most (the letter pixels against the texture now under them).
    const sign = spec.dark ? -1 : 1, letters = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * width + x0 + x) * 4;
      const before = 0.299 * original[i]! + 0.587 * original[i + 1]! + 0.114 * original[i + 2]!, after = 0.299 * erased[i]! + 0.587 * erased[i + 1]! + 0.114 * erased[i + 2]!;
      if (sign * (before - after) > 22) letters[y * w + x] = 1;
    }
    // The live text, drawn as the SVG draws it (same font, size, baseline and horizontal stretch).
    const pen = document.createElement('canvas'); pen.width = w; pen.height = h;
    const g = pen.getContext('2d', { willReadFrequently: true })!;
    g.font = CAPTION_FONTS[caption.font].replace('100px', `${geometry.size}px`);
    const advance = g.measureText(text).width, stretch = advance > 0 ? geometry.length / advance : 1;
    g.translate(geometry.x - x0, geometry.y - y0); g.scale(stretch, 1); g.fillStyle = '#fff'; g.fillText(text, 0, 0);
    const ink = g.getImageData(0, 0, w, h).data, drawn = new Uint8Array(w * h);
    for (let i = 0; i < drawn.length; i++) if (ink[i * 4 + 3]! > 96) drawn[i] = 1;
    const near = (a: Uint8Array, x: number, y: number) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && a[Y * w + X]) return true; }
      return false;
    };
    let a = 0, aHit = 0, b = 0, bHit = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (letters[y * w + x]) { a++; if (near(drawn, x, y)) aHit++; }
      if (drawn[y * w + x]) { b++; if (near(letters, x, y)) bHit++; }
    }
    return { text, found: true, overlap: a && b ? Math.min(aHit / a, bHit / b) : 0 };
  });
}

/** Each caption of a bitmap: the box its letters fill and the live text's geometry (tests and alignment checks). */
export function captionLayout(image: HTMLImageElement, specs: readonly CaptionSpec[]) {
  const width = image.naturalWidth, height = image.naturalHeight;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(image, 0, 0);
  const found = eraseCaptions(ctx.getImageData(0, 0, width, height).data, width, height, specs);
  return found.map(caption => ({ text: caption.text, font: caption.font, found: { x: caption.x, y: caption.y, width: caption.width, height: caption.height }, geometry: captionGeometry(caption) }));
}

/** The bitmap with its captions painted out and redrawn, `scale` times larger (nearest-neighbour art, vector text): the caption review sheet. */
export function renderCaptioned(image: HTMLImageElement, specs: readonly CaptionSpec[], scale = 3): HTMLCanvasElement {
  const width = image.naturalWidth, height = image.naturalHeight;
  const base = document.createElement('canvas'); base.width = width; base.height = height;
  const b = base.getContext('2d', { willReadFrequently: true })!; b.drawImage(image, 0, 0);
  const data = b.getImageData(0, 0, width, height), found = eraseCaptions(data.data, width, height, specs); b.putImageData(data, 0, 0);
  const out = document.createElement('canvas'); out.width = width * scale; out.height = height * scale;
  const g = out.getContext('2d')!; g.imageSmoothingEnabled = false; g.drawImage(base, 0, 0, out.width, out.height);
  for (const caption of found) {
    const geometry = captionGeometry(caption); if (!geometry) continue;
    for (const [dx, fill] of [[CAPTION_SHADOW.offset, CAPTION_SHADOW.color], [0, caption.color]] as const) {
      g.save(); g.scale(scale, scale); g.font = CAPTION_FONTS[caption.font].replace('100px', `${geometry.size}px`);
      const advance = g.measureText(caption.text).width;
      g.translate(geometry.x + dx, geometry.y + dx); g.scale(advance > 0 ? geometry.length / advance : 1, 1); g.fillStyle = fill; g.fillText(caption.text, 0, 0); g.restore();
    }
  }
  return out;
}
