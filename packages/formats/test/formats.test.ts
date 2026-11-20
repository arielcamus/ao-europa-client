import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BinaryReader, FormatError, parseCsm, parseGraphics, grhFrame, graphicOffset,
  bodyFromIni, parseIni, parseHeads, canEnter, tileIndex, FIVE_LAYER_SIGNATURE,
} from '../src/index.js';
import { mapExcerpt, graphicsExcerpt } from './local-fixtures.js';

const root = process.env.AO_ASSETS ?? '';
const available = !!root && existsSync(join(root, 'Mapas/mapa1.csm'));

describe('resource bounds without licensed fixtures', () => {
  it('rejects truncated input and impossible counts before allocation', () => {
    expect(() => parseCsm(new Uint8Array())).toThrow(FormatError);
    expect(() => parseGraphics(new Uint8Array(7))).toThrow(FormatError);
    expect(() => parseCsm(Uint8Array.of(255, 255, 255, 127))).toThrow(/count/);
    expect(() => new BinaryReader(new Uint8Array()).skip(-1)).toThrow(FormatError);
  });
  it('uses VB6 ANSI strings, not protocol String8/UTF-8', () => {
    expect(new BinaryReader(Uint8Array.of(3, 0, 65, 241, 111)).string()).toBe('Año');
  });
  it('anchors large sprites to the bottom center of a tile', () => {
    expect(graphicOffset({ file: 1, x: 0, y: 0, width: 96, height: 128 })).toEqual({ x: -32, y: -96 });
  });
});

describe.skipIf(!available)('local resource excerpts (set AO_ASSETS; no artwork in git)', () => {
  it('reads original map metadata, sparse layers, blockers and exact section boundaries', () => {
    const fixture = mapExcerpt(root), map = parseCsm(fixture.bytes);
    expect(map.layers).toHaveLength(5);
    expect(map.metadata.name.length).toBeGreaterThan(0);
    const original = fixture.records[1]!;
    expect(map.layers[0]![0]).toEqual({ x: original.readInt16LE(0), y: original.readInt16LE(2), grh: original.readInt32LE(4) });
    const blocked = fixture.records[0]!;
    expect(map.blocked[tileIndex(blocked.readInt16LE(0), blocked.readInt16LE(2))]).toBe(blocked[4]);
    if (!fixture.modern) {
      expect(map.layers[2]).toEqual([]);
      expect(map.layers[4]![0]!.grh).toBe(fixture.records[4]!.readInt32LE(4));
    }
    const full = parseCsm(readFileSync(join(root, 'Mapas/mapa1.csm')));
    expect(full.layers[0]).toHaveLength(10_000);
    expect(full.metadata.name).toEqual(map.metadata.name);
  });
  it('maps legacy layers to the signed five-layer layout and supports a populated third layer', () => {
    const fixture = mapExcerpt(root);
    if (fixture.modern) return;
    const old = parseCsm(fixture.bytes);
    const header = Buffer.alloc(52);
    header.writeInt32LE(FIVE_LAYER_SIGNATURE);
    for (let i = 0; i < 11; i++) header.writeInt32LE(fixture.bytes.readInt32LE(i * 4), 4 + (i < 3 ? i : i + 1) * 4);
    header.writeInt32LE(1, 16); // one new layer-3 graphic, copied from real layer 2
    const records = fixture.records;
    const modern = Buffer.concat([header, fixture.bytes.subarray(44, fixture.metadataEnd), ...records.slice(0, 3), records[2]!.subarray(0, 8), ...records.slice(3)]);
    const map = parseCsm(modern);
    expect(map.format).toBe('five-layer');
    expect(map.layers[2]).toEqual([old.layers[1]![0]]);
    expect(map.layers[3]).toEqual(old.layers[3]);
    expect(map.layers[4]).toEqual(old.layers[4]);
  });
  it('uses destination direction bits instead of treating every nonzero flag as blocked', () => {
    const map = parseCsm(mapExcerpt(root).bytes);
    map.blocked[tileIndex(50, 50)] = 0b0001;
    expect(canEnter(map, 50, 50, 1)).toBe(false);
    expect(canEnter(map, 50, 50, 2)).toBe(true);
    expect(canEnter(map, 0, 50, 2)).toBe(false);
    expect(canEnter(map, 50, 101, 3)).toBe(false);
  });
  it('rejects bad coordinates/truncation and distinguishes legacy stale tails from structured trailers', () => {
    const fixture = mapExcerpt(root);
    const bad = Buffer.from(fixture.bytes);
    bad.writeInt16LE(101, fixture.metadataEnd);
    expect(() => parseCsm(bad)).toThrow(/coordinate/);
    expect(() => parseCsm(fixture.bytes.subarray(0, -1))).toThrow(FormatError);
    if (fixture.modern) expect(() => parseCsm(Buffer.concat([fixture.bytes, Buffer.alloc(10)]))).toThrow(FormatError);
    else expect(parseCsm(Buffer.concat([fixture.bytes, Buffer.alloc(10)])).trailingBytes).toBe(10);
    if (!fixture.modern) {
      const trailer = Buffer.alloc(16);
      trailer.writeInt32LE(0x31423257); trailer.writeInt32LE(1, 4);
      fixture.records[1]!.copy(trailer, 8, 0, 8);
      expect(parseCsm(Buffer.concat([fixture.bytes, trailer])).legacyBridgeGraphics).toHaveLength(1);
      trailer.writeInt32LE(2, 4);
      expect(() => parseCsm(Buffer.concat([fixture.bytes, trailer]))).toThrow(FormatError);
    }
  });
  it('reads real frame rectangles and animation duration/loop boundaries', () => {
    const fixture = graphicsExcerpt(root), index = parseGraphics(fixture.bytes);
    const id = fixture.animation.readInt32LE(0), count = fixture.ids.length;
    const duration = fixture.animation.readFloatLE(fixture.animation.length - 4);
    const first = grhFrame(index, id);
    expect(first).toEqual({ file: fixture.first.readInt32LE(6), x: fixture.first.readInt16LE(10), y: fixture.first.readInt16LE(12), width: fixture.first.readInt16LE(14), height: fixture.first.readInt16LE(16) });
    expect(grhFrame(index, id, duration)).toEqual(first);
    expect(grhFrame(index, id, duration / count + 0.01)).toEqual(grhFrame(index, fixture.ids[1]!));
    expect(() => parseGraphics(fixture.bytes.subarray(0, -1))).toThrow(FormatError);
    const bad = Buffer.from(fixture.bytes);
    bad.writeInt32LE(0, bad.length - fixture.animation.length + 6);
    expect(() => parseGraphics(bad)).toThrow(/missing/);
  });
  it('resolves the installed body templates and binary heads against the full graphics index', () => {
    const index = parseGraphics(readFileSync(join(root, 'init/graficos.ind')));
    const bodies = parseIni(readFileSync(join(root, 'init/cuerpos.dat'), 'latin1'));
    const molds = parseIni(readFileSync(join(root, 'init/moldes.ini'), 'latin1'));
    const body = bodyFromIni(bodies, molds, index, 1);
    expect(body.directions.map(d => d.frames.length)).toEqual([6, 5, 6, 5]);
    expect(body.directions[2]!.frames[0]).toEqual({ file: 1005, x: 0, y: 0, width: 27, height: 47 });
    expect(body.directions[0]!.frames[0]!.y).toBe(47);
    for (const id of parseHeads(readFileSync(join(root, 'init/cabezas.ind')))[1]!) {
      expect(grhFrame(index, id).width).toBeGreaterThan(0);
    }
  });
});
