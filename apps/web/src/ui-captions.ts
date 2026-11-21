/*
 * Live captions over the original interface bitmaps. AGPL-3.0-or-later; see NOTICE.
 *
 * The classic forms bake their captions into the BMPs (es_ventanaprincipal "AJUSTES", es_configuracion-vacio "CONFIGURACIÓN", the tab
 * buttons...). Scaled to a large window, those 9-11 px letters are what looks blurry (Ariel, 21 Nov). Here, in the browser and only for the
 * bitmaps listed in CAPTIONS, the caption pixels are found inside their box, painted over with the texture around them (each row is filled
 * between the nearest untouched pixels on either side) and the same words are drawn on top as SVG text: vector, so crisp at any scale.
 * Position, size and colour come from the original pixels (the box the letters filled and their brightest colour), so each state of a
 * button (default / over / off) keeps its own look. Nothing is written to disk; the original files stay untouched.
 */

/** A caption baked into an interface bitmap: its words and the box (bitmap px) the search for its letters is limited to. */
export interface CaptionSpec {
  text: string;
  box: readonly [x: number, y: number, width: number, height: number];
  /** `serif`: the engraved capitals of buttons and titles (Cinzel); `sans`: the option rows (Tahoma). */
  font?: 'serif' | 'sans';
}

/** A caption as found in one bitmap: the box its letters fill and their colour. */
export interface FoundCaption {
  text: string;
  font: 'serif' | 'sans';
  x: number; y: number; width: number; height: number;
  color: string;
  /** Letter pixels found (a box with none keeps the bitmap as it was). */
  pixels: number;
}

const FRMMAIN_BUTTON_ROW = 10;
/**
 * Interface bitmaps (name without the `es_` prefix and the state suffix) and their captions, in bitmap pixels. Boxes hold the letters
 * and their 1 px shadow but no icon or frame.
 */
export const CAPTIONS: Record<string, readonly CaptionSpec[]> = {
  ventanaprincipal: [
    { text: 'AJUSTES', box: [777, FRMMAIN_BUTTON_ROW - 3, 47, 17] },
    { text: 'MANUAL', box: [846, FRMMAIN_BUTTON_ROW - 3, 49, 17] },
    { text: 'MAO', box: [920, FRMMAIN_BUTTON_ROW - 3, 40, 17] },
    { text: 'INVENTARIO', box: [784, 166, 84, 16] },
    { text: 'HECHIZOS', box: [912, 166, 76, 16] },
    { text: 'STATS', box: [796, 528, 52, 16] },
    { text: 'MENU', box: [924, 528, 50, 16] },
  ],
  ventanaprincipal_stats: [{ text: 'STATS', box: [40, 4, 60, 20] }, { text: 'MENU', box: [172, 4, 60, 20] }],
  ventanaprincipal_info: [{ text: 'STATS', box: [40, 4, 60, 20] }, { text: 'MENU', box: [172, 4, 60, 20] }],
  centroinventario: [{ text: 'INVENTARIO', box: [18, 6, 88, 18] }, { text: 'HECHIZOS', box: [146, 6, 90, 18] }],
  centrohechizo: [{ text: 'INVENTARIO', box: [18, 6, 88, 18] }, { text: 'HECHIZOS', box: [146, 6, 90, 18] }],
  'configuracion-vacio': [{ text: 'CONFIGURACIÓN', box: [168, 24, 200, 30] }, { text: 'CONFIGURAR TECLAS', box: [42, 456, 132, 18] }],
  'boton-config-teclas': [{ text: 'CONFIGURAR TECLAS', box: [10, 6, 131, 17] }],
  'boton-jugabilidad': [{ text: 'JUGABILIDAD', box: [36, 6, 92, 17] }],
  'boton-video': [{ text: 'VIDEO', box: [56, 6, 52, 17] }],
  'boton-audio': [{ text: 'AUDIO', box: [56, 6, 52, 17] }],
  'configuracion-video': [
    { text: 'VISUALIZACIÓN', box: [72, 12, 110, 14] },
    ...[
      [46, 'Mostrar FPS en pantalla'], [73, 'Mover ventana de juego'], [100, 'Sincronización vertical (vSync)'], [127, 'Respiración de personajes'],
      [154, 'Pantalla completa'], [181, 'Información de ítems en el suelo'], [206, 'Números completos en el inventario'],
      [231, 'Botones en la barra de experiencia'], [256, 'Nombre del mapa al cambiar de zona'], [281, 'Confirmación para liberar mascotas'],
    ].map(([y, text]) => ({ text: text as string, box: [38, (y as number) - 2, 204, 19] as const, font: 'sans' as const })),
    { text: 'Utilizar minimapa en modo continuo', box: [276, 44, 206, 19], font: 'sans' },
  ],
};

