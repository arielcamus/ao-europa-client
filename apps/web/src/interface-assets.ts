import { assetUrl } from './assets.js';
import { CAPTIONS, captionedUrl, captionsFor, renderCaptioned, verifyCaptions } from './ui-captions.js';
// Original BMP files remain untouched. Some true-color BI_RGB headers declare
// important palette colors; WebKit rejects these, although there is no palette.
// Normalize only unused palette metadata in a browser-local copy. Pixel bytes,
// dimensions, row order and RGB values are preserved exactly.
export function normalizeTrueColorBmp(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 54) throw new Error('Truncated interface bitmap');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getInt32(18, true), height = Math.abs(view.getInt32(22, true));
  const bits = view.getUint16(28, true);
  const offset = view.getUint32(10, true), stride = Math.ceil(width * (bits / 8) / 4) * 4;
  if (view.getUint16(0, true) !== 0x4d42 || view.getUint32(14, true) < 40 ||
      view.getUint16(26, true) !== 1 || ![24, 32].includes(bits) || view.getUint32(30, true) !== 0 ||
      width < 1 || height < 1 || offset < 54 || stride * height > 64 * 1024 * 1024 || offset + stride * height > bytes.length) {
    throw new Error('Unsupported interface bitmap');
  }
  const normalized = bytes.slice();
  const header = new DataView(normalized.buffer);
  header.setUint32(46, 0, true); header.setUint32(50, 0, true);
  return normalized;
}

export const interfaceUrl = (name: string, localized = true) => assetUrl(`interface/${localized ? 'es_' : ''}${name}.bmp`);
const pending = new Map<string, Promise<string>>();
const urls = new Map<string, string>();
export const loadedInterfaceUrl = (name: string) => urls.get(interfaceUrl(name)) ?? interfaceUrl(name);

/*
 * Frmcarga loads every form picture before the login; over a 1.6 Mbit/s link that is ~17 MB of BMP and two minutes (#79). Here the
 * pictures that windows ask for while the client boots wait in a queue, except the ones the splash and the login screen show. The
 * queue downloads a few at a time while `setInterfaceDrain(true)` (idle on the connect screens, or the world already drawn, or a
 * window open), so it never competes with the login art or the first world frame. A picture asked for after the boot loads at once.
 */
const CONNECT_ART = new Set(['es_ventanacargando', 'es_boton-ingresar-over', 'es_boton-ingresar-off', 'es_check-amarillo']);
let booting = true, draining = false, running = 0;
const LANE = 2;
const waiting: { original: string; start: () => void }[] = [];
const pump = () => { while (draining && running < LANE && waiting.length) { running++; waiting.shift()!.start(); } };
/** The connect screen is up: pictures asked for from now on are wanted now. */
export function interfaceBootDone() { booting = false; }
/** Let the queued window pictures download (true) or hold them (false: the world is loading). */
export function setInterfaceDrain(on: boolean) { draining = on; pump(); }
/** Window pictures still queued (tests). */
export const queuedInterfaceCount = () => waiting.length;

export function loadInterface(name: string, localized = true): Promise<string> {
  const original = interfaceUrl(name, localized);
  let promise = pending.get(original);
  if (!promise && booting && !CONNECT_ART.has(`${localized ? 'es_' : ''}${name}`.toLowerCase())) {
    promise = new Promise<void>(start => { waiting.push({ original, start }); pump(); })
      .then(() => fetchInterface(original)).then(url => withCaptions(name, original, url)).finally(() => { running--; pump(); });
    pending.set(original, promise);
  } else if (promise && !booting) {
    // Asked for again after the boot (a window opening): a queued picture jumps the queue.
    const at = waiting.findIndex(item => item.original === original);
    if (at >= 0) { running++; waiting.splice(at, 1)[0]!.start(); }
  }
  if (!promise) { promise = fetchInterface(original).then(url => withCaptions(name, original, url)); pending.set(original, promise); }
  return promise;
}

async function fetchInterface(original: string): Promise<string> {
  const image = new Image(); image.src = original;
  try { await image.decode(); urls.set(original, original); return original; }
  catch {
    const response = await fetch(original);
    if (!response.ok) throw new Error(`Interfaz original no disponible: ${original} (${response.status})`);
    let bytes: Uint8Array;
    try { bytes = normalizeTrueColorBmp(new Uint8Array(await response.arrayBuffer())); }
    catch (error) { throw new Error(`${original}: ${String(error)}`); }
    const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'image/bmp' }));
    image.src = url;
    try { await image.decode(); }
    catch { URL.revokeObjectURL(url); throw new Error(`No se pudo decodificar la interfaz original: ${original}`); }
    urls.set(original, url); return url;
  }
}

/** A bitmap with captions baked in (ui-captions.ts): hand out the copy with the letters painted over; the overlay draws them as text. */
async function withCaptions(name: string, original: string, url: string): Promise<string> {
  const specs = captionsFor(name);
  // `?captions=off` shows the bitmaps exactly as shipped (comparisons, a caption that looks wrong).
  if (!specs || typeof document === 'undefined' || new URLSearchParams(location.search).get('captions') === 'off') return url;
  try {
    const image = new Image(); image.src = url; await image.decode();
    const captioned = await captionedUrl(image, specs, original.split('?')[0]!.split('/').pop());
    if (!captioned) return url;
    urls.set(original, captioned); return captioned;
  } catch { return url; } // the original picture, letters and all
}

// `?captiondebug`: the caption table and its check against the original bitmaps (e2e/ui-captions.spec.ts).
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('captiondebug')) {
  (globalThis as { __aoCaptions?: unknown }).__aoCaptions = {
    names: Object.keys(CAPTIONS),
    texts: (name: string) => (CAPTIONS[name] ?? []).map(spec => spec.text),
    async check(file: string) {
      const url = await fetchInterface(interfaceUrl(file)).catch(() => fetchInterface(interfaceUrl(file, false))).catch(() => undefined); if (!url) return undefined;
      const image = new Image(); image.src = url; await image.decode();
      await document.fonts.load('700 12px Cinzel');
      return verifyCaptions(image, captionsFor(file)!);
    },
    /** Original and captioned copy, `scale` times larger, as data URLs (the review sheet). */
    async preview(file: string, scale = 3) {
      const url = await fetchInterface(interfaceUrl(file)).catch(() => fetchInterface(interfaceUrl(file, false))).catch(() => undefined); if (!url) return undefined;
      const image = new Image(); image.src = url; await image.decode();
      await document.fonts.load('700 12px Cinzel');
      const before = document.createElement('canvas'); before.width = image.naturalWidth * scale; before.height = image.naturalHeight * scale;
      const g = before.getContext('2d')!; g.imageSmoothingEnabled = false; g.drawImage(image, 0, 0, before.width, before.height);
      return { before: before.toDataURL(), after: renderCaptioned(image, captionsFor(file)!, scale).toDataURL() };
    },
  };
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', () => {
  for (const url of urls.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
});
