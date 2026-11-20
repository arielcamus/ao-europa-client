/*
 * Chat packet codecs, 2026-11-20, from the Argentum 20 classic VB6 client and
 * server (PacketId.bas, Protocol.bas, Protocol_Writes.bas), PYMMO=0.
 * Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; see ../../../../LICENSE.
 *
 * Self-contained on purpose: packets.ts registers these codecs, so this file
 * must not import packets.ts (circular module initialisation).
 */
import type { Reader, Writer } from '../binary.js';

export interface ChatCodec<T> {
  read(reader: Reader): T;
  write(writer: Writer, value: T): void;
}
type Value<C> = C extends ChatCodec<infer T> ? T : never;
type Shape<S> = { [K in keyof S]: Value<S[K]> };
function struct<const S extends Record<string, ChatCodec<unknown>>>(fields: S): ChatCodec<Shape<S>> {
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
const byte: ChatCodec<number> = { read: r => r.readInt8(), write: (w, v) => { w.writeInt8(v); } };
const int16: ChatCodec<number> = { read: r => r.readInt16(), write: (w, v) => { w.writeInt16(v); } };
const int32: ChatCodec<number> = { read: r => r.readInt32(), write: (w, v) => { w.writeInt32(v); } };
const string: ChatCodec<string> = { read: r => r.readString(), write: (w, v) => { w.writeString(v); } };
const bool: ChatCodec<boolean> = { read: r => r.readBool(), write: (w, v) => { w.writeBool(v); } };

/**
 * Wire colours are VB `RGB()` longs: byte 0 = red, byte 1 = green, byte 2 = blue.
 * Client `vbColor_2_Long` + `RGBA_From_Long` (Graficos_Color.bas) undo the swap
 * so drawn text keeps the VB meaning.
 */
export const vbColor = (value: number) => ({ r: value & 255, g: (value >>> 8) & 255, b: (value >>> 16) & 255 });
export const toVbColor = (r: number, g: number, b: number) => (r & 255) | ((g & 255) << 8) | ((b & 255) << 16);

// Server PrepareMessageChatOverHead / client HandleChatOverHead. x/y are only
// sent (non-zero) for the speaker position so an invisible speaker can be placed.
const overHeadTail = { charIndex: int16, color: int32, isSpell: bool, x: byte, y: byte, minTime: int16, maxTime: int16 } as const;

export const chatServerCodecs = {
  /** WriteRemoveAllDialogs / HandleRemoveDialogs: no fields. */
  removeDialogs: struct({}),
  /** PrepareMessageRemoveCharDialog / HandleRemoveCharDialog. */
  removeCharDialog: struct({ charIndex: int16 }),
  /** PrepareMessageChatOverHead / HandleChatOverHead. */
  chatOverHead: struct({ chat: string, ...overHeadTail }),
  /** PrepareLocaleChatOverHead / HandleLocaleChatOverHead: text comes from the locale table. */
  localeChatOverHead: struct({ chatId: int16, params: string, ...overHeadTail }),
  /** PrepareFactionMessageConsole / HandleConsoleFactionMessage. */
  consoleFactionMessage: struct({ message: string, font: byte, label: string }),
  /** PrepareMessageGuildChat / HandleGuildChat (status 10 = guild leader). */
  guildChat: struct({ status: byte, message: string }),
  /** PrepareConsoleCharText / HandleConsoleCharText (whispers). */
  consoleCharText: struct({ message: string, color: int32, sourceName: string, sourceStatus: int16, privileges: int16 }),
  /** PrepareMessageLocaleMsg / HandleLocaleMsg; channel is optional for older senders. */
  localeMsg: {
    read(reader) {
      // Not named `id`: that key is the packet discriminant.
      const messageId = reader.readInt16(), message = reader.readString(), font = reader.readInt8();
      return reader.remaining ? { messageId, message, font, channel: reader.readInt8() } : { messageId, message, font };
    },
    write(writer, value) {
      writer.writeInt16(value.messageId); writer.writeString(value.message); writer.writeInt8(value.font);
      if (value.channel !== undefined) writer.writeInt8(value.channel);
    },
  } satisfies ChatCodec<{ messageId: number; message: string; font: number; channel?: number }>,
} as const;

export const chatClientCodecs = {
  /** WriteGrupoMsg (party chat, /GRUPO). */
  groupMessage: struct({ message: string }),
  /** WriteGuildMessage (/CMSG): text, then its own increasing counter. */
  guildMessage: struct({ message: string, counter: int32 }),
  /** WriteGuildOnline (/ONLINECLAN): no fields. */
  guildOnline: struct({}),
  /** WriteCouncilMessage (/BMSG). */
  councilMessage: struct({ message: string }),
  /** WriteFactionMessage (/FMSG). */
  factionMessage: struct({ message: string }),
  /** WriteYell (a leading "-"): text only, no counter. */
  yell: struct({ message: string }),
  /** WriteWhisper (a leading "\"): target name, then text. */
  whisper: struct({ name: string, message: string }),
  /** WriteGlobalMessage (/GLOBAL). */
  globalMessage: struct({ message: string }),
} as const;