/** CAPTIONS entry of an interface file name (`boton-video-off` -> `boton-video`). */
export function captionsFor(name: string): readonly CaptionSpec[] | undefined {
  const base = name.toLowerCase().replace(/^(es|en)_/, '');
  return CAPTIONS[base] ?? CAPTIONS[base.replace(/-(default|over|off|on|pressed)$/, '')];
}

const luminance = (px: Uint8ClampedArray | Uint8Array, i: number) => 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;

/**
 * Find each caption's letters in an RGBA bitmap and paint them over with the surrounding texture, in place. A letter pixel is clearly
 * brighter than the box's median; the mask grows by one pixel (anti-aliasing) and once more down-right (the 1 px drop shadow).
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
    const threshold = median + Math.max(22, 4 * mad);
    const core = new Uint8Array(w * h);
    let bx0 = w, by0 = h, bx1 = -1, by1 = -1, count = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (lum[y * w + x]! > threshold) {
      core[y * w + x] = 1; count++;
      bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
    }
    if (count < 6) return none;
    // Colour: the mean of the brightest third of the letter pixels.
    const letters: number[] = [];
    for (let i = 0; i < core.length; i++) if (core[i]) letters.push(i);
    letters.sort((a, b) => lum[b]! - lum[a]!);
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

export const CAPTION_FONTS = { serif: '700 100px Cinzel', sans: '400 100px Tahoma, Verdana, sans-serif' } as const;
const FAMILY = { serif: 'Cinzel, serif', sans: 'Tahoma, Verdana, sans-serif' } as const;
const WEIGHT = { serif: 700, sans: 400 } as const;

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
  const size = 100 * found.height / tall, stretch = found.width / (ink * size / 100);
  return {
    size,
    x: found.x - m.actualBoundingBoxLeft * size / 100 * stretch,
    y: found.y + m.actualBoundingBoxAscent * size / 100,
    length: m.width * size / 100 * stretch,
  };
}

const SVG = 'http://www.w3.org/2000/svg';
interface Captioned { width: number; height: number; captions: FoundCaption[] }
/** Captioned picture URLs (what loadInterface hands out) and what was found in them. */
const registry = new Map<string, Captioned>();

/** Make the captioned copy of a decoded bitmap: returns its URL, or undefined when nothing was found (keep the original). */
export async function captionedUrl(image: HTMLImageElement, specs: readonly CaptionSpec[]): Promise<string | undefined> {
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) return undefined;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const captions = eraseCaptions(data.data, canvas.width, canvas.height, specs).filter(found => found.pixels > 0);
  if (!captions.length) return undefined;
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
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
    for (const [dx, fill, role] of [[1, 'rgba(0,0,0,.85)', 'shadow'], [0, found.color, 'text']] as const) {
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

const pictureUrl = (element: Element) => {
  if (element instanceof HTMLImageElement) return element.getAttribute('src') ?? '';
  const background = (element as HTMLElement).style?.backgroundImage ?? '';
  return /^url\("?(.*?)"?\)$/.exec(background)?.[1] ?? '';
};
const OWNER = new WeakMap<Element, { url: string; svg: SVGSVGElement }>();

/** Put (or move, or remove) the live captions of one element's picture: inside it for a background, next to it for an <img>. */
function sync(element: Element) {
  const url = pictureUrl(element), info = registry.get(url), current = OWNER.get(element);
  if (current && (current.url !== url || !info)) { current.svg.remove(); OWNER.delete(element); }
  if (!info) return;
  let entry = OWNER.get(element);
  if (!entry) { entry = { url, svg: overlay(info) }; OWNER.set(element, entry); }
  const svg = entry.svg;
  if (element instanceof HTMLImageElement) {
    if (svg.previousElementSibling !== element) element.after(svg);
    Object.assign(svg.style, { position: 'absolute', pointerEvents: 'none', left: `${element.offsetLeft}px`, top: `${element.offsetTop}px`, width: `${element.offsetWidth || info.width}px`, height: `${element.offsetHeight || info.height}px` });
    svg.style.display = element.hidden || getComputedStyle(element).display === 'none' ? 'none' : '';
  } else {
    if (svg.parentElement !== element) element.append(svg);
    const stretched = getComputedStyle(element).backgroundSize.startsWith('100%');
    Object.assign(svg.style, { position: 'absolute', pointerEvents: 'none', left: '0', top: '0', width: stretched ? '100%' : `${info.width}px`, height: stretched ? '100%' : `${info.height}px` });
  }
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
