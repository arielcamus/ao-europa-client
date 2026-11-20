/*
 * TypeScript adaptation, 2026-11-20, of Argentum 20 classic PacketId.bas,
 * Protocol.bas and Protocol_Writes.bas (server and client), PYMMO=0.
 * Copyright (C) 2023-2026 Noland Studios LTD.
 * Based on Argentum Online 0.11.6, Copyright (C) 2002 Márquez Pablo Ignacio,
 * itself based on Baronsoft's VB6 Online RPG (aaron@baronsoft.com).
 * This program is free software under GNU AGPL version 3 or, at your option,
 * any later version. Distributed WITHOUT ANY WARRANTY, including MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE. See ../../../LICENSE.
 */
import { ProtocolError, Reader, Writer } from './binary.js';
import type { SafeArrayInt8 } from './binary.js';
import { encodeFrame } from './frame.js';
import { doorClientCodecs, doorServerCodecs } from './packets/doors.js';
import { npcsServerCodecs } from './packets/npcs.js';
import { chatClientCodecs, chatServerCodecs } from './packets/chat.js';

export enum ServerPacketId {
  Connected = 1,
  Logged = 2,
  RemoveDialogs = 3,
  RemoveCharDialog = 4,
  Disconnect = 7,
  UpdateSta = 25,
  UpdateMana = 26,
  UpdateHP = 27,
  UpdateGold = 28,
  UpdateExp = 29,
  ChangeMap = 30,
  PosUpdate = 31,
  ChatOverHead = 35,
  LocaleChatOverHead = 36,
  ConsoleMsg = 37,
  ConsoleFactionMessage = 38,
  GuildChat = 39,
  CharacterCreate = 42,
  CharacterMove = 44,
  UserCharIndexInServer = 47,
  UpdateUserStats = 61,
  ChangeInventorySlot = 63,
  InventoryUnlockSlots = 64,
  ChangeSpellSlot = 66,
  ErrorMsg = 73,
  UpdateHungerAndThirst = 78,
  ConsoleCharText = 128,
  LocaleMsg = 141,
  Intervals = 158,
  PosUpdateUserChar = 186,
  PosUpdateChar = 187,
  AccountCharacterList = 199,
}

export enum ClientPacketId {
  GroupMessage = 45,
  GuildMessage = 59,
  GuildOnline = 60,
  CouncilMessage = 61,
  FactionMessage = 62,
  LoginExistingChar = 73,
  Talk = 75,
  Yell = 76,
  Whisper = 77,
  Walk = 78,
  RequestPositionUpdate = 79,
  GlobalMessage = 207,
  LoginAccount = 305,
}

export enum Heading { North = 1, East = 2, South = 3, West = 4 }

interface Codec<T> {
  read(reader: Reader): T;
  write(writer: Writer, value: T): void;
}
type Value<C> = C extends Codec<infer T> ? T : never;
type Shape<S> = { [K in keyof S]: Value<S[K]> };

function struct<const S extends Record<string, Codec<unknown>>>(fields: S): Codec<Shape<S>> {
  return {
    read(reader) {
      const value: Record<string, unknown> = {};
      for (const [key, codec] of Object.entries(fields)) value[key] = codec.read(reader);
      return value as Shape<S>;
    },
    write(writer, value) {
      for (const [key, codec] of Object.entries(fields)) codec.write(writer, value[key]);
    },
  };
}

const byte: Codec<number> = { read: r => r.readInt8(), write: (w, v) => { w.writeInt8(v); } };
const int16: Codec<number> = { read: r => r.readInt16(), write: (w, v) => { w.writeInt16(v); } };
const int32: Codec<number> = { read: r => r.readInt32(), write: (w, v) => { w.writeInt32(v); } };
const int: Codec<number> = { read: r => r.readInt(), write: (w, v) => { w.writeInt(v); } };
const real32: Codec<number> = { read: r => r.readReal32(), write: (w, v) => { w.writeReal32(v); } };
const string: Codec<string> = { read: r => r.readString(), write: (w, v) => { w.writeString(v); } };
const bool: Codec<boolean> = { read: r => r.readBool(), write: (w, v) => { w.writeBool(v); } };

