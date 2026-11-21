import { describe, expect, it } from 'vitest';
import {
  GROUP_SKILL, codecTables, GuildClientPacketId as GC, GuildServerPacketId as GS, PartyClientPacketId as PC, PartyServerPacketId as PS,
  decodeClientPacket, decodeServerPacket, encodeClientPacket, encodeServerPacket, guildEntryAlignment, guildEntryName, joinList, splitList,
} from '../src/index.js';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex.replaceAll(' ', ''), 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
const idHex = (id: number) => `${(id & 255).toString(16).padStart(2, '0')}${(id >> 8).toString(16).padStart(2, '0')}`;
const NUL = '\u0000';

// Golden bytes written by hand from the VB6 writers (server Protocol_Writes.bas WriteDatosGrupo, PrepareUpdateGroupInfo,
// WritePreguntaBox, WriteGuildList, WriteGuildNews, WriteGuildLeaderInfo, WriteGuildDetails, WriteCharacterInfo, WriteGuildConfig,
// PrepareMessageUbicacionLlamada; client Protocol_Writes.bas Write*): fixed little-endian integers, String8 = varint byte length + UTF-8.
const serverGoldens = [
  { name: 'DatosGrupo, not in a group', hex: '8f 00  00', packet: { id: PS.DatosGrupo, inGroup: false, members: [] } },
  { name: 'DatosGrupo, leader first with the "(Líder)" suffix', hex: '8f 00  01  02  0b 41 6e 61 28 4c c3 ad 64 65 72 29  03 42 6f 62',
    packet: { id: PS.DatosGrupo, inGroup: true, members: ['Ana(Líder)', 'Bob'] } },
  { name: 'UpdateGroupInfo, two members (name, charIndex, head, minHp, maxHp)', hex: 'c1 00  02  03 41 6e 61 34 12 05 00 64 00 c8 00  03 42 6f 62 35 12 06 00 32 00 c8 00',
    packet: { id: PS.UpdateGroupInfo, members: [
      { name: 'Ana', charIndex: 0x1234, head: 5, minHp: 100, maxHp: 200 }, { name: 'Bob', charIndex: 0x1235, head: 6, minHp: 50, maxHp: 200 }] } },
  { name: 'UpdateGroupInfo, not in a group (count 0)', hex: 'c1 00  00', packet: { id: PS.UpdateGroupInfo, members: [] } },
  { name: 'GuildList ("name-alignment" entries, NUL separated)', hex: '38 00  0e 41 6c 70 68 61 2d 31 00 42 65 74 61 2d 30', packet: { id: GS.GuildList, guilds: `Alpha-1${NUL}Beta-0` } },
  { name: 'GuildNews', hex: '59 00  02 48 69  03 41 2d 31  06 4c 65 61 00 42 6f  03  64 00 00 00  f4 01 00 00',
    packet: { id: GS.GuildNews, news: 'Hi', guilds: 'A-1', members: `Lea${NUL}Bo`, level: 3, exp: 100, expNeeded: 500 } },
  { name: 'OfferDetails', hex: '5a 00  02 6f 6b', packet: { id: GS.OfferDetails, details: 'ok' } },
  { name: 'AlianceProposalsList', hex: '5b 00  01 58', packet: { id: GS.AlianceProposalsList, guilds: 'X' } },
  { name: 'PeaceProposalsList', hex: '5c 00  01 58', packet: { id: GS.PeaceProposalsList, guilds: 'X' } },
  { name: 'CharacterInfo (WriteCharacterInfo)', hex: '5d 00  01  03 42 6f 62  02 03 04  e8 03 00 00  d0 07 00 00  01 61  01 47  01 62  01 00  07 00 00 00  09 00 00 00',
    packet: { id: GS.CharacterInfo, gender: 1, name: 'Bob', race: 2, characterClass: 3, level: 4, gold: 1000, bank: 2000, previousPetitions: 'a',
      currentGuild: 'G', previousGuilds: 'b', royalArmy: true, chaosLegion: false, citizensKilled: 7, criminalsKilled: 9 } },
  { name: 'GuildLeaderInfo', hex: '5e 00  03 41 2d 31  06 4c 65 61 00 42 6f  01 4e  03 5a 65 64  02  0a 00 00 00  14 00 00 00',
    packet: { id: GS.GuildLeaderInfo, guilds: 'A-1', members: `Lea${NUL}Bo`, news: 'N', joinRequests: 'Zed', level: 2, exp: 10, expNeeded: 20 } },
  { name: 'GuildDetails', hex: '5f 00  01 47  01 46  01 64  01 4c  0c 00  07 4e 65 75 74 72 61 6c  01 78  05',
    packet: { id: GS.GuildDetails, name: 'G', founder: 'F', creationDate: 'd', leader: 'L', memberCount: 12, alignment: 'Neutral', description: 'x', level: 5 } },
  { name: 'ShowGuildFundationForm', hex: '60 00', packet: { id: GS.ShowGuildFundationForm } },
  { name: 'ShowFundarClanForm', hex: '95 00', packet: { id: GS.ShowFundarClanForm } },
  { name: 'PosLLamadaDeClan (map, x, y)', hex: '98 00  01 00  32  3c', packet: { id: GS.PosLLamadaDeClan, map: 1, x: 50, y: 60 } },
  { name: 'GuildConfig (4 unlock levels, max level, members per level)', hex: 'c9 00  03 05 07 09  02  0a 14',
    packet: { id: GS.GuildConfig, levelCallSupport: 3, levelSeeInvisible: 5, levelSafe: 7, levelShowHpBar: 9, maxLevel: 2, membersByLevel: [10, 20] } },
] as const;

