// AGPL-3.0-or-later. Only these local resources are exposed; no copying into dist.
import { createReadStream } from 'node:fs';
import { realpath, readdir, stat } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';

export async function localAssets(directory) {
  if (!directory) throw new Error('Set AO_ASSETS to your local ao-reference/Recursos directory. Assets are never bundled.');
  const root = await realpath(directory);
  const files = new Map();
  const allowed = /^(Mapas\/mapa\d+\.csm|Graficos\/\d+\.png|init\/(graficos\.ini|cuerpos\.dat|moldes\.ini|cabezas\.ind|armas\.dat|escudos\.dat|cascos\.ind|colores\.dat|FXs\.ini|sp_localindex\.dat|sp_localmsg\.dat)|interface\/[a-z0-9_-]+\.bmp|Minimapas\/mapa\d+\.bmp|Dat\/(Obj|Hechizos)\.dat)$/i;
  const folders = await readdir(root);
  for (const folder of ['Mapas', 'Graficos', 'init', 'interface', 'Dat', 'Minimapas']) {
    const actual = folders.find(name => name.toLowerCase() === folder.toLowerCase());
    if (!actual) { if (folder === 'Minimapas') continue; throw new Error(`Missing local asset directory: ${folder}`); }
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
      const filename = allowed.test(key) ? files.get(key.toLowerCase()) : undefined;
      if (!filename) { response.writeHead(404).end('Local asset not found'); return; }
      const resolved = await realpath(filename);
      const child = relative(root, resolved);
      if (child.startsWith('..') || isAbsolute(child)) { response.writeHead(403).end(); return; }
      const info = await stat(resolved);
      response.writeHead(200, {
        'Content-Type': key.toLowerCase().endsWith('.png') ? 'image/png' : key.toLowerCase().endsWith('.bmp') ? 'image/bmp' : 'application/octet-stream',
        'Content-Length': info.size, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(resolved);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    })().catch(() => { if (!response.headersSent) response.writeHead(404).end('Local asset unavailable'); else response.destroy(); });
  };
}
