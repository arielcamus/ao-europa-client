/*
 * Guild (clan) packets, 2026-11-20, from the Argentum 20 classic VB6 client Protocol.bas (HandleGuildList, HandleGuildNews,
 * HandleGuildLeaderInfo, HandleGuildDetails, HandleCharacterInfo ...), client Protocol_Writes.bas (WriteGuild*) and the
 * server Protocol_Writes.bas (WriteGuildList, WriteGuildNews, ...). PYMMO=0.
 * Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; see ../../../../LICENSE.
 *
 * LlamadaDeClan (255) / MarcaDeClanPack (256) are the keys table's (G / V keys): one codec per id.
 * Own file, self-contained (packets.ts spreads `guildServerCodecs` / `guildClientCodecs`). Lists travel as ONE String8 whose
 * entries are separated by NUL (`SEPARATOR = vbNullChar`); `splitList` / `joinList` convert, and the codecs keep the raw
 * text so a packet round-trips byte for byte.
 */
import { Reader, Writer } from '../binary.js';

export enum GuildServerPacketId {
  GuildList = 56,
  GuildNews = 89,
  OfferDetails = 90,
  AlianceProposalsList = 91,
  PeaceProposalsList = 92,
  CharacterInfo = 93,
  GuildLeaderInfo = 94,
  GuildDetails = 95,
  ShowGuildFundationForm = 96,
  ShowFundarClanForm = 149,
  PosLLamadaDeClan = 152,
  GuildConfig = 201,
}

export enum GuildClientPacketId {
  CreateNewGuild = 3,
  ClanCodexUpdate = 15,
  GuildAcceptPeace = 17,
  GuildRejectAlliance = 18,
  GuildRejectPeace = 19,
  GuildAcceptAlliance = 20,
  GuildOfferPeace = 21,
  GuildOfferAlliance = 22,
  GuildAllianceDetails = 23,
  GuildPeaceDetails = 24,
  GuildRequestJoinerInfo = 25,
  GuildAlliancePropList = 26,
  GuildPeacePropList = 27,
  GuildDeclareWar = 28,
  GuildNewWebsite = 29,
  GuildAcceptNewMember = 30,
  GuildRejectNewMember = 31,
  GuildKickMember = 32,
  GuildUpdateNews = 33,
  GuildMemberInfo = 34,
  GuildOpenElections = 35,
  GuildRequestMembership = 36,
  GuildRequestDetails = 37,
  GuildLeave = 40,
  GuildVote = 65,
  RequestGuildLeaderInfo = 84,
  QuieroFundarClan = 254,
}

/** Protocol.bas `SEPARATOR` = `vbNullChar`. */
export const GUILD_LIST_SEPARATOR = '\u0000';
/** Split a server list (empty text is an empty list, like the client's `Len(str) > 0` checks). */
export const splitList = (text: string): string[] => (text === '' ? [] : text.split(GUILD_LIST_SEPARATOR));
export const joinList = (items: readonly string[]): string => items.join(GUILD_LIST_SEPARATOR);
/** ReadField(1, entry, Asc("-")): the guild name of a "name-alignment" list entry. */
export const guildEntryName = (entry: string): string => entry.split('-')[0] ?? '';
/** val(ReadField(2, entry, Asc("-"))): the alignment (eClanType) of a "name-alignment" list entry. */
export const guildEntryAlignment = (entry: string): number => { const n = parseInt(entry.split('-')[1] ?? '', 10); return Number.isFinite(n) ? n : 0; };

export interface GuildCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }
type Shape<S> = { [K in keyof S]: S[K] extends GuildCodec<infer T> ? T : never };
function struct<const S extends Record<string, GuildCodec<unknown>>>(fields: S): GuildCodec<Shape<S>> {
  return {
    read(reader) {
      const value: Record<string, unknown> = {};
      for (const [key, codec] of Object.entries(fields)) value[key] = codec.read(reader);
      return value as Shape<S>;
    },
    write(writer, value) { for (const [key, codec] of Object.entries(fields)) codec.write(writer, (value as Record<string, unknown>)[key]); },
  };
}
const byte: GuildCodec<number> = { read: r => r.readInt8(), write: (w, v) => { w.writeInt8(v); } };
const int16: GuildCodec<number> = { read: r => r.readInt16(), write: (w, v) => { w.writeInt16(v); } };
const int32: GuildCodec<number> = { read: r => r.readInt32(), write: (w, v) => { w.writeInt32(v); } };
const string: GuildCodec<string> = { read: r => r.readString(), write: (w, v) => { w.writeString(v); } };
const bool: GuildCodec<boolean> = { read: r => r.readBool(), write: (w, v) => { w.writeBool(v); } };

/** WriteGuildConfig / HandleGuildConfig: four unlock levels, the max level, then max members for levels 1..max. */
const guildConfig: GuildCodec<{
  levelCallSupport: number; levelSeeInvisible: number; levelSafe: number; levelShowHpBar: number; maxLevel: number; membersByLevel: number[];
}> = {
  read(reader) {
    const levelCallSupport = reader.readInt8(), levelSeeInvisible = reader.readInt8(), levelSafe = reader.readInt8();
    const levelShowHpBar = reader.readInt8(), maxLevel = reader.readInt8();
    return { levelCallSupport, levelSeeInvisible, levelSafe, levelShowHpBar, maxLevel, membersByLevel: Array.from({ length: maxLevel }, () => reader.readInt8()) };
  },
  write(writer, value) {
    writer.writeInt8(value.levelCallSupport); writer.writeInt8(value.levelSeeInvisible); writer.writeInt8(value.levelSafe);
    writer.writeInt8(value.levelShowHpBar); writer.writeInt8(value.maxLevel);
    for (let level = 0; level < value.maxLevel; level++) writer.writeInt8(value.membersByLevel[level] ?? 0);
  },
};

