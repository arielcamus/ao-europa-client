// AGPL-3.0-or-later. Only these local resources are exposed; no copying into dist.
import { createReadStream } from 'node:fs';
import { mkdir, readFile, realpath, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlib, gzip } from 'node:zlib';

export const ALLOWED_ASSETS = /^(Mapas\/mapa\d+\.csm|Graficos\/\d+\.png|init\/(graficos\.ini|cuerpos\.dat|moldes\.ini|cabezas\.ind|armas\.dat|escudos\.dat|cascos\.ind|colores\.dat|FXs\.ini|particles\.ind|ProjectileDef\.dat|sp_localindex\.dat|sp_localmsg\.dat|mapsworlddata\.dat|namemapa\.dat|crafteo\.ini)|interface\/[a-z0-9_-]+\.bmp|Minimapas\/mapa\d+\.bmp|OUTPUT\/QuestNPCsMapData\.bin|Dat\/(Obj|Hechizos|zonas|npcs)\.dat|OGG\/[\w -]+\.ogg|wav\/[\w -]+\.wav|Mp3\/\d+\.mp3)$/i;

/*
 * Delivery on slow links (issue #79). The files themselves are never changed; only how they travel:
 * - Uncompressed formats (BMP, the text/binary init and Dat files, maps, wav) go brotli or gzip when the browser accepts it: the
 *   interface BMPs shrink ~5x, graficos.ini ~10x. A fast level answers the first request; a background pass recompresses at the
 *   maximum level and keeps the result on disk, so later visits (and server restarts) get the smallest copy. PNG/OGG/MP3 are sent as is.
 *   (Lossless WebP for the PNG sheets was measured and rejected: Chrome colour-manages the PNGs (gAMA chunk), so the WebP twin
 *   decodes to different pixels in 30 of 36 sampled sheets.)
 * - URLs carrying ?v=<asset version> (the client adds it; the version hashes every file's name, size and date) are cached for a
 *   year as immutable, so a second visit downloads nothing. Without it a file revalidates with its ETag.
 */
const COMPRESSIBLE = /\.(bmp|ini|dat|ind|csm|bin|wav)$/i;
const IMMUTABLE = 'private, max-age=31536000, immutable';
const REVALIDATE = 'private, no-cache';
const FAST = { params: { [zlib.BROTLI_PARAM_QUALITY]: 5 } };
const brotli = promisify(brotliCompress), gz = promisify(gzip);

