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

export const interfaceUrl = (name: string, localized = true) => `/ao-assets/interface/${localized ? 'es_' : ''}${name}.bmp`;
const pending = new Map<string, Promise<string>>();
const urls = new Map<string, string>();
export const loadedInterfaceUrl = (name: string) => urls.get(interfaceUrl(name)) ?? interfaceUrl(name);

export function loadInterface(name: string, localized = true): Promise<string> {
  const original = interfaceUrl(name, localized);
  let promise = pending.get(original);
  if (!promise) {
    promise = (async () => {
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
    })();
    pending.set(original, promise);
  }
  return promise;
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', () => {
  for (const url of urls.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
});