const guildString = (id: number, key: string, text: string) => ({ hex: `${idHex(id)} ${text.length.toString(16).padStart(2, '0')} ${[...text].map(c => c.charCodeAt(0).toString(16)).join(' ')}`, packet: { id, [key]: text } });
const oneName = (id: GC, name: string, key: string) => ({ name, ...guildString(id, key, 'A') });
const clientGoldens = [
  { name: 'InvitarGrupo', hex: 'ea 00', packet: { id: PC.InvitarGrupo } },
  { name: 'RequestGrupo', hex: 'ec 00', packet: { id: PC.RequestGrupo } },
  { name: 'AbandonarGrupo', hex: 'ed 00', packet: { id: PC.AbandonarGrupo } },
  { name: 'HecharDeGrupo (0-based list index)', hex: 'ee 00  02', packet: { id: PC.HecharDeGrupo, index: 2 } },
  { name: 'ActionOnGroupFrame (GroupId)', hex: '2b 01  03', packet: { id: PC.ActionOnGroupFrame, groupId: 3 } },
  { name: 'CreateNewGuild (description, name, alignment)', hex: '03 00  01 64  03 4e 6f 6d  01', packet: { id: GC.CreateNewGuild, description: 'd', name: 'Nom', alignment: 1 } },
  { name: 'ClanCodexUpdate', hex: '0f 00  01 64', packet: { id: GC.ClanCodexUpdate, description: 'd' } },
  oneName(GC.GuildAcceptPeace, 'GuildAcceptPeace', 'guild'), oneName(GC.GuildRejectAlliance, 'GuildRejectAlliance', 'guild'),
  oneName(GC.GuildRejectPeace, 'GuildRejectPeace', 'guild'), oneName(GC.GuildAcceptAlliance, 'GuildAcceptAlliance', 'guild'),
  { name: 'GuildOfferPeace (guild, proposal)', hex: '15 00  01 41  01 70', packet: { id: GC.GuildOfferPeace, guild: 'A', proposal: 'p' } },
  { name: 'GuildOfferAlliance (guild, proposal)', hex: '16 00  01 41  01 70', packet: { id: GC.GuildOfferAlliance, guild: 'A', proposal: 'p' } },
  oneName(GC.GuildAllianceDetails, 'GuildAllianceDetails', 'guild'), oneName(GC.GuildPeaceDetails, 'GuildPeaceDetails', 'guild'),
  oneName(GC.GuildRequestJoinerInfo, 'GuildRequestJoinerInfo', 'userName'),
  { name: 'GuildAlliancePropList', hex: '1a 00', packet: { id: GC.GuildAlliancePropList } },
  { name: 'GuildPeacePropList', hex: '1b 00', packet: { id: GC.GuildPeacePropList } },
  oneName(GC.GuildDeclareWar, 'GuildDeclareWar', 'guild'), oneName(GC.GuildNewWebsite, 'GuildNewWebsite', 'url'),
  oneName(GC.GuildAcceptNewMember, 'GuildAcceptNewMember', 'userName'),
  { name: 'GuildRejectNewMember (name, reason)', hex: '1f 00  01 41  02 6e 6f', packet: { id: GC.GuildRejectNewMember, userName: 'A', reason: 'no' } },
  oneName(GC.GuildKickMember, 'GuildKickMember', 'userName'), oneName(GC.GuildUpdateNews, 'GuildUpdateNews', 'news'),
  oneName(GC.GuildMemberInfo, 'GuildMemberInfo', 'userName'),
  { name: 'GuildOpenElections', hex: '23 00', packet: { id: GC.GuildOpenElections } },
  { name: 'GuildRequestMembership (guild, application)', hex: '24 00  03 4e 6f 6d  02 68 69', packet: { id: GC.GuildRequestMembership, guild: 'Nom', application: 'hi' } },
  { name: 'GuildRequestDetails', hex: '25 00  03 4e 6f 6d', packet: { id: GC.GuildRequestDetails, guild: 'Nom' } },
  { name: 'GuildLeave', hex: '28 00', packet: { id: GC.GuildLeave } },
  oneName(GC.GuildVote, 'GuildVote', 'userName'),
  { name: 'RequestGuildLeaderInfo', hex: '54 00', packet: { id: GC.RequestGuildLeaderInfo } },
  { name: 'QuieroFundarClan', hex: 'fe 00', packet: { id: GC.QuieroFundarClan } },
] as const;

