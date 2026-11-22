import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, request } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
// @ts-expect-error plain .mjs tool, no types
import { distDelivery, localAssets } from '../../../tools/local-assets.mjs';

// Issue #92: resources patched while the play server runs. The version used to be fixed at start, so a patch kept the old ?v and the
// browser kept the old file for a year (immutable). Everything here happens in a throwaway copy of an asset tree; synthetic bytes only.
type Handler = ((...args: unknown[]) => void) & { version: string; refresh(): Promise<string>; prune(): Promise<string[]> };
const root = mkdtempSync(join(tmpdir(), 'ao-refresh-')), cacheDir = mkdtempSync(join(tmpdir(), 'ao-refresh-cache-'));
const dist = mkdtempSync(join(tmpdir(), 'ao-refresh-dist-'));
for (const dir of ['Mapas', 'Graficos', 'init', 'interface', 'Dat']) mkdirSync(join(root, dir));
const bmpPath = join(root, 'interface', 'es_ventanabanco.bmp'), pngPath = join(root, 'Graficos', '239.png');
const bitmap = (fill: number) => Buffer.concat([Buffer.from('BM'), Buffer.alloc(40_000, fill)]);
writeFileSync(bmpPath, bitmap(7));
writeFileSync(pngPath, Buffer.alloc(4000, 9));
writeFileSync(join(dist, 'index.html'), '<!doctype html><html><head><title>AO</title></head><body></body></html>');
let handler: Handler, port = 0, close = () => {};
beforeAll(async () => {
  handler = await localAssets(root, { cacheDir, refreshMs: 0 }) as Handler;
  const page = distDelivery(dist, () => handler.refresh()) as (...args: unknown[]) => void;
  const server = createServer((req, res) => page(req, res, () => handler(req, res, () => { res.writeHead(418).end(); })));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
  close = () => server.close();
});
afterAll(() => { close(); for (const dir of [root, cacheDir, dist]) rmSync(dir, { recursive: true, force: true }); });
const get = (path: string, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((resolve, reject) => {
  request({ host: '127.0.0.1', port, path, headers }, res => { const chunks: Buffer[] = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) })); }).on('error', reject).end();
});
/** What the browser gets for a bitmap: brotli on the wire, decoded here. */
const bmpBytes = async (version: string) => {
  const r = await get(`/ao-assets/interface/es_ventanabanco.bmp?v=${version}`, { 'Accept-Encoding': 'br' });
  expect(r.headers['content-encoding']).toBe('br');
  return brotliDecompressSync(r.body);
};
const pageVersion = async () => /name="ao-assets-version" content="(\w+)"/.exec((await get('/')).body.toString())?.[1] ?? '';
const cacheRoot = () => join(cacheDir, readdirSync(cacheDir)[0]!);
const settle = () => new Promise(resolve => setTimeout(resolve, 20)); // a later change time than the last write
/** Wait (bounded) for the background pass to keep its best copy on disk. */
const onDisk = async (min: number) => {
  for (let i = 0; i < 100; i++) { try { if (readdirSync(cacheRoot()).filter(n => !n.endsWith('.tmp')).length >= min) return; } catch { /* not yet */ } await new Promise(r => setTimeout(r, 50)); }
  throw new Error('no compressed copy written');
};

