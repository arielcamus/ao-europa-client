import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GuildServerPacketId as GS, ItemsServerPacketId as IS, NpcsServerPacketId as NS, QuestServerPacketId as QS, ServerPacketId as S, SessionServerPacketId as SS,
  decodeServerPacket, encodeServerPacket, getWireProfile, parseWireProfile, setWireProfile, withWireProfile,
} from '../src/index.js';
import type { ServerPacket } from '../src/index.js';
import { serverFixtures } from './fixtures.js';

/*
 * Pre-HOO (server-classic 9ccd7fad, client-classic 619e69d) vs live (HOO-era caac3133) layouts of the eight server->client packets that
 * changed after the pin. Every hex string is written by hand from the VB6 writer of the matching tree (server Protocol_Writes.bas), little
 * endian, String8 = byte length + UTF-8; it does not come from the codecs under test. The 'live' halves are the writers at caac3133.
 * Decoding is version-tolerant, so both layouts must decode under EITHER profile; encoding follows the profile.
 */
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex.replaceAll(' ', ''), 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
const goldens = JSON.parse(readFileSync(new URL('./goldens.json', import.meta.url), 'utf8')) as Record<string, string>;

afterEach(() => setWireProfile('live'));

interface Case { name: string; pinned: string; live: string; pinnedPacket: object; livePacket: object }
const cases: Case[] = [
  { // PrepareMessageConsoleMsg: chat String8, FontIndex Int8, then (post-pin) Channel Int8.
    name: 'ConsoleMsg', pinned: '2500 02 4869 07', live: '2500 02 4869 07 03',
    pinnedPacket: { id: S.ConsoleMsg, message: 'Hi', font: 7 }, livePacket: { id: S.ConsoleMsg, message: 'Hi', font: 7, channel: 3 },
  },
  { // PrepareMessageLocaleMsg: Id Int16, chat String8, FontIndex Int8, then (post-pin) Channel Int8.
    name: 'LocaleMsg', pinned: '8d00 6706 05 5061626c6f 04', live: '8d00 6706 05 5061626c6f 04 05',
    pinnedPacket: { id: NS.LocaleMsg, messageId: 1639, text: 'Pablo', font: 4 }, livePacket: { id: NS.LocaleMsg, messageId: 1639, text: 'Pablo', font: 4, channel: 5 },
  },
  { // PrepareMessageUpdateTagAndStatus: char Int16, status Int8, tag String8, group Int16, then (post-pin) guild Int16 and alignment Int8.
    name: 'UpdateTagAndStatus', pinned: '6500 0400 03 07 416e61203c433e 0600', live: '6500 0400 03 07 416e61203c433e 0600 0900 04',
    pinnedPacket: { id: SS.UpdateTagAndStatus, charIndex: 4, status: 3, tag: 'Ana <C>', groupIndex: 6 },
    livePacket: { id: SS.UpdateTagAndStatus, charIndex: 4, status: 3, tag: 'Ana <C>', groupIndex: 6, clanIndex: 9, clanAlignment: 4 },
  },
  { // WriteFYA: strength Int8, agility Int8, DuracionEfecto Int16, then (post-pin) the two base attributes Int8.
    name: 'FYA', pinned: '6600 14 12 7800', live: '6600 14 12 7800 11 10',
    pinnedPacket: { id: IS.FYA, strength: 20, agility: 18, drugCounter: 120 },
    livePacket: { id: IS.FYA, strength: 20, agility: 18, drugCounter: 120, strengthBase: 17, agilityBase: 16 },
  },
  { // WriteGuildNews: news, guilds, members String8, ClanNivel Int8, then ExpAcu/ExpNe: Int16 pair pinned, Int32 pair post-pin.
    name: 'GuildNews', pinned: '5900 01 6e 01 67 01 6d 03 e803 8813', live: '5900 01 6e 01 67 01 6d 03 e8030000 88130000',
    pinnedPacket: { id: GS.GuildNews, news: 'n', guilds: 'g', members: 'm', level: 3, exp: 1000, expNeeded: 5000 },
    livePacket: { id: GS.GuildNews, news: 'n', guilds: 'g', members: 'm', level: 3, exp: 1000, expNeeded: 5000 },
  },
  { // WriteGuildLeaderInfo: guilds, members, news, joinRequests String8, NivelDeClan Int8, then ExpActual/ExpNecesaria Int16 vs Int32.
    name: 'GuildLeaderInfo', pinned: '5e00 01 67 01 6d 01 6e 01 6a 02 2c01 f401', live: '5e00 01 67 01 6d 01 6e 01 6a 02 2c010000 f4010000',
    pinnedPacket: { id: GS.GuildLeaderInfo, guilds: 'g', members: 'm', news: 'n', joinRequests: 'j', level: 2, exp: 300, expNeeded: 500 },
    livePacket: { id: GS.GuildLeaderInfo, guilds: 'g', members: 'm', news: 'n', joinRequests: 'j', level: 2, exp: 300, expNeeded: 500 },
  },
  { // WriteQuestDetails: ... reward objects (count 0), reward spells (count 0), then (post-pin) TalkTo Int16 and PosMap Int16.
    name: 'QuestDetails', pinned: '9900 0700 05 00 00 0000 00 00 00 00 00 64000000 c8000000 00 00', live: '9900 0700 05 00 00 0000 00 00 00 00 00 64000000 c8000000 00 00 0b00 2c00',
    pinnedPacket: {
      id: QS.QuestDetails, questIndex: 7, requiredLevel: 5, limitLevel: 0, requiredClasses: [], requiredQuest: 0, npcs: [], objs: [], spells: [],
      skillType: 0, skillValue: 0, rewardGold: 100, rewardExp: 200, rewardObjs: [], rewardSpells: [], talkTo: 0, deliverMap: 0,
    },
    livePacket: {
      id: QS.QuestDetails, questIndex: 7, requiredLevel: 5, limitLevel: 0, requiredClasses: [], requiredQuest: 0, npcs: [], objs: [], spells: [],
      skillType: 0, skillValue: 0, rewardGold: 100, rewardExp: 200, rewardObjs: [], rewardSpells: [], talkTo: 11, deliverMap: 44,
    },
  },
];

