import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, request } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
// @ts-expect-error plain .mjs tool, no types
import { injectAssetVersion, localAssets } from '../../../tools/local-assets.mjs';

// Issue #79: how the local resources travel on a slow link. Synthetic bytes only.
const root = mkdtempSync(join(tmpdir(), 'ao-delivery-'));
for (const dir of ['Mapas', 'Graficos', 'init', 'interface', 'Dat']) mkdirSync(join(root, dir));
const bmp = Buffer.concat([Buffer.from('BM'), Buffer.alloc(40_000, 7)]); // a flat bitmap compresses well
writeFileSync(join(root, 'interface', 'es_ventanabanco.bmp'), bmp);
writeFileSync(join(root, 'Graficos', '239.png'), Buffer.alloc(4000, 9));
writeFileSync(join(root, 'init', 'graficos.ini'), 'Grh1=1-1-0-0-32-32\r\n'.repeat(500));
let port = 0, version = '', close = () => {};
beforeAll(async () => {
  const handler = await localAssets(root, { cacheDir: mkdtempSync(join(tmpdir(), 'ao-delivery-cache-')) }) as ((...args: unknown[]) => void) & { version: string };
  version = handler.version;
  const server = createServer((req, res) => handler(req, res, () => { res.writeHead(418).end(); }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
  close = () => server.close();
});
afterAll(() => close());
/** Raw HTTP (no automatic decompression), so the bytes on the wire are visible. */
const get = (path: string, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((resolve, reject) => {
  request({ host: '127.0.0.1', port, path, headers }, res => { const chunks: Buffer[] = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) })); }).on('error', reject).end();
});

describe('asset delivery', () => {
  it('compresses BMP and init files with brotli and serves the same bytes', async () => {
    const r = await get('/ao-assets/interface/es_ventanabanco.bmp', { 'Accept-Encoding': 'gzip, br' });
    expect([r.status, r.headers['content-encoding'], r.headers['content-type'], r.headers.vary]).toEqual([200, 'br', 'image/bmp', 'Accept-Encoding']);
    expect(r.body.length).toBeLessThan(bmp.length / 10);
    expect(brotliDecompressSync(r.body).equals(bmp)).toBe(true);
    const plain = await get('/ao-assets/interface/es_ventanabanco.bmp');
    expect([plain.headers['content-encoding'], plain.body.equals(bmp)]).toEqual([undefined, true]);
    const ini = await get('/ao-assets/init/graficos.ini', { 'Accept-Encoding': 'gzip' });
    expect(ini.headers['content-encoding']).toBe('gzip');
  });
  it('never recompresses PNG sheets', async () => {
    const r = await get('/ao-assets/Graficos/239.png', { 'Accept-Encoding': 'br' });
    expect([r.headers['content-encoding'], r.body.length]).toEqual([undefined, 4000]);
  });
  it('pins URLs with the asset version as immutable; others revalidate with an ETag (304)', async () => {
    const pinned = await get(`/ao-assets/Graficos/239.png?v=${version}`);
    expect(pinned.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    const loose = await get('/ao-assets/Graficos/239.png?v=stale');
    expect(loose.headers['cache-control']).toBe('private, no-cache');
    const again = await get('/ao-assets/Graficos/239.png', { 'If-None-Match': String(loose.headers.etag) });
    expect([again.status, again.body.length]).toEqual([304, 0]);
  });
  it('Range requests stay uncompressed (media elements)', async () => {
    const r = await get('/ao-assets/interface/es_ventanabanco.bmp', { 'Accept-Encoding': 'br', Range: 'bytes=0-1' });
    expect([r.status, r.headers['content-encoding'], r.body.toString()]).toEqual([206, undefined, 'BM']);
  });
  it('the page carries the version and the splash preload is pinned to it', () => {
    const html: string = injectAssetVersion('<head>\n<link rel="preload" as="image" href="/ao-assets/interface/es_VentanaCargando.bmp" /></head>', 'abc123');
    expect(html).toContain('<meta name="ao-assets-version" content="abc123" />');
    expect(html).toContain('href="/ao-assets/interface/es_VentanaCargando.bmp?v=abc123"');
  });
});

describe('window pictures wait while the client boots', () => {
  const requested: string[] = [];
  class FakeImage { src = ''; decode() { requested.push(this.src); return Promise.resolve(); } }
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); requested.length = 0; });
  it('queues window art, loads splash and login art at once, then drains two at a time and lets a re-request jump the queue', async () => {
    vi.stubGlobal('Image', FakeImage);
    const ui = await import('../src/interface-assets.js');
    const bank = ui.loadInterface('ventanabanco'), quests = ui.loadInterface('ventananuevamision'), skills = ui.loadInterface('ventanaskills');
    void bank; void quests;
    await ui.loadInterface('VentanaCargando');
    await ui.loadInterface('boton-ingresar-over');
    expect(requested).toEqual(['/ao-assets/interface/es_VentanaCargando.bmp', '/ao-assets/interface/es_boton-ingresar-over.bmp']);
    expect(ui.queuedInterfaceCount()).toBe(3);
    ui.interfaceBootDone();
    // Asked for again after the boot (the window opens): it starts although the queue is not draining.
    await ui.loadInterface('ventanaskills');
    await skills;
    expect(requested.at(-1)).toBe('/ao-assets/interface/es_ventanaskills.bmp');
    expect(ui.queuedInterfaceCount()).toBe(2);
    // A picture first asked for after the boot loads at once.
    await ui.loadInterface('comerciar');
    expect(requested.at(-1)).toBe('/ao-assets/interface/es_comerciar.bmp');
    ui.setInterfaceDrain(true);
    expect(ui.queuedInterfaceCount()).toBe(0);
    await Promise.all([bank, quests]);
    expect(requested.slice(-2).sort()).toEqual(['/ao-assets/interface/es_ventanabanco.bmp', '/ao-assets/interface/es_ventananuevamision.bmp']);
  });
});
