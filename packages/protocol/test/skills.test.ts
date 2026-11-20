import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  KeysClientPacketId as KC, SkillsClientPacketId as SC, SkillsServerPacketId as SS,
  decodeClientPacket, decodeServerPacket, encodeClientPacket, encodeServerPacket,
} from '../src/index.js';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex.replaceAll(' ', ''), 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
const zeros = (n: number) => Array.from({ length: n }, () => '00').join('');

// Frame bodies written by hand from the VB6 procedures (Protocol_Writes.bas / PrepareMessageMeditateToggle), little endian,
// String8 = varint byte length + UTF-8, independent of the codecs under test.
const twentyFour = (skill: number, value: number) => Array.from({ length: 24 }, (_, i) => (i + 1 === skill ? value : 0));
const server = [
  ['CantUseWhileMeditating', '1800', { id: SS.CantUseWhileMeditating }],
  ['Atributes', '4300 13 13 12 14 12', { id: SS.Atributes, strength: 19, agility: 19, intelligence: 18, constitution: 20, charisma: 18 }],
  ['RestOK', '4800', { id: SS.RestOK }],
  ['MiniStats', '4f00 02000000 03000000 01 2a000000 03 0a000000 05000000 01 07000000 02', {
    id: SS.MiniStats, citizensKilled: 2, criminalsKilled: 3, alignment: 1, npcsKilled: 42, classId: 3, jailMinutes: 10, deaths: 5, gender: 1, fishingPoints: 7, race: 2,
  }],
  ['LevelUp', '5000 0a00', { id: SS.LevelUp, skillPoints: 10 }],
  ['MeditateToggle', '5400 0500 2000 0a 14', { id: SS.MeditateToggle, charIndex: 5, fx: 32, x: 10, y: 20 }],
  ['SendSkills', `5700 ${zeros(23)}64`, { id: SS.SendSkills, skills: twentyFour(24, 100) }],
  ['TrainerCreatureList', '5800 08 4c6f626f 00 4f736f', { id: SS.TrainerCreatureList, creatures: ['Lobo', 'Oso'] }],
  ['TrainerCreatureList (none)', '5800 00', { id: SS.TrainerCreatureList, creatures: [] }],
] as const;
const client = [
  ['ModifySkills', `0700 ${zeros(23)}01`, { id: SC.ModifySkills, points: twentyFour(24, 1) }],
  ['Train', '0800 02', { id: SC.Train, creature: 2 }],
  ['TrainList', '2e00', { id: SC.TrainList }],
  ['Rest', '2f00', { id: SC.Rest }],
  ['RequestStats', '3400', { id: SC.RequestStats }],
  ['RequestAtributes', '5500', { id: SC.RequestAtributes }],
  ['RequestSkills', '5600', { id: SC.RequestSkills }],
  ['RequestMiniStats', '5700', { id: SC.RequestMiniStats }],
] as const;

describe('skills packet codecs (hand-derived VB6 bytes)', () => {
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
  it('uses the PacketId.bas ids and leaves Meditate (48) to the keys codec', () => {
    expect([SS.CantUseWhileMeditating, SS.Atributes, SS.RestOK, SS.MiniStats, SS.LevelUp, SS.MeditateToggle, SS.SendSkills, SS.TrainerCreatureList]).toEqual([24, 67, 72, 79, 80, 84, 87, 88]);
    expect([SC.ModifySkills, SC.Train, SC.TrainList, SC.Rest, SC.RequestStats, SC.RequestAtributes, SC.RequestSkills, SC.RequestMiniStats]).toEqual([7, 8, 46, 47, 52, 85, 86, 87]);
    expect(decodeClientPacket(bytes('3000'))).toEqual({ id: KC.Meditate });
  });
  it('refuses a ModifySkills with the wrong number of skills, and truncated or padded frames, naming the id', () => {
    expect(() => encodeClientPacket({ id: SC.ModifySkills, points: [1, 2, 3] } as never)).toThrow();
    expect(() => decodeClientPacket(bytes('0700 0102'))).toThrow(/id=7/);
    expect(() => decodeServerPacket(bytes('5000 0a'))).toThrow(/id=80/);
    expect(() => decodeServerPacket(bytes('5700 00'))).toThrow(/id=87/);
    expect(() => decodeServerPacket(bytes('4800 00'))).toThrow(/trailing/);
  });
});

// Real sessions recorded against the VB6 server: every recorded skills frame must decode and re-encode to the same bytes.
const fixtureDir = new URL('../../../tests/fixtures/vb6/skills/', import.meta.url);
const recordings = existsSync(fixtureDir) ? readdirSync(fixtureDir).filter(name => name.endsWith('.jsonl')) : [];
describe('VB6 skills recordings', () => {
  it('has at least one recording', () => { expect(recordings.length).toBeGreaterThan(0); });
  for (const file of recordings) {
    it(`${file}: skills frames re-encode byte for byte`, () => {
      const lines = readFileSync(new URL(file, fixtureDir), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { dir: 'c2s' | 's2c'; id: number; hex: string });
      let count = 0;
      for (const line of lines) {
        const body = bytes(line.hex);
        if (line.dir === 's2c') {
          if (![24, 67, 72, 79, 80, 84, 87, 88].includes(line.id)) continue;
          count++; expect(hex(encodeServerPacket(decodeServerPacket(body) as never))).toBe(line.hex);
        } else if ([7, 8, 46, 47, 52, 85, 86, 87].includes(line.id)) {
          count++; expect(hex(encodeClientPacket(decodeClientPacket(body) as never))).toBe(line.hex);
        }
      }
      expect(count).toBeGreaterThan(0);
    });
  }
});
