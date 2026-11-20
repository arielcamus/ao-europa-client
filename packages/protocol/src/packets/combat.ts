/*
 * Combat subset, adapted 2026-11-20 from Argentum 20 classic Protocol_Writes.bas
 * (server) and Protocol.bas (client). Copyright (C) 2023-2026 Noland Studios LTD.
 * AGPL-3.0-or-later; no warranty. See ../../../../LICENSE.
 *
 * Self-contained on purpose: the packet codecs of this feature live in this file
 * and register themselves with two spread lines in ../packets.ts.
 * Ids follow the PacketId.bas enum order (verified against the live VB6 server).
 */
import type { Reader, Writer } from '../binary.js';

export interface CombatCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }
type Value<C> = C extends CombatCodec<infer T> ? T : never;
type Shape<S> = { [K in keyof S]: Value<S[K]> };
function struct<const S extends Record<string, CombatCodec<unknown>>>(fields: S): CombatCodec<Shape<S>> {
  return {
    read(reader) {
      const value: Record<string, unknown> = {};
      for (const [key, codec] of Object.entries(fields)) value[key] = codec.read(reader);
      return value as Shape<S>;
    },
    write(writer, value) { for (const [key, codec] of Object.entries(fields)) codec.write(writer, value[key]); },
  };
}
const byte: CombatCodec<number> = { read: r => r.readInt8(), write: (w, v) => { w.writeInt8(v); } };
const int16: CombatCodec<number> = { read: r => r.readInt16(), write: (w, v) => { w.writeInt16(v); } };
const int32: CombatCodec<number> = { read: r => r.readInt32(), write: (w, v) => { w.writeInt32(v); } };
const string: CombatCodec<string> = { read: r => r.readString(), write: (w, v) => { w.writeString(v); } };
const bool: CombatCodec<boolean> = { read: r => r.readBool(), write: (w, v) => { w.writeBool(v); } };

/** Server to client ids of the combat subset (server PacketId.bas, e-prefix dropped). */
export enum CombatServerPacketId {
  CharSwing = 19,
  NPCHitUser = 32,
  UserHittedByUser = 33,
  UserHittedUser = 34,
  CreateFX = 60,
  TextOverChar = 125,
  ArmaMov = 145,
  CharUpdateHP = 150,
  CharAtaca = 182,
}
/** Client to server ids of the combat subset. */
export enum CombatClientPacketId {
  Resucitate = 49,
  Heal = 50,
  Attack = 80,
}
/** e_PartesCuerpo, client Declares.bas. */
export enum BodyPart { Head = 1, LeftArm = 2, RightArm = 3, LeftLeg = 4, RightLeg = 5, Torso = 6 }

const hit = struct({ charIndex: int16, place: byte, damage: int16 });

export const combatServerCodecs = {
  // PrepareMessageCharSwing: the attacker's swing (a miss when showText) or a blocked swing.
  [CombatServerPacketId.CharSwing]: struct({ charIndex: int16, showFx: bool, showText: bool, notifyText: bool }),
  // WriteNPCHitUser: a creature hit me on a body part.
  [CombatServerPacketId.NPCHitUser]: struct({ place: byte, damage: int16 }),
  // WriteUserHittedByUser (a player hit me) / WriteUserHittedUser (I hit a player).
  [CombatServerPacketId.UserHittedByUser]: hit,
  [CombatServerPacketId.UserHittedUser]: hit,
  // CharacterRemove (43), CharacterChange (49) and LocaleMsg (141) are the npcs codecs; LeftClick (95) is the doors codec.
  [CombatServerPacketId.CreateFX]: struct({ charIndex: int16, fx: int16, loops: int16, x: byte, y: byte }),
  [CombatServerPacketId.TextOverChar]: struct({ text: string, charIndex: int16, color: int32 }),
  [CombatServerPacketId.ArmaMov]: struct({ charIndex: int16, isRanged: byte }),
  [CombatServerPacketId.CharUpdateHP]: struct({ charIndex: int16, hp: int32, maxHp: int32, shield: int32 }),
  [CombatServerPacketId.CharAtaca]: struct({ charIndex: int16, victimIndex: int16, damage: int32 }),
};

export const combatClientCodecs = {
  [CombatClientPacketId.Resucitate]: struct({}),
  [CombatClientPacketId.Heal]: struct({}),
  [CombatClientPacketId.Attack]: struct({ counter: int32 }),
};
