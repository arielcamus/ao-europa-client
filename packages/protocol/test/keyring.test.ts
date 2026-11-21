import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  KeyringClientPacketId as KC, KeyringServerPacketId as KS, MAX_KEYS,
  decodeClientPacket, decodeServerPacket, encodeClientPacket, encodeServerPacket,
} from '../src/index.js';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');

// Hand-built from the VB6 writers' field order (client Protocol_Writes.bas WriteUseKey / WriteItemMove / WriteDeleteItem, server WriteUpdateUserKey /
// WriteShowPapiro): id Int16 little endian, then the fields. Also asserted against the real recordings below.
const server: [string, string, object][] = [
  ['ShowPapiro has no payload', '6900', { id: KS.ShowPapiro }],
  ['UpdateUserKey: slot Int16, key object Int16', '9f00' + '0300' + '3600', { id: KS.UpdateUserKey, slot: 3, key: 54 }],
  ['UpdateUserKey with key 0 clears the slot', '9f00' + '0a00' + '0000', { id: KS.UpdateUserKey, slot: 10, key: 0 }],
];
const client: [string, string, object][] = [
  ['UseKey: slot Int8', 'd100' + '02', { id: KC.UseKey, slot: 2 }],
  ['Moveitem: dragged slot, then the drop slot', 'e100' + '0311', { id: KC.Moveitem, from: 3, to: 17 }],
  ['DeleteItem: isSkin first, then the slot', '1d01' + '00' + '10', { id: KC.DeleteItem, skin: false, slot: 16 }],
  ['DeleteItem of a skin', '1d01' + '01' + '08', { id: KC.DeleteItem, skin: true, slot: 8 }],
];

// #20 item 1: explicit hex for the two items packets the first review found without one (client Protocol_Writes.bas WriteCommerceSell / WriteDrop).
describe('items goldens requested by #20', () => {
  it('CommerceSell: slot Int8, amount Int16', () => {
    expect(hex(encodeClientPacket({ id: 11, slot: 3, amount: 2 } as never))).toBe('0b00' + '03' + '0200');
    expect(decodeClientPacket(bytes('0b000302' + '00'))).toEqual({ id: 11, slot: 3, amount: 2 });
  });
  it('Drop of gold uses the pseudo slot 200 (0xc8): slot Int8, amount Int32, counter Int32, x, y', () => {
    const packet = { id: 93, slot: 200, amount: 100000, counter: 7, x: 42, y: 53 };
    const wire = '5d00' + 'c8' + 'a0860100' + '07000000' + '2a' + '35';
    expect(hex(encodeClientPacket(packet as never))).toBe(wire);
    expect(decodeClientPacket(bytes(wire))).toEqual(packet);
  });
});

describe('key ring, move/delete and papyrus packets: hex goldens from the VB6 writer order', () => {
  it('ids are the PacketId.bas values', () => {
    expect([KS.ShowPapiro, KS.UpdateUserKey, KC.UseKey, KC.Moveitem, KC.DeleteItem, MAX_KEYS]).toEqual([105, 159, 209, 225, 285, 10]);
  });
  for (const [name, wire, packet] of server) it(`server ${name}`, () => { expect(decodeServerPacket(bytes(wire))).toEqual(packet); expect(hex(encodeServerPacket(packet as never))).toBe(wire); });
  for (const [name, wire, packet] of client) it(`client ${name}`, () => { expect(decodeClientPacket(bytes(wire))).toEqual(packet); expect(hex(encodeClientPacket(packet as never))).toBe(wire); });
});

