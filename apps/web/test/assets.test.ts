import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clipFrame, graphicAnimation, parseGraphics, parseHeads, parseIni, parseMap, readBody, tileIndex } from '../src/assets.js';

// Original synthetic fixture. No upstream maps, graphics or metadata are embedded.
function mapFixture(five = false, x = 25) {
  const chunks: Buffer[] = [];
  const n = (value: number, size: number) => { const b = Buffer.alloc(size); b.writeIntLE(value, 0, size); chunks.push(b); };
  const text = (value: string) => { const b = Buffer.from(value, 'latin1'); n(b.length, 2); chunks.push(b); };
  if (five) n(0x324c3557, 4);
  n(1, 4); // blocked count
  for (let i = 0; i < (five ? 5 : 4); i++) n(1, 4);
  for (let i = 0; i < 6; i++) n(0, 4);
  for (let i = 0; i < 4; i++) n(0, 2);
  text('Peña'); n(0, 1); text(''); n(0, 4); n(0, 4); n(1, 1);
  text('city'); text('grass'); text('');
  for (let i = 0; i < 4; i++) n(0, 4);
  text(''); n(0, 1); n(0, 1); n(0, 1);
  n(x, 2); n(40, 2); n(15, 1);
  for (let i = 0; i < (five ? 5 : 4); i++) { n(x, 2); n(40, 2); n(70_000 + i, 4); }
  return Buffer.concat(chunks);
}
describe('classic local resources', () => {
  it('clips incomplete upstream rectangles without changing their indexed dimensions', () => {
    const frame = { file: 1, x: 0, y: 48, width: 32, height: 32 };
    expect(clipFrame(frame, 64, 64)).toEqual({ width: 32, height: 16, clipped: true });
    expect(frame.height).toBe(32);
    expect(clipFrame(frame, 64, 128).clipped).toBe(false);
  });
  it('reads ANSI metadata and 32-bit references, inserting the empty legacy third layer', () => {
    const map = parseMap(mapFixture());
    expect(map.name).toBe('Peña');
    expect(map.blocked[tileIndex(25, 40)]).toBe(15);
    expect(map.layers.map(layer => layer[tileIndex(25, 40)])).toEqual([70_000, 70_001, 0, 70_002, 70_003]);
    expect(map.trailingBytes).toBe(0);
  });
  it('reads signed W5L2 maps with five layers', () => {
    expect(parseMap(mapFixture(true)).layers.map(layer => layer[tileIndex(25, 40)])).toEqual([70_000, 70_001, 70_002, 70_003, 70_004]);
  });
  it('rejects truncated render data, unreasonable counts and invalid coordinates', () => {
    const bytes = mapFixture();
    expect(() => parseMap(bytes.subarray(0, -1))).toThrow('Truncated');
    expect(() => parseMap(mapFixture(false, 101))).toThrow('outside');
    bytes.writeInt32LE(10001, 0);
    expect(() => parseMap(bytes)).toThrow('count');
  });
  it('resolves animation references and millisecond frame durations', () => {
    const index = parseGraphics('[Graphics]\nGrh1=1-3-0-0-32-32\nGrh70000=1-3-32-0-32-32\nGrh9=2-1-70000-200');
    expect(graphicAnimation(index, 9)).toEqual({ frames: [
      { file: 3, x: 0, y: 0, width: 32, height: 32 }, { file: 3, x: 32, y: 0, width: 32, height: 32 },
    ], frameMs: 100 });
    expect(() => graphicAnimation(index, 8)).toThrow('Missing');
    expect(() => parseGraphics('Grh1=1-1-0-0-0-32')).toThrow('Invalid');
    expect(() => graphicAnimation(parseGraphics('Grh2=2-1-1-200'), 2)).toThrow('frame required');
    expect(graphicAnimation(parseGraphics('Grh1=1-3-0-0-32-32-99'), 1).frames).toHaveLength(1);
  });
  it('uses body template rows South, North, West, East with source offsets', () => {
    const body = readBody(
      parseIni('[BODY9]\nStd=7\nFileNum=12\nHeadOffsetX=2\nHeadOffsetY=-3\nBodyOffsetY=1\nSpeed=2'),
      parseIni('[Molde7]\nX=3\nY=5\nWidth=27\nHeight=47\nDir1=6\nDir2=5\nDir3=4\nDir4=3'), new Map(), 9,
    );
    expect(body.walk.map(a => [a.frames.length, a.frames[0]!.y])).toEqual([[5, 52], [3, 146], [6, 5], [4, 99]]);
    expect(body.walk[0]!.frameMs).toBeCloseTo(27.7778);
    expect(body.headY).toBe(-2);
  });
  it('ignores a trailing VB comment on a body value (the ghost body 829)', () => {
    const graphics = parseGraphics('Grh7=1-3-0-0-32-32\nGrh8=1-3-0-0-32-32\nGrh9=1-3-0-0-32-32\nGrh10=1-3-0-0-32-32');
    const body = readBody(parseIni("[BODY829]\nWalk1=7\t ' arriba\nWalk2=8\t ' derecha\nWalk3=9\t ' abajo\nWalk4=10  ' izq\nHeadOffsetY=-2"), new Map(), graphics, 829);
    expect(body.walk).toHaveLength(4); expect(body.headY).toBe(-2);
  });
  it('reads the 263-byte header and four int32 head references', () => {
    const bytes = Buffer.alloc(281); bytes.writeInt16LE(1, 263);
    [70_001, 70_002, 70_003, 70_004].forEach((n, i) => bytes.writeInt32LE(n, 265 + i * 4));
    expect(parseHeads(bytes)[1]).toEqual([70_001, 70_002, 70_003, 70_004]);
    expect(() => parseHeads(bytes.subarray(0, -1))).toThrow('Truncated');
  });
});