describe('party and guild packet goldens', () => {
  for (const { name, hex: expected, packet } of serverGoldens) {
    it(`server ${name}`, () => {
      expect(hex(encodeServerPacket(packet as never))).toBe(expected.replaceAll(' ', ''));
      expect(decodeServerPacket(bytes(expected))).toEqual(packet);
    });
  }
  for (const { name, hex: expected, packet } of clientGoldens) {
    it(`client ${name}`, () => {
      expect(hex(encodeClientPacket(packet as never))).toBe(expected.replaceAll(' ', ''));
      expect(decodeClientPacket(bytes(expected))).toEqual(packet);
    });
  }
  it('every guild and party id of the wp07 list has a codec', () => {
    const client = [3, 15, ...Array.from({ length: 21 }, (_, i) => 17 + i), 40, 65, 84, 234, 236, 237, 238, 254, 299].filter(id => id !== 38 && id !== 39);
    const server = [56, 89, 90, 91, 92, 93, 94, 95, 96, 143, 149, 152, 193, 201]; // 62 and 142 are the spells / bank-trade tables'
    const clientTable = { ...codecTables.client.guild, ...codecTables.client.party } as Record<number, unknown>;
    const serverTable = { ...codecTables.server.guild, ...codecTables.server.party } as Record<number, unknown>;
    for (const id of client) expect(clientTable[id], `client ${id}`).toBeDefined();
    for (const id of server) expect(serverTable[id], `server ${id}`).toBeDefined();
  });
  it('rejects a group size that does not fit the frame and a trailing byte', () => {
    expect(() => decodeServerPacket(bytes('c1 00  05'))).toThrow();
    expect(() => decodeServerPacket(bytes('60 00  00'))).toThrow();
  });
});

describe('guild list helpers', () => {
  it('splits and joins the NUL separated lists (empty text is an empty list)', () => {
    expect(splitList('')).toEqual([]);
    expect(splitList(`a${NUL}b${NUL}c`)).toEqual(['a', 'b', 'c']);
    expect(joinList(['a', 'b'])).toBe(`a${NUL}b`);
  });
  it('reads "name-alignment" entries like ReadField(n, entry, Asc("-"))', () => {
    expect(guildEntryName('Los Pibes-2')).toBe('Los Pibes');
    expect(guildEntryAlignment('Los Pibes-2')).toBe(2);
    expect(guildEntryAlignment('Los Pibes')).toBe(0);
  });
});
