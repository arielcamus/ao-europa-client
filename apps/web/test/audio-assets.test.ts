import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs tool, no types
import { localAssets } from '../../../tools/local-assets.mjs';

// A fake Recursos tree with synthetic bytes: the sound folders the client reads, plus the ones it requires.
const root = mkdtempSync(join(tmpdir(), 'ao-audio-assets-'));
for (const dir of ['Mapas', 'Graficos', 'init', 'interface', 'Dat', 'OGG', 'wav', 'Mp3']) mkdirSync(join(root, dir));
writeFileSync(join(root, 'OGG', 'ost_4.ogg'), Buffer.from('0123456789abcdef'));
writeFileSync(join(root, 'OGG', '23.ogg'), 'ogg');
writeFileSync(join(root, 'wav', '145 .wav'), 'wavdata');
writeFileSync(join(root, 'wav', '2187.WAV'), 'upper');
writeFileSync(join(root, 'Mp3', '31.mp3'), 'mp3');
writeFileSync(join(root, 'Dat', 'zonas.dat'), '[Config]\nCantidad=0\n');
writeFileSync(join(root, 'Dat', 'Balance.dat'), 'secret');
writeFileSync(join(root, 'wav', 'Sonidos.txt'), 'notes');
let base = ''; let close = () => {};
beforeAll(async () => {
  const handler = await localAssets(root);
  const server = createServer((req, res) => handler(req, res, () => { res.writeHead(418).end(); }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/ao-assets/`;
  close = () => server.close();
});
afterAll(() => close());

describe('local sound assets', () => {
  it('serves OGG, wav (odd names, upper-case extension), Mp3 and zonas.dat with audio types', async () => {
    const ogg = await fetch(`${base}OGG/ost_4.ogg`);
    expect([ogg.status, ogg.headers.get('content-type'), ogg.headers.get('accept-ranges')]).toEqual([200, 'audio/ogg', 'bytes']);
    expect(await (await fetch(`${base}wav/145%20.wav`)).text()).toBe('wavdata');
    expect((await fetch(`${base}wav/2187.wav`)).headers.get('content-type')).toBe('audio/wav');
    expect((await fetch(`${base}Mp3/31.mp3`)).headers.get('content-type')).toBe('audio/mpeg');
    expect((await fetch(`${base}Dat/zonas.dat`)).status).toBe(200);
  });
  it('lists the sounds that exist at audio-index.json (lower case, no extension)', async () => {
    const index = await (await fetch(`${base}audio-index.json`)).json() as { ogg: string[]; wav: string[]; mp3: string[] };
    expect(index.ogg.sort()).toEqual(['23', 'ost_4']);
    expect(index.wav.sort()).toEqual(['145 ', '2187']);
    expect(index.mp3).toEqual(['31']);
  });
  it('answers Range requests with 206 for media elements', async () => {
    const part = await fetch(`${base}OGG/ost_4.ogg`, { headers: { Range: 'bytes=2-5' } });
    expect([part.status, part.headers.get('content-range'), await part.text()]).toEqual([206, 'bytes 2-5/16', '2345']);
    const open = await fetch(`${base}OGG/ost_4.ogg`, { headers: { Range: 'bytes=10-' } });
    expect([open.status, await open.text()]).toEqual([206, 'abcdef']);
    const tail = await fetch(`${base}OGG/ost_4.ogg`, { headers: { Range: 'bytes=-4' } });
    expect(await tail.text()).toBe('cdef');
    expect((await fetch(`${base}OGG/ost_4.ogg`, { headers: { Range: 'bytes=99-' } })).status).toBe(416);
  });
  it('exposes nothing else: other Dat files, notes, traversal and unknown sounds are 404', async () => {
    for (const path of ['Dat/Balance.dat', 'wav/Sonidos.txt', 'OGG/..%2fDat%2fBalance.dat', 'OGG/ost_999.ogg']) {
      expect((await fetch(`${base}${path}`)).status, path).toBe(404);
    }
  });
});
