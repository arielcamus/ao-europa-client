import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { assetMiddleware } from '../dev/assets.js';

it('serves only read-only resource paths, with case-insensitive names and symlink confinement', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'ao-assets-'));
  const root = join(temporary, 'resources');
  await mkdir(join(root, 'Mapas'), { recursive: true });
  await mkdir(join(root, 'init'));
  await writeFile(join(root, 'Mapas', 'Mapa1.csm'), 'local fixture');
  await writeFile(join(temporary, 'outside.dat'), 'outside');
  await symlink(join(temporary, 'outside.dat'), join(root, 'init', 'outside.dat'));
  const middleware = assetMiddleware(root);
  const server = createServer((req, res) => middleware(req, res, () => res.writeHead(404).end()));
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listen address');
  const get = (path: string, method = 'GET') => new Promise<{ status: number; body: string }>((resolve, reject) => {
    request({ host: '127.0.0.1', port: address.port, path, method }, response => {
      let body = '';
      response.on('data', chunk => { body += String(chunk); });
      response.on('end', () => resolve({ status: response.statusCode!, body }));
    }).on('error', reject).end();
  });
  try {
    expect(await get('/assets/Mapas/mapa1.csm')).toEqual({ status: 200, body: 'local fixture' });
    expect(await get('/assets/Mapas/mapa1.csm', 'HEAD')).toEqual({ status: 200, body: '' });
    expect((await get('/assets/Mapas/mapa1.csm', 'PUT')).status).toBe(405);
    expect((await get('/assets/Mapas/%2e%2e/%2e%2e/outside.dat')).status).toBe(404);
    expect((await get('/assets/init/outside.dat')).status).toBe(403);
    expect((await get('/assets/Mapas/')).status).toBe(404);
    expect((await get('/assets/Mapas/mapa2.csm')).status).toBe(404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(temporary, { recursive: true, force: true });
  }
});