// CharacterCreate: the oracle golden is the live layout; the pinned PrepareMessageCharacterCreate (9ccd7fad) is the same minus the final ClanAlignment byte.
const liveCharacterCreate = goldens['CharacterCreate']!.slice(4);
cases.push({
  name: 'CharacterCreate', live: liveCharacterCreate, pinned: liveCharacterCreate.slice(0, -2),
  pinnedPacket: { ...serverFixtures.CharacterCreate, clanAlignment: 0 }, livePacket: serverFixtures.CharacterCreate,
});

describe('wire profile switch', () => {
  it('defaults to live and rejects an unknown name', () => {
    expect(getWireProfile()).toBe('live');
    expect(() => parseWireProfile('hoo')).toThrow(/Unknown wire profile/);
    expect(withWireProfile('prehoo', () => getWireProfile())).toBe('prehoo');
    expect(getWireProfile()).toBe('live');
  });
});

describe.each(cases)('$name, pinned (619e69d / 9ccd7fad) vs live (caac3133)', ({ pinned, live, pinnedPacket, livePacket }) => {
  it('encodes the pinned layout under the prehoo profile', () => {
    setWireProfile('prehoo');
    expect(hex(encodeServerPacket(livePacket as ServerPacket))).toBe(pinned.replaceAll(' ', ''));
  });
  it('encodes the live layout under the live profile', () => {
    expect(hex(encodeServerPacket(livePacket as ServerPacket))).toBe(live.replaceAll(' ', ''));
  });
  for (const profile of ['prehoo', 'live'] as const) {
    it(`decodes the pinned bytes under the ${profile} profile`, () => {
      setWireProfile(profile);
      expect(decodeServerPacket(bytes(pinned))).toMatchObject(pinnedPacket);
    });
    it(`decodes the live bytes under the ${profile} profile`, () => {
      setWireProfile(profile);
      expect(decodeServerPacket(bytes(live))).toMatchObject(livePacket);
    });
  }
  it('a pinned frame carries no field the pinned server does not send', () => {
    const decoded = decodeServerPacket(bytes(pinned)) as Record<string, unknown>;
    for (const key of ['channel', 'strengthBase', 'agilityBase']) if (key in decoded) expect(decoded[key]).toBeUndefined();
    if (decoded['id'] === SS.UpdateTagAndStatus) expect(decoded).not.toHaveProperty('clanIndex');
  });
});

describe('guild exp widths', () => {
  it('reads an Int32 exp that cannot fit an Int16 (70000 of 90000) and rejects a 6-byte tail', () => {
    const wide = bytes('5900 01 6e 01 67 01 6d 03 70110100 905f0100');
    expect(decodeServerPacket(wide)).toMatchObject({ exp: 70000, expNeeded: 90000 });
    expect(() => decodeServerPacket(bytes('5900 01 6e 01 67 01 6d 03 e803 8813 00 00'))).toThrow();
  });
});
