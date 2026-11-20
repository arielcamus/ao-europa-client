import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeClientPacket, decodeServerPacket, encodeClientPacket, encodeServerPacket, DoorServerPacketId, DoorClientPacketId } from '../src/index.js';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
// Bytes captured live from the VB6 server (Ullathorpe, 2026-11-20): body = int16 id + fields.
const live = {
  objectCreate: '3200' + '24195e09010000000000',  // x=36 y=25 ObjIndex=2398 (Cartel casa III) amount=1 tags=0
  objectCreateDoor: '3200' + '2d284c00010000000000', // x=45 y=40 ObjIndex=76 (Puerta 4 cerrada con llave)
  block: '3500' + '2d2801',                         // x=45 y=40 sides=1
  blockPartial: '3500' + '2c2906',                  // x=44 y=41 sides=6
};
describe('door/object packets (VB6 PrepareMessageObjectCreate, WriteBlockPosition)', () => {
  it('decodes and re-encodes live ObjectCreate bytes', () => {
    expect(decodeServerPacket(bytes(live.objectCreate))).toEqual({ id: DoorServerPacketId.ObjectCreate, x: 36, y: 25, objIndex: 2398, amount: 1, elementalTags: 0 });
    const door = decodeServerPacket(bytes(live.objectCreateDoor));
    expect(door).toMatchObject({ id: 50, x: 45, y: 40, objIndex: 76 });
    expect(hex(encodeServerPacket(door as never))).toBe(live.objectCreateDoor);
  });
  it('decodes and re-encodes live BlockPosition bytes', () => {
    expect(decodeServerPacket(bytes(live.block))).toEqual({ id: DoorServerPacketId.BlockPosition, x: 45, y: 40, sides: 1 });
    const partial = decodeServerPacket(bytes(live.blockPartial));
    expect(partial).toMatchObject({ x: 44, y: 41, sides: 6 });
    expect(hex(encodeServerPacket(partial as never))).toBe(live.blockPartial);
  });
  it('ObjectDelete is x,y and rejects trailing bytes (one packet per frame)', () => {
    expect(decodeServerPacket(bytes('3400' + '2d28'))).toEqual({ id: DoorServerPacketId.ObjectDelete, x: 45, y: 40 });
    expect(() => decodeServerPacket(bytes('3400' + '2d2801'))).toThrow();
    expect(() => decodeServerPacket(bytes('3200' + '2d28'))).toThrow(); // truncated ObjectCreate
  });
  it('encodes LeftClick(95) and DoubleClick(96) as tile bytes', () => {
    expect(hex(encodeClientPacket({ id: DoorClientPacketId.LeftClick, x: 72, y: 35 }))).toBe('5f00' + '4823');
    expect(hex(encodeClientPacket({ id: DoorClientPacketId.DoubleClick, x: 72, y: 35 }))).toBe('6000' + '4823');
    expect(decodeClientPacket(bytes('6000' + '4823'))).toEqual({ id: 96, x: 72, y: 35 });
  });
  const fixture = new URL('../../../tests/fixtures/vb6/doors/open-close-plain-door.jsonl', import.meta.url);
  it.skipIf(!existsSync(fixture))('decodes and re-encodes every door packet in the recorded VB6 session', () => {
    const rows = readFileSync(fixture, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { dir: string; id: number; hex: string });
    let checked = 0;
    for (const row of rows) {
      const body = Buffer.concat([Buffer.from([row.id & 255, row.id >> 8]), Buffer.from(row.hex, 'hex')]);
      if (row.dir === 's2c' && [50, 52, 53].includes(row.id)) { expect(hex(encodeServerPacket(decodeServerPacket(body) as never))).toBe(body.toString('hex')); checked++; }
      if (row.dir === 'c2s' && [95, 96].includes(row.id)) { expect(hex(encodeClientPacket(decodeClientPacket(body) as never))).toBe(body.toString('hex')); checked++; }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