describe('parseIni section headers (clsIniManager.Initialize, GetPrivateProfileString)', () => {
  it('starts a new section at a header followed by a VB comment, and ignores a "[" line without "]"', () => {
    const ini = parseIni("[NPC559]\r\nName=Lobo Negro\r\n\r\n[NPC560] 'Ogro\r\nName=Ogro\r\n[OBJ195]'Borrar proxima temporada\r\nName=Tunica\r\n[broken\r\nGrhIndex=1\r\n");
    expect(ini.get('npc559')!.get('name')).toBe('Lobo Negro');
    expect(ini.get('npc560')!.get('name')).toBe('Ogro');
    expect(ini.get('obj195')).toEqual(new Map([['name', 'Tunica'], ['grhindex', '1']]));
    expect(ini.has("npc560] 'ogro")).toBe(false);
  });
  it('trims the name between the brackets, like UCase$(Trim$(Mid$(...)))', () => {
    expect(parseIni('[ NPC1 ]\nName=X').get('npc1')!.get('name')).toBe('X');
  });
});

// Every Dat the client parses with parseIni: each header line of the real file is its own section (pre-HOO obj.dat has 211 commented headers).
const datRoot = process.env.AO_ASSETS;
describe.skipIf(!datRoot || !existsSync(join(datRoot, 'init')))('parseIni on the real Dats', () => {
  const files = ['Dat/obj.dat', 'Dat/Obj.dat', 'Dat/Hechizos.dat', 'Dat/npcs.dat', 'init/armas.dat', 'init/colores.dat', 'init/sp_localindex.dat', 'init/FXs.ini', 'init/cuerpos.dat', 'init/escudos.dat']
    .filter((file, i, all) => existsSync(join(datRoot!, file)) && all.findIndex(f => f.toLowerCase() === file.toLowerCase()) === i);
  it.each(files)('%s: one section per header line', file => {
    const text = readFileSync(join(datRoot!, file), 'latin1');
    const headers = new Set([...text.matchAll(/^[ \t]*\[([^\]\r\n]+)\]/gm)].map(m => m[1]!.trim().toLowerCase()));
    expect([...parseIni(text).keys()].sort()).toEqual([...headers].sort());
  });
});