function validateHeading(value: number): Heading {
  if (!Number.isInteger(value) || value < Heading.North || value > Heading.West) {
    throw new ProtocolError(`Invalid walk heading ${value}`);
  }
  return value;
}
const heading: Codec<Heading> = {
  read: r => validateHeading(r.readInt8()),
  write: (w, v) => { w.writeInt8(validateHeading(v)); },
};

const debugArray = (): SafeArrayInt8 => ({
  bounds: [{ lowerBound: 1, count: 10 }],
  data: Uint8Array.from({ length: 10 }, (_, index) => index + 1),
});

const connected: Codec<{ debugging: boolean }> = {
  read(reader) {
    if (reader.remaining === 0) return { debugging: false };
    const values = reader.readSafeArrayInt8();
    if (values.bounds.length !== 1 || values.bounds[0]!.lowerBound !== 1 ||
        values.bounds[0]!.count !== 10 || values.data.some((value, index) => value !== index + 1)) {
      throw new ProtocolError('Connected DEBUGGING SAFEARRAY must contain bytes 1..10 at bounds 1..10');
    }
    return { debugging: true };
  },
  write(writer, value) { if (value.debugging) writer.writeSafeArrayInt8(debugArray()); },
};

// Order verified against server WriteAccountCharacterList and client HandleAccountCharacterList.
const accountCharacter = struct({
  id: int, name: string, body: int, head: int, characterClass: int, map: int,
  x: int, y: int, level: int, status: int, helmet: int, shield: int, weapon: int, backpack: int,
});
export type AccountCharacter = Value<typeof accountCharacter>;

const accountList: Codec<{ characters: AccountCharacter[] }> = {
  read(reader) {
    const count = reader.readInt();
    // Each entry needs at least 14 bytes. Never allocate from an unchecked count.
    if (count < 0 || count > Math.floor(reader.remaining / 14)) throw new ProtocolError('Invalid character count');
    return { characters: Array.from({ length: count }, () => accountCharacter.read(reader)) };
  },
  write(writer, value) {
    writer.writeInt(value.characters.length);
    for (const character of value.characters) accountCharacter.write(writer, character);
  },
};

// Every field, including the final clanAlignment byte, is present in both VB6 trees.
const characterCreate = struct({
  charIndex: int16, body: int16, head: int16, heading: byte, x: byte, y: byte,
  weapon: int16, shield: int16, helmet: int16, cart: int16, backpack: int16,
  fx: int16, fxLoops: int16, name: string, status: byte, privileges: byte, particleFx: byte,
  headAura: string, weaponAura: string, bodyAura: string, damageAura: string,
  resistanceAura: string, otherAura: string, shieldAura: string,
  speeding: real32, npc: byte, appear: byte, groupIndex: int16, clanIndex: int16, clanLevel: byte,
  minHp: int32, maxHp: int32, minMana: int32, maxMana: int32,
  symbol: byte, flags: byte, userType: byte, team: byte, flag: byte, npcNumber: int16, clanAlignment: byte,
});
export type CharacterCreate = Value<typeof characterCreate>;

const intervals = struct({
  hit: int32, bow: int32, magic: int32, extractWork: int32, buildWork: int32,
  walk: int32, dropItem: int32, useItemKey: int32, useItemClick: int32,
  hitMagic: int32, magicHit: int32, hitUseItem: int32, hide: int32, talk: int32,
  leftClick: int32, meditate: int32,
});
export type Intervals = Value<typeof intervals>;

