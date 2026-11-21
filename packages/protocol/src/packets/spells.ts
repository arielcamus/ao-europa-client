/*
 * Spell / effect packets, adapted 2026-11-20 from the classic Argentum 20 server
 * Protocol.bas / Protocol_Writes.bas and client Protocol.bas / Protocol_Writes.bas.
 * Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; no warranty.
 * See ../../../../LICENSE and ../../../../NOTICE.
 *
 * Kept in its own file so the spells feature does not touch the shared packet
 * tables beyond two spread lines. Types: byte = unsigned VB Int8, i16/i32 fixed
 * signed little endian, s = String8, bool = byte 0/1.
 */
import { Reader, Writer } from '../binary.js';

/** Server packets owned by this feature; ids are enum order in PacketId.bas. */
export enum SpellServerPacketId {
  FxFloor = 51,            // efxpiso: PrepareMessageFxPiso / HandleFxPiso
  PlayWave = 55,           // ePlayWave: PrepareMessagePlayWave / HandlePlayWave
  CreateFX = 60,           // eCreateFX: PrepareMessageCreateFX / HandleCreateFX
  WorkRequestTarget = 62,  // eWorkRequestTarget: WriteWorkRequestTarget / HandleWorkRequestTarget
  ParticleFX = 113,
  ParticleFXToFloor = 114,
  ParticleFXWithDestino = 115,
  ParticleFXWithDestinoXY = 116,
  GetInventarioHechizos = 184, // eGetInventarioHechizos: WriteGetInventarioHechizos / HandleGetInventarioHechizos (a GM follows this player's panel)
  SendSkillCdUpdate = 180, // eSendSkillCdUpdate: WriteSendSkillCdUpdate / HandleSendSkillCdUpdate
  NotifyCasting = 185,     // eNotificarClienteCasteo: WriteNofiticarClienteCasteo
  CreateProjectile = 191,  // eCreateProjectile: PrepareCreateProjectile / HandleCreateProjectile
}

/** Client packets owned by this feature. */
export enum SpellClientPacketId {
  WorkLeftClick = 2,  // WriteWorkLeftClick / HandleWorkLeftClick
  SpellInfo = 4,      // WriteSpellInfo / HandleSpellInfo
  MoveSpell = 14,     // WriteMoveSpell / HandleMoveSpell
  CastSpell = 94,     // WriteCastSpell / HandleCastSpell
  NotifyInventarioHechizos = 293, // WriteNotifyInventarioHechizos: the followed player reports its panel (anti-cheat follow)
}

/** VB6 e_Skill values the spell flow uses (server Declares.bas e_Skill). */
export const MAGIC_SKILL = 1;

export interface Codec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }
type Value<C> = C extends Codec<infer T> ? T : never;
type Shape<S> = { [K in keyof S]: Value<S[K]> };
function struct<const S extends Record<string, Codec<unknown>>>(fields: S): Codec<Shape<S>> {
  return {
    read(reader) {
      const value: Record<string, unknown> = {};
      for (const [key, codec] of Object.entries(fields)) value[key] = codec.read(reader);
      return value as Shape<S>;
    },
    write(writer, value) { for (const [key, codec] of Object.entries(fields)) codec.write(writer, value[key]); },
  };
}
const byte: Codec<number> = { read: r => r.readInt8(), write: (w, v) => { w.writeInt8(v); } };
const int16: Codec<number> = { read: r => r.readInt16(), write: (w, v) => { w.writeInt16(v); } };
const int32: Codec<number> = { read: r => r.readInt32(), write: (w, v) => { w.writeInt32(v); } };
const string: Codec<string> = { read: r => r.readString(), write: (w, v) => { w.writeString(v); } };
const bool: Codec<boolean> = { read: r => r.readBool(), write: (w, v) => { w.writeBool(v); } };

// LocaleMsg (141) is the npcs codec (packets/npcs.ts): one codec per id.

export const spellServerCodecs = {
  [SpellServerPacketId.FxFloor]: struct({ x: byte, y: byte, grh: int16 }),
  [SpellServerPacketId.PlayWave]: struct({ wave: int16, x: byte, y: byte, cancelLast: byte, localize: byte }),
  [SpellServerPacketId.CreateFX]: struct({ charIndex: int16, fx: int16, loops: int16, x: byte, y: byte }),
  [SpellServerPacketId.WorkRequestTarget]: struct({ skill: byte, area: bool, radius: byte }),
  [SpellServerPacketId.ParticleFX]: struct({ charIndex: int16, particle: int16, time: int32, remove: bool, grh: int32, x: byte, y: byte }),
  [SpellServerPacketId.ParticleFXToFloor]: struct({ x: byte, y: byte, particle: int16, time: int32 }),
  [SpellServerPacketId.ParticleFXWithDestino]: struct({
    sender: int16, receiver: int16, travelParticle: int16, finalParticle: int16, time: int32, wave: int16, fx: int16, x: byte, y: byte,
  }),
  [SpellServerPacketId.ParticleFXWithDestinoXY]: struct({
    sender: int16, travelParticle: int16, finalParticle: int16, time: int32, wave: int16, fx: int16, x: byte, y: byte,
  }),
  // value 1 = inventory panel, 2 = spell list with the selected row and the scroll offset.
  [SpellServerPacketId.GetInventarioHechizos]: struct({ value: byte, hechiSel: byte, scrollSel: byte }),
  [SpellServerPacketId.SendSkillCdUpdate]: struct({ typeId: int16, skillId: int32, timeLeft: int32, totalTime: int32, effectType: byte, stacks: int16 }),
  [SpellServerPacketId.NotifyCasting]: struct({ value: byte }),
  [SpellServerPacketId.CreateProjectile]: struct({ startX: byte, startY: byte, targetX: byte, targetY: byte, projectileType: byte }),
};

/** Every client counter is a plain increasing Int32 (`packetCounters.TS_*`), one counter per packet type. */
export const spellClientCodecs = {
  [SpellClientPacketId.WorkLeftClick]: struct({ x: byte, y: byte, skill: byte, counter: int32 }),
  [SpellClientPacketId.SpellInfo]: struct({ slot: byte }),
  [SpellClientPacketId.MoveSpell]: struct({ up: bool, slot: byte }),
  [SpellClientPacketId.CastSpell]: struct({ slot: byte, counter: int32 }),
  [SpellClientPacketId.NotifyInventarioHechizos]: struct({ value: byte, hechiSel: byte, scrollSel: byte }),
};
