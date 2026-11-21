/*
 * Other-character / NPC packets, 2026-11-20, from the classic VB6 client
 * Protocol.bas Handle* and server Protocol_Writes.bas Prepare* procedures.
 * Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; no warranty.
 * See ../../../../LICENSE. Own file so parallel feature branches do not conflict;
 * packets.ts only spreads `npcsServerCodecs` / `npcsClientCodecs` into its tables.
 */
import { Reader, Writer } from '../binary.js';
import { isPreHoo } from '../profile.js';

export enum NpcsServerPacketId {
  RemoveDialogs = 3,
  RemoveCharDialog = 4,
  ChatOverHead = 35,
  LocaleChatOverHead = 36,
  CharacterRemove = 43,
  CharacterChange = 49,
  LocaleMsg = 141,
}
export interface NpcsCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }
const byte: NpcsCodec<number> = { read: r => r.readInt8(), write: (w, v) => { w.writeInt8(v); } };
const int16: NpcsCodec<number> = { read: r => r.readInt16(), write: (w, v) => { w.writeInt16(v); } };
const int32: NpcsCodec<number> = { read: r => r.readInt32(), write: (w, v) => { w.writeInt32(v); } };
const string: NpcsCodec<string> = { read: r => r.readString(), write: (w, v) => { w.writeString(v); } };
const bool: NpcsCodec<boolean> = { read: r => r.readBool(), write: (w, v) => { w.writeBool(v); } };
type Shape<S> = { [K in keyof S]: S[K] extends NpcsCodec<infer T> ? T : never };
function struct<const S extends Record<string, NpcsCodec<unknown>>>(fields: S): NpcsCodec<Shape<S>> {
  return {
    read(reader) {
      const value: Record<string, unknown> = {};
      for (const [key, codec] of Object.entries(fields)) value[key] = codec.read(reader);
      return value as Shape<S>;
    },
    write(writer, value) {
      for (const [key, codec] of Object.entries(fields)) codec.write(writer, (value as Record<string, unknown>)[key]);
    },
  };
}

/** server PrepareMessageChatOverHead / client HandleChatOverHead. x,y are the RECEIVER's position for WriteChatOverHead (the client only uses them for an invisible speaker). */
const overhead = {
  charIndex: int16, color: int32, isSpell: bool, x: byte, y: byte, minChatTime: int16, maxChatTime: int16,
};
const chatOverHead = struct({ chat: string, ...overhead });
/** server PrepareLocaleChatOverHead / client HandleLocaleChatOverHead: message id + `·`-joined params. */
const localeChatOverHead = struct({ chatId: int16, params: string, ...overhead });
/** server PrepareMessageCharacterRemove / client HandleCharacterRemove. */
const characterRemove = struct({ charIndex: int16, vanish: bool, warp: bool });
/** server PrepareMessageCharacterChange / client HandleCharacterChange. flags bit0 idle, bit1 sailing. */
const characterChange = struct({
  charIndex: int16, flags: byte, body: int16, head: int16, heading: byte,
  weapon: int16, shield: int16, helmet: int16, cart: int16, backpack: int16, fx: int16, fxLoops: int16,
});
/** server PrepareMessageLocaleMsg / client HandleLocaleMsg (the channel byte exists only on the HOO-era server: read when present, written on the 'live' profile). `messageId` is the locale id; `id` stays the packet id. */
const localeMsg: NpcsCodec<{ messageId: number; text: string; font: number; channel?: number }> = {
  read(reader) {
    const messageId = reader.readInt16(), text = reader.readString(), font = reader.readInt8();
    return reader.remaining ? { messageId, text, font, channel: reader.readInt8() } : { messageId, text, font };
  },
  write(writer, value) {
    writer.writeInt16(value.messageId); writer.writeString(value.text); writer.writeInt8(value.font);
    if (value.channel !== undefined && !isPreHoo()) writer.writeInt8(value.channel);
  },
};

export const npcsServerCodecs = {
  [NpcsServerPacketId.RemoveDialogs]: struct({}),
  [NpcsServerPacketId.RemoveCharDialog]: struct({ charIndex: int16 }),
  [NpcsServerPacketId.ChatOverHead]: chatOverHead,
  [NpcsServerPacketId.LocaleChatOverHead]: localeChatOverHead,
  [NpcsServerPacketId.CharacterRemove]: characterRemove,
  [NpcsServerPacketId.CharacterChange]: characterChange,
  [NpcsServerPacketId.LocaleMsg]: localeMsg,
};
// LeftClick (95) is the doors codec (packets/doors.ts); its counter comes from the session's PacketCounters.