export const guildServerCodecs = {
  /** WriteGuildList: one String8 of "name-alignment" entries. */
  [GuildServerPacketId.GuildList]: struct({ guilds: string }),
  /** WriteGuildNews (what a non-leader member sees): news, guilds (allies/enemies list), members (leader first), level, exp, exp needed. */
  [GuildServerPacketId.GuildNews]: struct({ news: string, guilds: string, members: string, level: byte, exp: int32, expNeeded: int32 }),
  [GuildServerPacketId.OfferDetails]: struct({ details: string }),
  [GuildServerPacketId.AlianceProposalsList]: struct({ guilds: string }),
  [GuildServerPacketId.PeaceProposalsList]: struct({ guilds: string }),
  /** WriteCharacterInfo (frmCharInfo). */
  [GuildServerPacketId.CharacterInfo]: struct({
    gender: byte, name: string, race: byte, characterClass: byte, level: byte, gold: int32, bank: int32,
    previousPetitions: string, currentGuild: string, previousGuilds: string, royalArmy: bool, chaosLegion: bool,
    citizensKilled: int32, criminalsKilled: int32,
  }),
  /** WriteGuildLeaderInfo (frmGuildLeader). */
  [GuildServerPacketId.GuildLeaderInfo]: struct({
    guilds: string, members: string, news: string, joinRequests: string, level: byte, exp: int32, expNeeded: int32,
  }),
  /** WriteGuildDetails (frmGuildBrief). */
  [GuildServerPacketId.GuildDetails]: struct({
    name: string, founder: string, creationDate: string, leader: string, memberCount: int16, alignment: string, description: string, level: byte,
  }),
  [GuildServerPacketId.ShowGuildFundationForm]: struct({}),
  [GuildServerPacketId.ShowFundarClanForm]: struct({}),
  /** PrepareMessageUbicacionLlamada (guild call for help): map, x, y. */
  [GuildServerPacketId.PosLLamadaDeClan]: struct({ map: int16, x: byte, y: byte }),
  [GuildServerPacketId.GuildConfig]: guildConfig,
};

export const guildClientCodecs = {
  /** WriteCreateNewGuild: description, name, alignment (eClanType). */
  [GuildClientPacketId.CreateNewGuild]: struct({ description: string, name: string, alignment: byte }),
  [GuildClientPacketId.ClanCodexUpdate]: struct({ description: string }),
  [GuildClientPacketId.GuildAcceptPeace]: struct({ guild: string }),
  [GuildClientPacketId.GuildRejectAlliance]: struct({ guild: string }),
  [GuildClientPacketId.GuildRejectPeace]: struct({ guild: string }),
  [GuildClientPacketId.GuildAcceptAlliance]: struct({ guild: string }),
  [GuildClientPacketId.GuildOfferPeace]: struct({ guild: string, proposal: string }),
  [GuildClientPacketId.GuildOfferAlliance]: struct({ guild: string, proposal: string }),
  [GuildClientPacketId.GuildAllianceDetails]: struct({ guild: string }),
  [GuildClientPacketId.GuildPeaceDetails]: struct({ guild: string }),
  [GuildClientPacketId.GuildRequestJoinerInfo]: struct({ userName: string }),
  [GuildClientPacketId.GuildAlliancePropList]: struct({}),
  [GuildClientPacketId.GuildPeacePropList]: struct({}),
  [GuildClientPacketId.GuildDeclareWar]: struct({ guild: string }),
  [GuildClientPacketId.GuildNewWebsite]: struct({ url: string }),
  [GuildClientPacketId.GuildAcceptNewMember]: struct({ userName: string }),
  [GuildClientPacketId.GuildRejectNewMember]: struct({ userName: string, reason: string }),
  [GuildClientPacketId.GuildKickMember]: struct({ userName: string }),
  [GuildClientPacketId.GuildUpdateNews]: struct({ news: string }),
  [GuildClientPacketId.GuildMemberInfo]: struct({ userName: string }),
  [GuildClientPacketId.GuildOpenElections]: struct({}),
  /** WriteGuildRequestMembership: guild name, then the application text. */
  [GuildClientPacketId.GuildRequestMembership]: struct({ guild: string, application: string }),
  /** WriteGuildRequestDetails: opens frmGuildBrief. */
  [GuildClientPacketId.GuildRequestDetails]: struct({ guild: string }),
  [GuildClientPacketId.GuildLeave]: struct({}),
  [GuildClientPacketId.GuildVote]: struct({ userName: string }),
  /** WriteRequestGuildLeaderInfo: the answer depends on the player's guild (list / news / leader panel). */
  [GuildClientPacketId.RequestGuildLeaderInfo]: struct({}),
  [GuildClientPacketId.QuieroFundarClan]: struct({}),
};
