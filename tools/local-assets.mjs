// AGPL-3.0-or-later. Only these local resources are exposed; no copying into dist.
import { createReadStream } from 'node:fs';
import { realpath, readdir, stat } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';

export async function localAssets(directory) {
  if (!directory) throw new Error('Set AO_ASSETS to your local ao-reference/Recursos directory. Assets are never bundled.');
  const root = await realpath(directory);
  const files = new Map();
  const allowed = /^(Mapas\/mapa\d+\.csm|Graficos\/\d+\.png|init\/(graficos\.ini|cuerpos\.dat|moldes\.ini|cabezas\.ind|armas\.dat|escudos\.dat|cascos\.ind|colores\.dat|FXs\.ini|particles\.ind|ProjectileDef\.dat|sp_localindex\.dat|sp_localmsg\.dat)|interface\/[a-z0-9_-]+\.bmp|Minimapas\/mapa\d+\.bmp|Dat\/(Obj|Hechizos|zonas|npcs)\.dat|OGG\/[\w -]+\.ogg|wav\/[\w -]+\.wav|Mp3\/\d+\.mp3)$/i;
  const folders = await readdir(root);
  // Minimapas and the sound folders are optional: without them there is no minimap picture / the client is silent.
  for (const folder of ['Mapas', 'Graficos', 'init', 'interface', 'Dat', 'Minimapas', 'OGG', 'wav', 'Mp3']) {
    const actual = folders.find(name => name.toLowerCase() === folder.toLowerCase());
    if (!actual) { if (['Minimapas', 'OGG', 'wav', 'Mp3'].includes(folder)) continue; throw new Error(`Missing local asset directory: ${folder}`); }
    for (const name of await readdir(join(root, actual))) {
      const path = `${actual}/${name}`;
      if (allowed.test(path)) files.set(path.toLowerCase(), join(root, path));
    }
  }
  return (request, response, next) => {
    const path = (request.url ?? '').split('?')[0];
    if (!path.startsWith('/ao-assets/')) return next();
    void (async () => {
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
      let key;
      try { key = decodeURIComponent(path.slice('/ao-assets/'.length)); }
      catch { response.writeHead(400).end(); return; }
      if (key === 'audio-index.json') {
        // Which sounds exist, so the client never probes a missing OGG (most waves ship as both, some as wav only).
        const names = folder => [...files.keys()].filter(k => k.startsWith(`${folder}/`)).map(k => k.slice(folder.length + 1).replace(/\.[^.]+$/, ''));
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' });
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ ogg: names('ogg'), wav: names('wav'), mp3: names('mp3') }));
        return;
      }
      const filename = allowed.test(key) ? files.get(key.toLowerCase()) : undefined;
      if (!filename) { response.writeHead(404).end('Local asset not found'); return; }
      const resolved = await realpath(filename);
      const child = relative(root, resolved);
      if (child.startsWith('..') || isAbsolute(child)) { response.writeHead(403).end(); return; }
      const info = await stat(resolved);
      const lower = key.toLowerCase();
      const type = lower.endsWith('.png') ? 'image/png' : lower.endsWith('.bmp') ? 'image/bmp' : lower.endsWith('.ogg') ? 'audio/ogg'
        : lower.endsWith('.wav') ? 'audio/wav' : lower.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream';
      // Media elements loop and seek with Range requests: answer "bytes=a-b" with 206.
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
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
        'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(resolved, info.size > 0 ? { start, end } : {});
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    })().catch(() => { if (!response.headersSent) response.writeHead(404).end('Local asset unavailable'); else response.destroy(); });
  };
}
