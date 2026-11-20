import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BodyPart, CombatClientPacketId as CC, CombatServerPacketId as CS, DoorClientPacketId as DC, NpcsServerPacketId as NS, SpellServerPacketId as SS, FrameDecoder,
  decodeClientPacket, decodeServerPacket, encodeClientPacket, encodeServerPacket,
} from '../src/index.js';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex.replaceAll(' ', ''), 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');

// 43, 49 and 141 decode with the npcs codecs and 95 with the doors codec (one codec per id); these hand-made bytes
// cross-check them. Frame bodies written by hand from the VB6 server procedures (Protocol_Writes.bas), little endian,
// String8 = varint byte length + UTF-8. Independent of the codecs under test.
const server = [
  ['CharSwing', '1300 0201 01 00 01', { id: CS.CharSwing, charIndex: 0x0102, showFx: true, showText: false, notifyText: true }],
  ['NPCHitUser', '2000 06 0c00', { id: CS.NPCHitUser, place: BodyPart.Torso, damage: 12 }],
  ['UserHittedByUser', '2100 0300 01 2c01', { id: CS.UserHittedByUser, charIndex: 3, place: BodyPart.Head, damage: 300 }],
  ['UserHittedUser', '2200 0300 04 0500', { id: CS.UserHittedUser, charIndex: 3, place: BodyPart.LeftLeg, damage: 5 }],
  ['CharacterRemove', '2b00 0700 01 00', { id: NS.CharacterRemove, charIndex: 7, vanish: true, warp: false }],
  ['CharacterChange', '3100 0100 01 3d03 0000 03 0000 0000 0000 0000 0000 0000 0000',
    { id: NS.CharacterChange, charIndex: 1, flags: 1, body: 829, head: 0, heading: 3, weapon: 0, shield: 0, helmet: 0, cart: 0, backpack: 0, fx: 0, fxLoops: 0 }],
  ['CreateFX', '3c00 0500 0e00 0000 0a 14', { id: SS.CreateFX, charIndex: 5, fx: 14, loops: 0, x: 10, y: 20 }],
  ['TextOverChar', '7d00 03 313233 0500 0000ff00', { id: CS.TextOverChar, text: '123', charIndex: 5, color: 0x00ff0000 }],
  ['LocaleMsg', '8d00 7e01 01 35 01 05', { id: NS.LocaleMsg, messageId: 382, text: '5', font: 1, channel: 5 }],
  ['ArmaMov', '9100 0900 00', { id: CS.ArmaMov, charIndex: 9, isRanged: 0 }],
  ['CharUpdateHP', '9600 0100 0a000000 14000000 00000000', { id: CS.CharUpdateHP, charIndex: 1, hp: 10, maxHp: 20, shield: 0 }],
  ['CharAtaca', 'b600 2500 0100 ffffffff', { id: CS.CharAtaca, charIndex: 37, victimIndex: 1, damage: -1 }],
] as const;
const client = [
  ['Resucitate', '3100', { id: CC.Resucitate }],
  ['Heal', '3200', { id: CC.Heal }],
  ['Attack', '5000 02000000', { id: CC.Attack, counter: 2 }],
  ['LeftClick', '5f00 3a 2c 07000000', { id: DC.LeftClick, x: 58, y: 44, counter: 7 }],
] as const;

describe('combat packet codecs (hand-derived VB6 bytes)', () => {
  for (const [name, body, packet] of server) {
    it(`S->C ${name} round trips`, () => {
      expect(hex(encodeServerPacket(packet as never))).toBe(body.replaceAll(' ', ''));
      expect(decodeServerPacket(bytes(body))).toEqual(packet);
    });
  }
  for (const [name, body, packet] of client) {
    it(`C->S ${name} round trips`, () => {
      expect(hex(encodeClientPacket(packet as never))).toBe(body.replaceAll(' ', ''));
      expect(decodeClientPacket(bytes(body))).toEqual(packet);
    });
  }
  it('LocaleMsg channel stays optional, matching HandleLocaleMsg GetAvailable()', () => {
    expect(decodeServerPacket(bytes('8d00 7e01 01 35 01'))).toEqual({ id: NS.LocaleMsg, messageId: 382, text: '5', font: 1 });
  });
  it('rejects a truncated combat frame with its id', () => {
    expect(() => decodeServerPacket(bytes('2100 0300 01'))).toThrow(/id=33/);
    expect(() => decodeClientPacket(bytes('5000 0200'))).toThrow(/id=80/);
  });
});

// Real sessions recorded against the VB6 server: every recorded frame must decode and re-encode to the same bytes.
const fixtureDir = new URL('../../../tests/fixtures/vb6/combat/', import.meta.url);
const recordings = existsSync(fixtureDir) ? readdirSync(fixtureDir).filter(name => name.endsWith('.jsonl')) : [];
describe('VB6 combat recordings', () => {
  it('has at least one recording', () => { expect(recordings.length).toBeGreaterThan(0); });
  for (const file of recordings) {
    it(`${file}: frames decode and combat frames re-encode byte for byte`, () => {
      const lines = readFileSync(new URL(file, fixtureDir), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { t_ms: number; dir: 'c2s' | 's2c'; id: number; name: string; hex: string });
      expect(lines.length).toBeGreaterThan(0);
      let combat = 0;
      for (const line of lines) {
        const body = bytes(line.hex);
        const decoder = new FrameDecoder();
        const frame = new Uint8Array([body.length & 255, body.length >> 8, ...body]);
        expect(decoder.push(frame)).toHaveLength(1);
        if (line.dir === 's2c') {
          const packet = decodeServerPacket(body);
          if ('unknown' in packet) continue;
          if (![19, 32, 33, 34, 43, 49, 60, 125, 141, 145, 150, 182].includes(packet.id)) continue;
          combat++;
          expect(hex(encodeServerPacket(packet))).toBe(line.hex);
        } else if ([49, 50, 80, 95].includes(line.id)) {
          combat++;
          expect(hex(encodeClientPacket(decodeClientPacket(body) as never))).toBe(line.hex);
        }
      }
      expect(combat).toBeGreaterThan(0);
    });
  }
});