export async function localAssets(directory, { cacheDir = process.env.AO_ASSET_CACHE ?? join(tmpdir(), 'ao-asset-cache') } = {}) {
  if (!directory) throw new Error('Set AO_ASSETS to your local ao-reference/Recursos directory. Assets are never bundled.');
  const root = await realpath(directory);
  const files = new Map();
  const folders = await readdir(root);
  // Minimapas and the sound folders are optional: without them there is no minimap picture / the client is silent.
  for (const folder of ['Mapas', 'Graficos', 'init', 'interface', 'Dat', 'Minimapas', 'OUTPUT', 'OGG', 'wav', 'Mp3']) {
    const actual = folders.find(name => name.toLowerCase() === folder.toLowerCase());
    if (!actual) { if (['Minimapas', 'OUTPUT', 'OGG', 'wav', 'Mp3'].includes(folder)) continue; throw new Error(`Missing local asset directory: ${folder}`); }
    for (const name of await readdir(join(root, actual))) {
      const path = `${actual}/${name}`;
      if (ALLOWED_ASSETS.test(path)) files.set(path.toLowerCase(), join(root, path));
    }
  }
  // One version for the whole set: any file added, removed, resized or touched gives every URL a new ?v.
  const stamp = createHash('sha256');
  for (const key of [...files.keys()].sort()) { const info = await stat(files.get(key)); stamp.update(`${key}:${info.size}:${Math.floor(info.mtimeMs)}\n`); }
  const version = stamp.digest('hex').slice(0, 12);
  const cacheRoot = join(cacheDir, createHash('sha256').update(root).digest('hex').slice(0, 12));

  // Encoded copies: memory first (bounded), then disk; `background` recompresses at the top level one file at a time in the background.
  const memory = new Map(); let memoryBytes = 0; const MEMORY_LIMIT = 192 * 1024 * 1024;
  const remember = (id, buffer) => {
    if (memory.has(id)) memoryBytes -= memory.get(id).length;
    memory.delete(id); memory.set(id, buffer); memoryBytes += buffer.length;
    for (const [old, value] of memory) { if (memoryBytes <= MEMORY_LIMIT) break; memory.delete(old); memoryBytes -= value.length; }
  };
  const diskPath = id => join(cacheRoot, `${id}`);
  const fromDisk = async id => { try { return await readFile(diskPath(id)); } catch { return undefined; } };
  const toDisk = async (id, buffer) => {
    try { await mkdir(cacheRoot, { recursive: true }); const temp = `${diskPath(id)}.${process.pid}.tmp`; await writeFile(temp, buffer); await rename(temp, diskPath(id)); } catch { /* the cache is optional */ }
  };
  const queue = []; let working = false; const queued = new Set();
  const background = (id, job) => {
    if (queued.has(id)) return;
    queued.add(id); queue.push([id, job]);
    if (working) return;
    working = true;
    void (async () => {
      while (queue.length) { const [jobId, next] = queue.shift(); try { await next(); } catch { /* keep serving the fast copy */ } queued.delete(jobId); }
      working = false;
    })();
  };
  const inflight = new Map();
  /** The encoded bytes of a file: best copy from memory or disk, else a fast one now (and the best one queued). */
  const encoded = async (resolved, tag, encoding) => {
    const id = `${tag}.${encoding}`;
    const hit = memory.get(id) ?? await fromDisk(id);
    if (hit) { remember(id, hit); return hit; }
    let pending = inflight.get(id);
    if (!pending) {
      pending = (async () => {
        const raw = await readFile(resolved);
        const fast = encoding === 'br' ? await brotli(raw, FAST) : await gz(raw, { level: 6 });
        remember(id, fast);
        background(id, async () => {
          const best = encoding === 'br'
            ? await brotli(raw, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: raw.length } })
            : await gz(raw, { level: 9 });
          const chosen = best.length < fast.length ? best : fast;
          remember(id, chosen); await toDisk(id, chosen);
        });
        return fast;
      })().finally(() => inflight.delete(id));
      inflight.set(id, pending);
    }
    return pending;
  };

  const handler = (request, response, next) => {
    const [path, query = ''] = (request.url ?? '').split('?');
    if (!path.startsWith('/ao-assets/')) return next();
    void (async () => {
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
      let key;
      try { key = decodeURIComponent(path.slice('/ao-assets/'.length)); }
      catch { response.writeHead(400).end(); return; }
      const pinned = new URLSearchParams(query).get('v') === version;
      if (key === 'audio-index.json') {
        // Which sounds exist, so the client never probes a missing OGG (most waves ship as both, some as wav only).
        const names = folder => [...files.keys()].filter(k => k.startsWith(`${folder}/`)).map(k => k.slice(folder.length + 1).replace(/\.[^.]+$/, ''));
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': pinned ? IMMUTABLE : REVALIDATE, ETag: `"${version}"`, 'X-Content-Type-Options': 'nosniff' });
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ ogg: names('ogg'), wav: names('wav'), mp3: names('mp3') }));
        return;
      }
      const filename = ALLOWED_ASSETS.test(key) ? files.get(key.toLowerCase()) : undefined;
      if (!filename) { response.writeHead(404).end('Local asset not found'); return; }
      const resolved = await realpath(filename);
      const child = relative(root, resolved);
      if (child.startsWith('..') || isAbsolute(child)) { response.writeHead(403).end(); return; }
      const info = await stat(resolved);
      const lower = key.toLowerCase();
      const type = lower.endsWith('.png') ? 'image/png' : lower.endsWith('.bmp') ? 'image/bmp' : lower.endsWith('.ogg') ? 'audio/ogg'
        : lower.endsWith('.wav') ? 'audio/wav' : lower.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream';
      const tag = createHash('sha256').update(`${lower}:${info.size}:${Math.floor(info.mtimeMs)}`).digest('hex').slice(0, 20);
      const caching = { 'Cache-Control': pinned ? IMMUTABLE : REVALIDATE, 'X-Content-Type-Options': 'nosniff' };
      const rangeHeader = request.headers.range;
      // Whole-file answers may be compressed; each encoding has its own ETag.
      const accept = String(request.headers['accept-encoding'] ?? '');
      const encoding = rangeHeader || !COMPRESSIBLE.test(lower) || info.size < 512 ? undefined : /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : undefined;
      const vary = COMPRESSIBLE.test(lower) ? { Vary: 'Accept-Encoding' } : {};
      const etag = `"${tag}-${encoding ?? 'raw'}"`;
      if (!rangeHeader && request.headers['if-none-match'] === etag) { response.writeHead(304, { ETag: etag, ...caching, ...vary }).end(); return; }
      const body = encoding ? await encoded(resolved, tag, encoding) : undefined;
      if (body) {
        response.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Content-Encoding': encoding, ETag: etag, ...caching, ...vary });
        response.end(request.method === 'HEAD' ? undefined : body);
        return;
      }
      // Media elements loop and seek with Range requests: answer "bytes=a-b" with 206.
      const range = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? '');
      let start = 0, end = info.size - 1, status = 200;
      if (range && (range[1] || range[2]) && info.size > 0) {
        start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
        if (start > end || start >= info.size) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end(); return; }
        status = 206;
      }
      response.writeHead(status, {
        'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
        ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}),
        ETag: etag, ...caching, ...vary,
      });
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(resolved, info.size > 0 ? { start, end } : {});
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    })().catch(() => { if (!response.headersSent) response.writeHead(404).end('Local asset unavailable'); else response.destroy(); });
  };
  handler.version = version;
  return handler;
}