// Recordings of the real VB6 server (tests/fixtures/vb6/items-2).
const dir = new URL('../../../tests/fixtures/vb6/items-2/', import.meta.url);
interface Line { dir: 'c2s' | 's2c'; id: number; name: string; hex: string }
const files = readdirSync(dir).filter(f => f.endsWith('.jsonl'));
const load = (file: string): Line[] => readFileSync(new URL(file, dir), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const owned = { s2c: new Set<number>(Object.values(KS)), c2s: new Set<number>(Object.values(KC)) };
const decoded = (file: string, side: Line['dir'], id: number) =>
  load(file).filter(l => l.dir === side && l.id === id).map(l => (side === 's2c' ? decodeServerPacket : decodeClientPacket)(bytes(l.hex)) as Record<string, unknown>);

describe('key ring, move/delete and papyrus against real VB6 recordings', () => {
  it('has every scenario', () => {
    expect(files.sort()).toEqual(['delete-item.jsonl', 'login-keys.jsonl', 'move-item.jsonl', 'papiro-sign.jsonl', 'use-key-locked-door.jsonl', 'use-key-no-target.jsonl']);
  });
  for (const file of files) {
    it(`${file}: every owned packet decodes and re-encodes to the same bytes; logins are redacted`, () => {
      for (const line of load(file)) {
        if (line.id === 304 || line.id === 305) { expect(line.hex).toHaveLength(4); continue; }
        if (!owned[line.dir].has(line.id)) continue;
        if (line.dir === 's2c') expect(hex(encodeServerPacket(decodeServerPacket(bytes(line.hex)) as never)), line.name).toBe(line.hex);
        else expect(hex(encodeClientPacket(decodeClientPacket(bytes(line.hex)) as never)), line.name).toBe(line.hex);
      }
    });
  }
  it('login: the server sends the account\'s house keys (slot, object) before Logged', () => {
    const lines = load('login-keys.jsonl'), keys = decoded('login-keys.jsonl', 's2c', KS.UpdateUserKey);
    expect(keys).toEqual([{ id: 159, slot: 1, key: 54 }, { id: 159, slot: 2, key: 65 }]);
    expect(lines.findIndex(l => l.id === KS.UpdateUserKey)).toBeLessThan(lines.findIndex(l => l.id === 2));
  });
  it('papyrus: left click on a Cartelera answers the look-at line then ShowPapiro', () => {
    expect(load('papiro-sign.jsonl').map(l => l.id)).toEqual([95, 37, KS.ShowPapiro]);
  });
  it('keys: UseKey answers with locale messages only (wrong key 898, opened 897, locked 899); no target and a bad slot say nothing', () => {
    const lines = load('use-key-locked-door.jsonl');
    expect(decoded('use-key-locked-door.jsonl', 'c2s', KC.UseKey)).toEqual([{ id: 209, slot: 2 }, { id: 209, slot: 1 }, { id: 209, slot: 1 }, { id: 209, slot: 11 }]);
    const messages = lines.filter(l => l.dir === 's2c' && l.id === 141).map(l => (decodeServerPacket(bytes(l.hex)) as { messageId: number }).messageId);
    expect(messages).toEqual([1074, 898, 897, 899]);
    expect(load('use-key-no-target.jsonl').filter(l => l.dir === 's2c')).toEqual([]);
  });
  it('move: moving into an empty slot clears the source and fills the target; two objects swap; a slot over the tier is silent', () => {
    const lines = load('move-item.jsonl'), updates = (from: number, to: number) => {
      const start = lines.findIndex(l => l.dir === 'c2s' && l.id === KC.Moveitem && l.hex === hex(encodeClientPacket({ id: KC.Moveitem, from, to }))), next = lines.findIndex((l, i) => i > start && l.id === KC.Moveitem);
      return lines.slice(start + 1, next < 0 ? undefined : next).filter(l => l.id === 63).map(l => decodeServerPacket(bytes(l.hex)) as { slot: number; object: number });
    };
    expect(updates(3, 17).map(u => [u.slot, u.object])).toEqual([[3, 0], [17, 3791]]);
    expect(updates(2, 3).map(u => [u.slot, u.object])).toEqual([[2, 3791], [3, 4334]]);
    expect(updates(1, 42)).toEqual([]);
  });
  it('delete: an equipped object (1288) and a skin (2255) are refused; an unequipped one is deleted (slot update + 1287)', () => {
    const lines = load('delete-item.jsonl'), messages = lines.filter(l => l.id === 141).map(l => (decodeServerPacket(bytes(l.hex)) as { messageId: number }).messageId);
    expect(messages).toEqual([1288, 2255, 1287, 1287]);
    expect(decoded('delete-item.jsonl', 's2c', 63)[0]).toMatchObject({ slot: 16, object: 0, amount: 0 });
  });
});