// Classic UI subset: paired client Handle* and server Write*/PrepareMessage*
// procedures are recorded in docs/PROTOCOL.md. No gameplay packet guessing.
const userStats = struct({
  maxHp: int16, hp: int16, shield: int32, maxMana: int16, mana: int16,
  maxStamina: int16, stamina: int16, gold: int32, goldPerLevel: int32,
  level: byte, nextLevel: int32, experience: int32, characterClass: byte,
});
const inventorySlot = struct({
  slot: byte, object: int16, amount: int16, equipped: bool, value: real32,
  canUse: byte, elementalTags: int32, bindable: bool,
});
const spellSlot = struct({ slot: byte, spell: int16, index: int16, bindable: bool });
export type UserStats = Value<typeof userStats>;
export type InventorySlot = Value<typeof inventorySlot>;
export type SpellSlot = Value<typeof spellSlot>;
const consoleMessage: Codec<{ message: string; font: number; channel?: number }> = {
  read(reader) {
    const message = reader.readString(), font = reader.readInt8();
    return reader.remaining ? { message, font, channel: reader.readInt8() } : { message, font };
  },
  write(writer, value) {
    writer.writeString(value.message); writer.writeInt8(value.font);
    if (value.channel !== undefined) writer.writeInt8(value.channel);
  },
};

const coreServerCodecs = {
  [ServerPacketId.Connected]: connected,
  [ServerPacketId.Logged]: struct({ newUser: bool }),
  [ServerPacketId.RemoveDialogs]: chatServerCodecs.removeDialogs,
  [ServerPacketId.RemoveCharDialog]: chatServerCodecs.removeCharDialog,
  [ServerPacketId.Disconnect]: struct({ fullLogout: bool }),
  [ServerPacketId.UpdateSta]: struct({ stamina: int16 }),
  [ServerPacketId.UpdateMana]: struct({ mana: int16 }),
  [ServerPacketId.UpdateHP]: struct({ hp: int16, shield: int32 }),
  [ServerPacketId.UpdateGold]: struct({ gold: int32, goldPerLevel: int32 }),
  [ServerPacketId.UpdateExp]: struct({ experience: int32 }),
  [ServerPacketId.ChatOverHead]: chatServerCodecs.chatOverHead,
  [ServerPacketId.LocaleChatOverHead]: chatServerCodecs.localeChatOverHead,
  [ServerPacketId.ConsoleMsg]: consoleMessage,
  [ServerPacketId.ConsoleFactionMessage]: chatServerCodecs.consoleFactionMessage,
  [ServerPacketId.GuildChat]: chatServerCodecs.guildChat,
  [ServerPacketId.UpdateUserStats]: userStats,
  [ServerPacketId.ChangeInventorySlot]: inventorySlot,
  [ServerPacketId.InventoryUnlockSlots]: struct({ rows: byte }),
  [ServerPacketId.ChangeSpellSlot]: spellSlot,
  [ServerPacketId.UpdateHungerAndThirst]: struct({ maxWater: byte, water: byte, maxFood: byte, food: byte }),
  [ServerPacketId.ChangeMap]: struct({ map: int16, resourceMap: int16 }),
  [ServerPacketId.PosUpdate]: struct({ x: byte, y: byte }),
  [ServerPacketId.CharacterCreate]: characterCreate,
  [ServerPacketId.CharacterMove]: struct({ charIndex: int16, x: byte, y: byte }),
  [ServerPacketId.UserCharIndexInServer]: struct({ charIndex: int16 }),
  [ServerPacketId.ErrorMsg]: struct({ message: string }),
  [ServerPacketId.ConsoleCharText]: chatServerCodecs.consoleCharText,
  [ServerPacketId.LocaleMsg]: chatServerCodecs.localeMsg,
  [ServerPacketId.Intervals]: intervals,
  // These two position packets intentionally have DIFFERENT field order.
  [ServerPacketId.PosUpdateUserChar]: struct({ x: byte, y: byte, charIndex: int16 }),
  [ServerPacketId.PosUpdateChar]: struct({ charIndex: int16, x: byte, y: byte }),
  [ServerPacketId.AccountCharacterList]: accountList,
};

const coreClientCodecs = {
  [ClientPacketId.LoginAccount]: struct({ email: string, password: string }),
  [ClientPacketId.LoginExistingChar]: struct({ charId: int32, name: string }),
  [ClientPacketId.GroupMessage]: chatClientCodecs.groupMessage,
  [ClientPacketId.GuildMessage]: chatClientCodecs.guildMessage,
  [ClientPacketId.GuildOnline]: chatClientCodecs.guildOnline,
  [ClientPacketId.CouncilMessage]: chatClientCodecs.councilMessage,
  [ClientPacketId.FactionMessage]: chatClientCodecs.factionMessage,
  [ClientPacketId.Talk]: struct({ message: string, counter: int32 }),
  [ClientPacketId.Yell]: chatClientCodecs.yell,
  [ClientPacketId.Whisper]: chatClientCodecs.whisper,
  [ClientPacketId.GlobalMessage]: chatClientCodecs.globalMessage,
  [ClientPacketId.Walk]: struct({ heading, counter: int32 }),
  [ClientPacketId.RequestPositionUpdate]: struct({}),
};