describe('patching the resources while the server runs (#92)', () => {
  it('a new size: next page load gets a new version and the new bytes, no restart', async () => {
    const v1 = handler.version;
    expect(await pageVersion()).toBe(v1);
    expect((await bmpBytes(v1)).equals(bitmap(7))).toBe(true);
    await settle(); writeFileSync(pngPath, Buffer.alloc(5000, 3));
    const v2 = await pageVersion();
    expect(v2).not.toBe(v1);
    const png = await get(`/ao-assets/Graficos/239.png?v=${v2}`);
    expect([png.body.length, png.body[0], png.headers['cache-control']]).toEqual([5000, 3, 'private, max-age=31536000, immutable']);
    // A page still open asks with the old version: no longer pinned, so it revalidates instead of being kept for a year.
    expect((await get(`/ao-assets/Graficos/239.png?v=${v1}`)).headers['cache-control']).toBe('private, no-cache');
  });

  it('cp -p (same size, mtime put back): the change time still gives a new version, and no stale compressed copy is served', async () => {
    await onDisk(1);
    const before = statSync(bmpPath), v1 = handler.version, etag = (await get(`/ao-assets/interface/es_ventanabanco.bmp?v=${v1}`, { 'Accept-Encoding': 'br' })).headers.etag;
    await settle(); writeFileSync(bmpPath, bitmap(8)); utimesSync(bmpPath, before.atimeMs / 1000, before.mtimeMs / 1000);
    const after = statSync(bmpPath);
    // What the version was made of before #92 (size, mtime to the ms) is unchanged, and so is the inode.
    expect([after.size, Math.floor(after.mtimeMs), after.ino]).toEqual([before.size, Math.floor(before.mtimeMs), before.ino]);
    const v2 = await pageVersion();
    expect(v2).not.toBe(v1);
    expect((await bmpBytes(v2)).equals(bitmap(8))).toBe(true);
    expect((await get(`/ao-assets/interface/es_ventanabanco.bmp?v=${v2}`, { 'Accept-Encoding': 'br' })).headers.etag).not.toBe(etag);
  });

  it('rsync -a (temp file renamed over, size and mtime kept): new version, new bytes', async () => {
    const before = statSync(bmpPath), v1 = handler.version, temp = join(root, 'interface', '.es_ventanabanco.bmp.Xy12');
    await settle(); writeFileSync(temp, bitmap(9)); utimesSync(temp, before.atimeMs / 1000, before.mtimeMs / 1000); renameSync(temp, bmpPath);
    expect([statSync(bmpPath).size, Math.floor(statSync(bmpPath).mtimeMs)]).toEqual([before.size, Math.floor(before.mtimeMs)]);
    const v2 = await pageVersion();
    expect(v2).not.toBe(v1);
    expect((await bmpBytes(v2)).equals(bitmap(9))).toBe(true);
  });

  it('files added or removed join or leave the set on the next page load', async () => {
    const added = join(root, 'interface', 'es_ventanaskills.bmp');
    expect((await get('/ao-assets/interface/es_ventanaskills.bmp')).status).toBe(404);
    writeFileSync(added, bitmap(5));
    const v2 = await pageVersion();
    expect((await get(`/ao-assets/interface/es_ventanaskills.bmp?v=${v2}`)).status).toBe(200);
    unlinkSync(added);
    expect(await pageVersion()).not.toBe(v2);
    expect((await get('/ao-assets/interface/es_ventanaskills.bmp')).status).toBe(404);
  });

  it('the compressed copies of replaced file states are pruned from the disk cache; current ones stay', async () => {
    await bmpBytes(handler.version); await onDisk(1);
    const kept = readdirSync(cacheRoot()).filter(n => !n.endsWith('.tmp'));
    // An old variant left by an earlier run, and one of the file as it is now.
    writeFileSync(join(cacheRoot(), '0123456789abcdef0123.br'), 'stale');
    expect(await handler.prune()).toEqual(['0123456789abcdef0123.br']);
    expect(readdirSync(cacheRoot()).sort()).toEqual(kept.sort());
    // Patch: the refresh that sees it drops the copy of the old state.
    await settle(); writeFileSync(bmpPath, bitmap(10));
    await pageVersion();
    expect(readdirSync(cacheRoot()).filter(n => kept.includes(n))).toEqual([]);
    expect((await bmpBytes(handler.version)).equals(bitmap(10))).toBe(true);
  });

  it('scans at most once per refreshMs', async () => {
    const throttled = await localAssets(root, { cacheDir, refreshMs: 60_000 }) as Handler;
    const v1 = throttled.version;
    await settle(); writeFileSync(pngPath, Buffer.alloc(6000, 4));
    expect(await throttled.refresh()).toBe(v1);
  });
});
