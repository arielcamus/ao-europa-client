import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  QuestClientPacketId as QC, QuestServerPacketId as QS, QuestState,
  decodeClientPacket, decodeServerPacket, encodeClientPacket, encodeServerPacket,
} from '../src/index.js';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex.replaceAll(' ', ''), 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');

// Frame bodies written by hand from the VB6 server procedures (Protocol_Writes.bas), little endian, String8 = varint byte length +
// UTF-8. Independent of the codecs under test. Quest 407 "Una nueva aventura": level 1, class 9, kill 15x502 + 10x511, 10x obj 2492.
const details =
  '9900 9701 01 00 01 09 0000 02 0f00 f601 0300 0a00 ff01 0000 01 0a00 bc09 0400 01 0500 0100 00 00 46000000 2c010000 01 0100 a404 01 0700 9701 0100';
const npcList = // WriteNpcQuestListSend: quest 2 (level 6, class 9), one reward object, state 3 (cannot do it)
  '9b00 01 0200 06 0000 01 09 00 00 00 00 00 00 00000000 00000000 01 0100 a404 00 03';
const objQuest = // WriteObjQuestSend: no classes, no limit level, no reward spells
  'ae00 2600 0d 0000 01 6400 2e02 00 00 00 00 88130000 00000000 00 00';

const server = [
  ['QuestDetails', details, {
    id: QS.QuestDetails, questIndex: 407, requiredLevel: 1, limitLevel: 0, requiredClasses: [9], requiredQuest: 0,
    npcs: [{ amount: 15, npcIndex: 502, killed: 3 }, { amount: 10, npcIndex: 511, killed: 0 }],
    objs: [{ amount: 10, objIndex: 2492, have: 4 }], spells: [{ spell: 5, has: 1 }], skillType: 0, skillValue: 0,
    rewardGold: 70, rewardExp: 300, rewardObjs: [{ amount: 1, objIndex: 1188 }], rewardSpells: [7], talkTo: 407, deliverMap: 1,
  }],
  ['QuestListSend', '9a00 02 04 333b3132', { id: QS.QuestListSend, quests: [3, 12] }],
  ['QuestListSend (none)', '9a00 00', { id: QS.QuestListSend, quests: [] }],
  ['NpcQuestListSend', npcList, {
    id: QS.NpcQuestListSend, quests: [{
      questIndex: 2, requiredLevel: 6, requiredQuest: 0, requiredClasses: [9], limitLevel: 0, npcs: [], objs: [], spells: [],
      skillType: 0, skillValue: 0, rewardGold: 0, rewardExp: 0, rewardObjs: [{ amount: 1, objIndex: 1188 }], rewardSpells: [], state: QuestState.Unavailable,
    }],
  }],
  ['UpdateNPCSimbolo', '9c00 0500 03', { id: QS.UpdateNPCSimbolo, charIndex: 5, symbol: 3 }],
  ['ObjQuestListSend', objQuest, {
    id: QS.ObjQuestListSend, questIndex: 38, requiredLevel: 13, requiredQuest: 0, npcs: [{ amount: 100, npcIndex: 558 }], objs: [], spells: [],
    skillType: 0, skillValue: 0, rewardGold: 5000, rewardExp: 0, rewardObjs: [], state: QuestState.Available,
  }],
] as const;
const client = [
  ['Quest', '0201', { id: QC.Quest }],
  ['QuestAccept', '0301 02', { id: QC.QuestAccept, slot: 2 }],
  ['QuestListRequest', '0401', { id: QC.QuestListRequest }],
  ['QuestDetailsRequest', '0501 01', { id: QC.QuestDetailsRequest, slot: 1 }],
  ['QuestAbandon', '0601 03', { id: QC.QuestAbandon, slot: 3 }],
] as const;

describe('quest packet codecs (hand-derived VB6 bytes)', () => {
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
  it('uses the PacketId.bas ids (153 154 155 156 174, 258 259 260 261 262)', () => {
    expect([QS.QuestDetails, QS.QuestListSend, QS.NpcQuestListSend, QS.UpdateNPCSimbolo, QS.ObjQuestListSend]).toEqual([153, 154, 155, 156, 174]);
    expect([QC.Quest, QC.QuestAccept, QC.QuestListRequest, QC.QuestDetailsRequest, QC.QuestAbandon]).toEqual([258, 259, 260, 261, 262]);
  });
  it('rejects a list whose quest numbers do not match its count, and truncated frames, naming the id', () => {
    expect(() => decodeServerPacket(bytes('9a00 03 04 333b3132'))).toThrow(/id=154/);
    expect(() => decodeServerPacket(bytes('9b00 01 0200 06'))).toThrow(/id=155/);
    expect(() => decodeServerPacket(bytes(details.slice(0, 40)))).toThrow(/id=153/);
    expect(() => decodeClientPacket(bytes('0301'))).toThrow(/id=259/);
  });
  it('a quest frame holds exactly one packet', () => {
    expect(() => decodeServerPacket(bytes('9c00 0500 03 00'))).toThrow(/trailing/);
  });
});

// Real sessions recorded against the VB6 server: every recorded quest frame must decode and re-encode to the same bytes.
const fixtureDir = new URL('../../../tests/fixtures/vb6/quests/', import.meta.url);
const recordings = existsSync(fixtureDir) ? readdirSync(fixtureDir).filter(name => name.endsWith('.jsonl')) : [];
describe('VB6 quest recordings', () => {
  it('has at least one recording', () => { expect(recordings.length).toBeGreaterThan(0); });
  for (const file of recordings) {
    it(`${file}: quest frames re-encode byte for byte`, () => {
      const lines = readFileSync(new URL(file, fixtureDir), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { dir: 'c2s' | 's2c'; id: number; hex: string });
      let quest = 0;
      for (const line of lines) {
        const body = bytes(line.hex);
        if (line.dir === 's2c') {
          if (![153, 154, 155, 156, 174].includes(line.id)) continue;
          quest++; expect(hex(encodeServerPacket(decodeServerPacket(body) as never))).toBe(line.hex);
        } else if ([258, 259, 260, 261, 262].includes(line.id)) {
          quest++; expect(hex(encodeClientPacket(decodeClientPacket(body) as never))).toBe(line.hex);
        }
      }
      expect(quest).toBeGreaterThan(0);
    });
  }
});
