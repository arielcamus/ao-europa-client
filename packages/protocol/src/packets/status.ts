/*
 * Combat status packets (wp03): blind, dumb, paralysis, stun, invisibility, safes, bars, traps, animations.
 * Layouts from the classic server Protocol_Writes.bas (the Write and PrepareMessage procedures) and client Protocol.bas Handle*;
 * ids from PacketId.bas (PYMMO=0). Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; no warranty.
 * Self-contained like the other feature files; packets.ts spreads the two tables.
 */
import type { Reader, Writer } from '../binary.js';

export interface StatusCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }
const empty: StatusCodec<Record<never, never>> = { read: () => ({}), write: () => {} };
type Shape<S> = { [K in keyof S]: S[K] extends StatusCodec<infer T> ? T : never };
function struct<const S extends Record<string, StatusCodec<unknown>>>(fields: S): StatusCodec<Shape<S>> {
  return {
    read(reader) {
      const value: Record<string, unknown> = {};
      for (const [key, codec] of Object.entries(fields)) value[key] = codec.read(reader);
      return value as Shape<S>;
    },
    write(writer, value) { for (const [key, codec] of Object.entries(fields)) codec.write(writer, (value as Record<string, unknown>)[key]); },
  };
}
const byte: StatusCodec<number> = { read: r => r.readInt8(), write: (w, v) => { w.writeInt8(v); } };
const int16: StatusCodec<number> = { read: r => r.readInt16(), write: (w, v) => { w.writeInt16(v); } };
const int32: StatusCodec<number> = { read: r => r.readInt32(), write: (w, v) => { w.writeInt32(v); } };
const bool: StatusCodec<boolean> = { read: r => r.readBool(), write: (w, v) => { w.writeBool(v); } };

export const StatusServerPacketId = {
  NPCKillUser: 16, BlockedWithShieldUser: 17, BlockedWithShieldOther: 18, PartySafeOn: 22, PartySafeOff: 23,
  Blind: 74, Dumb: 75, SetInvisible: 83, BlindNoMore: 85, DumbNoMore: 86, ParalizeOK: 97, StunStart: 98,
  UpdateCooldownType: 106, InmovilizadoOK: 139, BarFx: 140, EscudoMov: 146, CharUpdateMAN: 151,
  ClanSeguro: 157, SeguroResu: 162, LegionarySecure: 163, Stopped: 164, DoAnimation: 167, UpdateTrap: 192,
} as const;
export const StatusClientPacketId = { UseSpellMacro: 98, SeguroClan: 263, SeguroResu: 268, LegionarySecure: 269 } as const;
export const statusServerCodecs = {
  [StatusServerPacketId.NPCKillUser]: empty,
  [StatusServerPacketId.BlockedWithShieldUser]: empty,
  [StatusServerPacketId.BlockedWithShieldOther]: empty,
  [StatusServerPacketId.PartySafeOn]: empty,
  [StatusServerPacketId.PartySafeOff]: empty,
  [StatusServerPacketId.Blind]: empty,
  [StatusServerPacketId.Dumb]: empty,
  [StatusServerPacketId.BlindNoMore]: empty,
  [StatusServerPacketId.DumbNoMore]: empty,
  [StatusServerPacketId.ParalizeOK]: empty,
  [StatusServerPacketId.InmovilizadoOK]: empty,
  // PrepareMessageSetInvisible: charIndex, invisible, x, y (x+y = 0 when no position is given)
  [StatusServerPacketId.SetInvisible]: struct({ charIndex: int16, invisible: bool, x: byte, y: byte }),
  [StatusServerPacketId.StunStart]: struct({ duration: int16 }),
  [StatusServerPacketId.UpdateCooldownType]: struct({ cdType: byte }),
  [StatusServerPacketId.BarFx]: struct({ charIndex: int16, barTime: int16, action: byte }),
  [StatusServerPacketId.EscudoMov]: struct({ charIndex: int16 }),
  [StatusServerPacketId.CharUpdateMAN]: struct({ charIndex: int16, mana: int32, maxMana: int32 }),
  [StatusServerPacketId.ClanSeguro]: struct({ enabled: bool }),
  [StatusServerPacketId.SeguroResu]: struct({ enabled: bool }),
  [StatusServerPacketId.LegionarySecure]: struct({ enabled: bool }),
  [StatusServerPacketId.Stopped]: struct({ stopped: bool }),
  [StatusServerPacketId.DoAnimation]: struct({ charIndex: int16, animation: int16 }),
  // PrepareTrapUpdate: state, x, y
  [StatusServerPacketId.UpdateTrap]: struct({ state: byte, x: byte, y: byte }),
};
export const statusClientCodecs = {
  [StatusClientPacketId.UseSpellMacro]: empty,
  [StatusClientPacketId.SeguroClan]: empty,
  [StatusClientPacketId.SeguroResu]: empty,
  [StatusClientPacketId.LegionarySecure]: empty,
};
void int32;
