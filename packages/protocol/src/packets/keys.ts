/*
 * Packets behind the classic game keys (modBindKeys.Accionar, DefaultKey.ini [DEFAULTSMODERN]) that no other feature
 * table has. Layouts from client Protocol_Writes.bas (WriteSafeToggle, WriteParyToggle, WriteWork, WriteMeditate,
 * WriteQuit, WriteLlamadadeClan, WriteMarcaDeClan, WriteUseHKeySlot) and server Protocol.bas Handle*; ids from server
 * PacketId.bas (PYMMO=0). Self-contained like the other feature files. AGPL-3.0-or-later; see ../../../../LICENSE.
 */
import type { Reader, Writer } from '../binary.js';

export const KeysServerPacketId = { SafeModeOn: 20, SafeModeOff: 21 } as const;
export const KeysClientPacketId = {
  Quit: 39, Meditate: 48, SafeToggle: 82, PartySafeToggle: 83, Work: 97, ClanCall: 255, ClanMark: 256, UseHKeySlot: 301,
} as const;
/** client Declares.bas eSkill values the keys send with Work. */
export const WorkSkill = { Steal: 2, Hide: 7, Tame: 24 } as const;

export interface KeysCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }
const empty: KeysCodec<Record<never, never>> = { read: () => ({}), write: () => {} };

export const keysServerCodecs = {
  [KeysServerPacketId.SafeModeOn]: empty,
  [KeysServerPacketId.SafeModeOff]: empty,
} as const;
export const keysClientCodecs = {
  [KeysClientPacketId.Quit]: empty,
  [KeysClientPacketId.Meditate]: empty,
  [KeysClientPacketId.SafeToggle]: empty,
  [KeysClientPacketId.PartySafeToggle]: empty,
  /** WriteWork: skill Int8, then the TS_Work counter (server: verifyTimeStamp on the Hide slot for Ocultarse). */
  [KeysClientPacketId.Work]: {
    read: r => ({ skill: r.readInt8(), counter: r.readInt32() }),
    write: (w, v) => { w.writeInt8(v.skill); w.writeInt32(v.counter); },
  } as KeysCodec<{ skill: number; counter: number }>,
  [KeysClientPacketId.ClanCall]: empty,
  [KeysClientPacketId.ClanMark]: empty,
  [KeysClientPacketId.UseHKeySlot]: {
    read: r => ({ slot: r.readInt8() }), write: (w, v) => { w.writeInt8(v.slot); },
  } as KeysCodec<{ slot: number }>,
} as const;