/** The page names the asset version so the client can pin every /ao-assets URL to it (and the splash preload is pinned too). */
export function injectAssetVersion(html, version) {
  return html
    .replace(/(href="\/ao-assets\/[^"?]+)"/g, `$1?v=${version}"`)
    .replace('<head>', `<head>\n    <meta name="ao-assets-version" content="${version}" />`);
}

/**
 * Production bundle (vite preview): index.html revalidates (and carries the asset version), the hashed files under /assets/ are
 * immutable, and text files go brotli/gzip. Answers only what exists in `distDir`; everything else falls through to vite.
 */
export function distDelivery(distDir, version) {
  const cache = new Map();
  const compressible = /\.(js|css|html|svg|json|map)$/i;
  return (request, response, next) => {
    const path = (request.url ?? '').split('?')[0];
    const page = path === '/' || path === '/index.html';
    if (!page && !/^\/assets\/[\w.-]+$/.test(path)) return next();
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    void (async () => {
      const file = join(distDir, page ? 'index.html' : path.slice(1));
      const accept = String(request.headers['accept-encoding'] ?? '');
      const encoding = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : undefined;
      const id = `${file}:${compressible.test(file) ? encoding ?? 'raw' : 'raw'}`;
      let entry = cache.get(id);
      if (!entry) {
        let raw = await readFile(file);
        if (page) raw = Buffer.from(injectAssetVersion(raw.toString('utf8'), version));
        const zip = compressible.test(file) && encoding;
        const body = !zip ? raw : encoding === 'br'
          ? await brotli(raw, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: raw.length } }) : await gz(raw, { level: 9 });
        const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : file.endsWith('.svg') ? 'image/svg+xml'
          : file.endsWith('.json') || file.endsWith('.map') ? 'application/json' : file.endsWith('.png') ? 'image/png' : file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream';
        entry = { body, type, encoding: zip ? encoding : undefined, etag: `"${createHash('sha256').update(body).digest('hex').slice(0, 20)}"` };
        cache.set(id, entry);
      }
      const headers = {
        'Content-Type': entry.type, ETag: entry.etag, 'X-Content-Type-Options': 'nosniff', Vary: 'Accept-Encoding',
        'Cache-Control': page ? 'no-cache' : 'public, max-age=31536000, immutable', ...(entry.encoding ? { 'Content-Encoding': entry.encoding } : {}),
      };
      if (request.headers['if-none-match'] === entry.etag) { response.writeHead(304, headers).end(); return; }
      response.writeHead(200, { ...headers, 'Content-Length': entry.body.length });
      response.end(request.method === 'HEAD' ? undefined : entry.body);
    })().catch(() => next());
  };
}