/**
 * Every codec table, by feature. ONE codec per packet id: an object spread silently keeps the LAST duplicate, so the merged
 * tables below are checked at load time and a second registration of an id throws instead of shadowing the first.
 * A new feature table is added here AND to the spread below (test/codec-tables.test.ts fails if the two disagree).
 */
export const codecTables = {
  server: { core: coreServerCodecs, doors: doorServerCodecs, npcs: npcsServerCodecs },
  client: { core: coreClientCodecs, doors: doorClientCodecs },
} as const;
const serverCodecs = { ...coreServerCodecs, ...doorServerCodecs, ...npcsServerCodecs };
const clientCodecs = { ...coreClientCodecs, ...doorClientCodecs };

/** Throws when two tables register the same id or a merged table holds an id no listed table owns. */
export function assertDisjointCodecTables(tables: Record<string, object>, merged: object, side: string): void {
  const owner = new Map<string, string>();
  for (const [name, table] of Object.entries(tables)) {
    for (const id of Object.keys(table)) {
      const previous = owner.get(id);
      if (previous) throw new Error(`${side} packet id ${id} has two codecs (${previous} and ${name})`);
      owner.set(id, name);
    }
  }
  const extra = Object.keys(merged).filter(id => !owner.has(id));
  if (extra.length) throw new Error(`${side} codecs ${extra.join(', ')} are merged but not listed in codecTables`);
}
assertDisjointCodecTables(codecTables.server, serverCodecs, 'server');
assertDisjointCodecTables(codecTables.client, clientCodecs, 'client');

type Packet<R> = { [K in keyof R]: { id: K } & Value<R[K]> }[keyof R];
export type ServerPacket = Packet<typeof serverCodecs>;
export type ClientPacket = Packet<typeof clientCodecs>;
export interface UnknownPacket { unknown: true; id: number; payload: Uint8Array }

function decode<R extends Record<number, Codec<object>>>(body: Uint8Array, codecs: R): Packet<R> | UnknownPacket {
  const reader = new Reader(body);
  const id = reader.readInt16();
  const codec = codecs[id];
  if (!codec) return { unknown: true, id, payload: reader.readBytes(reader.remaining) };
  try {
    const packet = { id, ...codec.read(reader) };
    reader.end(); // A frame holds exactly ONE packet; never guess a second packet boundary.
    return packet as Packet<R>;
  } catch (error) {
    throw new ProtocolError(`Packet id=${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function encode(id: number, packet: object, codecs: Record<number, Codec<object>>): Uint8Array {
  const codec = codecs[id];
  if (!codec) throw new ProtocolError(`Unsupported packet id=${id}`);
  const writer = new Writer().writeInt16(id);
  codec.write(writer, packet);
  return writer.toBytes();
}

/** Accept a single frame BODY from FrameDecoder, without the length prefix. */
export const decodeServerPacket = (body: Uint8Array): ServerPacket | UnknownPacket => decode(body, serverCodecs);
export const decodeClientPacket = (body: Uint8Array): ClientPacket | UnknownPacket => decode(body, clientCodecs);
/** Encoders return a body; use the *Frame helpers when writing to a socket. */
export const encodeServerPacket = (packet: ServerPacket): Uint8Array => encode(packet.id, packet, serverCodecs);
export const encodeClientPacket = (packet: ClientPacket): Uint8Array => encode(packet.id, packet, clientCodecs);
export const encodeServerFrame = (packet: ServerPacket): Uint8Array => encodeFrame(encodeServerPacket(packet));
export const encodeClientFrame = (packet: ClientPacket): Uint8Array => encodeFrame(encodeClientPacket(packet));
