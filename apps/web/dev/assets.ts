// AGPL-3.0-or-later. Vite/Node only. Never copied to dist or imported by browser code.
import { createReadStream } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { Connect } from 'vite';

export function assetMiddleware(assetRoot: string): Connect.NextHandleFunction {
  const directories = new Map<string, Promise<Map<string, string>>>();
  return (request, response, next) => {
    const raw = (request.url ?? '').split('?')[0]!;
    if (!raw.startsWith('/assets/')) { next(); return; }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD'); response.writeHead(405).end(); return;
    }
    void (async () => {
      let path: string;
      try { path = decodeURIComponent(raw.slice(8)); }
      catch { response.writeHead(400).end('Invalid asset path'); return; }
      // Only known resource directories/file kinds. No listings, dotfiles, arbitrary
      // paths, double decoding, writes or redirects to the user's filesystem.
      if (!/^(Graficos\/\d+\.png|Mapas\/mapa\d+\.csm|(init|Dat)\/[a-z0-9_-]+\.(ind|ini|dat))$/i.test(path)) {
        response.writeHead(404).end('Unknown asset'); return;
      }
      const [rawFolder, name] = path.split('/') as [string, string];
      const folders: Record<string, string> = { graficos: 'Graficos', mapas: 'Mapas', init: 'init', dat: 'Dat' };
      const folder = folders[rawFolder.toLowerCase()]!;
      const root = await realpath(assetRoot);
      const directory = join(root, folder);
      let entries = directories.get(directory);
      if (!entries) {
        entries = readdir(directory).then(names => new Map(names.map(name => [name.toLowerCase(), name])));
        directories.set(directory, entries);
        entries.catch(() => directories.delete(directory));
      }
      const filename = (await entries).get(name.toLowerCase());
      if (!filename) { response.writeHead(404).end('Missing local asset'); return; }
      const fullPath = await realpath(join(directory, filename));
      if (!fullPath.startsWith(root + sep)) { response.writeHead(403).end('Asset outside AO_ASSETS'); return; }
      const info = await stat(fullPath);
      if (!info.isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200, {
        'Content-Type': name.toLowerCase().endsWith('.png') ? 'image/png' : 'application/octet-stream',
        'Content-Length': info.size, 'Cache-Control': 'private, max-age=0, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(fullPath);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    })().catch(() => {
      if (!response.headersSent) response.writeHead(503).end('Local resources unavailable. Set AO_ASSETS to the Recursos directory.');
      else response.destroy();
    });
  };
}
