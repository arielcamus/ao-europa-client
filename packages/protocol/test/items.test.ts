import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { DoorServerPacketId as DS,
  decodeClientPacket, decodeServerPacket, encodeClientPacket, encodeServerPacket,
  ItemsClientPacketId as IC, ItemsServerPacketId as IS,
} from '../src/index.js';

const dir = new URL('../../../tests/fixtures/vb6/items/', import.meta.url);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
interface Line { dir: 'c2s' | 's2c'; id: number; name: string; hex: string }
const load = (file: string): Line[] => readFileSync(new URL(file, dir), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const files = readdirSync(dir).filter(f => f.endsWith('.jsonl'));
const serverIds = new Set<number>(Object.values(IS)), clientIds = new Set<number>(Object.values(IC));

describe('items packets recorded from the VB6 server', () => {
  it('has a fixture for every sub-feature', () => {
    expect(files).toEqual(expect.arrayContaining(['login.jsonl', 'use-items.jsonl', 'equip-unequip.jsonl', 'drop-pickup.jsonl', 'npc-shop.jsonl']));
  });
  for (const file of files) {
    it(`${file}: every items frame decodes and re-encodes to the same bytes`, () => {
      let seen = 0;
      for (const line of load(file)) {
        const body = Uint8Array.from(Buffer.from(line.hex, 'hex'));
        if (line.dir === 's2c' && serverIds.has(line.id)) {
          expect(hex(encodeServerPacket(decodeServerPacket(body) as never)), line.name).toBe(line.hex); seen++;
        } else if (line.dir === 'c2s' && clientIds.has(line.id)) {
          expect(hex(encodeClientPacket(decodeClientPacket(body) as never)), line.name).toBe(line.hex); seen++;
        }
      }
      expect(seen).toBeGreaterThan(0);
    });
  }
  it('golden: ObjectCreate, FYA, CharacterChange and the shop frames from the live server', () => {
    const find = (file: string, name: string) => load(file).find(l => l.name === name)!;
    const objectCreate = find('login.jsonl', 'ObjectCreate');
    expect(decodeServerPacket(Buffer.from(objectCreate.hex, 'hex'))).toMatchObject({ id: DS.ObjectCreate, x: 36, y: 25, objIndex: 2398, amount: 1, elementalTags: 0 }); // doors codec
    expect(find('login.jsonl', 'FYA').hex).toBe('6600131300001313');
    expect(find('use-items.jsonl', 'FYA')).toBeDefined();
    expect(decodeServerPacket(Buffer.from(find('npc-shop.jsonl', 'CommerceInit').hex, 'hex'))).toEqual({ id: IS.CommerceInit, npcName: 'Joseph <Mercader>' });
    expect(decodeServerPacket(Buffer.from(find('npc-shop.jsonl', 'ChangeNPCInventorySlot').hex, 'hex'))).toMatchObject({ slot: 1, object: 534, amount: 1000, value: 30 });
    expect(decodeServerPacket(Buffer.from(find('equip-unequip.jsonl', 'CharacterChange').hex, 'hex'))).toMatchObject({ body: 3000 });
    expect(load('npc-shop.jsonl').find(l => l.dir === 's2c' && l.name === 'CommerceEnd')!.hex).toBe('0800');
  });
  it('golden client frames', () => {
    expect(hex(encodeClientPacket({ id: IC.UseItemU, slot: 4, counter: 1 }))).toBe('200104' + '01000000');
    expect(hex(encodeClientPacket({ id: IC.CommerceBuy, slot: 1, amount: 2 }))).toBe('09000102' + '00');
    expect(hex(encodeClientPacket({ id: IC.CommerceEnd }))).toBe('5800');
    expect(hex(encodeClientPacket({ id: IC.Drop, slot: 4, amount: 3, counter: 1, x: 56, y: 42 }))).toBe('5d00040300000001000000382a');
    expect(hex(encodeClientPacket({ id: IC.EquipItem, slot: 15, skin: true, skinType: 39, counter: 2 }))).toBe('05000f0127' + '02000000');
  });
  it('rejects truncated and trailing bytes', () => {
    for (const line of load('npc-shop.jsonl').filter(l => l.dir === 's2c' && serverIds.has(l.id))) {
      const body = Buffer.from(line.hex, 'hex');
      for (let n = 2; n < body.length; n++) expect(() => decodeServerPacket(body.subarray(0, n))).toThrow();
      expect(() => decodeServerPacket(Buffer.concat([body, Buffer.from('00')]))).toThrow();
    }
  });
});
