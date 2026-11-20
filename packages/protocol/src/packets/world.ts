/*
 * World FX / environment packets (time of day, light, weather, area, auras), adapted 2026-11-20 from the classic
 * Argentum 20 server Protocol_Writes.bas (PrepareMessageHora, WriteLight, PrepareMessageLightFXToFloor, PrepareMessageRainToggle,
 * PrepareMessageNevarToggle, PrepareMessageNieblandoToggle, WriteAreaChanged, PrepareMessageAuraToChar, PrepareMessageSpeedingACT)
 * and the client Protocol.bas handlers. The particle and projectile packets (113-116, 191) are the spells codecs.
 * Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; no warranty.
 * See ../../../../LICENSE and ../../../../NOTICE.
 *
 * Own file so the world-fx feature adds only registration lines to the shared packet tables. Types: byte = unsigned VB Int8,
 * i16/i32 fixed signed little endian, real32 = IEEE single, s = String8, bool = byte 0/1.
 */
import { Reader, Writer } from '../binary.js';

/** Server packets owned by this feature; ids are enum order in PacketId.bas. */
export enum WorldServerPacketId {
  AreaChanged = 57,   // WriteAreaChanged / HandleAreaChanged: the new area's reference tile
  PauseToggle = 58,   // WritePauseToggle / HandlePauseToggle (no payload)
  RainToggle = 59,    // PrepareMessageRainToggle / HandleRainToggle
  Hora = 117,         // PrepareMessageHora / HandleHora
  Light = 118,        // WriteLight / HandleLight (the map's base light, read and ignored by the client)
  AuraToChar = 119,   // PrepareMessageAuraToChar / HandleAuraToChar
  SpeedToChar = 120,  // PrepareMessageSpeedingACT / HandleSpeedToChar
  LightToFloor = 121, // PrepareMessageLightFXToFloor / HandleLightToFloor
  NieveToggle = 122,  // PrepareMessageNevarToggle / HandleNieveToggle
  NieblaToggle = 123, // PrepareMessageNieblandoToggle / HandleNieblaToggle
}

/** Client packets owned by this feature (GM weather switches; WriteRainToggle, WriteNieveToggle, WriteNieblaToggle write the bare id). */
export enum WorldClientPacketId {
  RainToggle = 150,
  NieveToggle = 222,
  NieblaToggle = 223,
}

export interface WorldCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }
type Value<C> = C extends WorldCodec<infer T> ? T : never;
type Shape<S> = { [K in keyof S]: Value<S[K]> };
function struct<const S extends Record<string, WorldCodec<unknown>>>(fields: S): WorldCodec<Shape<S>> {
  return {
    read(reader) {
      const value: Record<string, unknown> = {};
      for (const [key, codec] of Object.entries(fields)) value[key] = codec.read(reader);
      return value as Shape<S>;
    },
    write(writer, value) { for (const [key, codec] of Object.entries(fields)) codec.write(writer, value[key]); },
  };
}
const byte: WorldCodec<number> = { read: r => r.readInt8(), write: (w, v) => { w.writeInt8(v); } };
const int16: WorldCodec<number> = { read: r => r.readInt16(), write: (w, v) => { w.writeInt16(v); } };
const int32: WorldCodec<number> = { read: r => r.readInt32(), write: (w, v) => { w.writeInt32(v); } };
const real32: WorldCodec<number> = { read: r => r.readReal32(), write: (w, v) => { w.writeReal32(v); } };
const string: WorldCodec<string> = { read: r => r.readString(), write: (w, v) => { w.writeString(v); } };
const bool: WorldCodec<boolean> = { read: r => r.readBool(), write: (w, v) => { w.writeBool(v); } };

export const worldServerCodecs = {
  [WorldServerPacketId.AreaChanged]: struct({ x: byte, y: byte }),
  [WorldServerPacketId.PauseToggle]: struct({}),
  [WorldServerPacketId.RainToggle]: struct({ raining: bool }),
  /** elapsedMs into the in-game day (0..dayLenMs-1) and the day length in ms, both Int32 (WorldTime_PrepareHora). */
  [WorldServerPacketId.Hora]: struct({ elapsedMs: int32, dayLenMs: int32 }),
  [WorldServerPacketId.Light]: struct({ baseLight: string }),
  /** type: 1 weapon, 2 body, 3 shield, 4 head, 5 other, 6 DM, anything else RM (HandleAuraToChar). */
  [WorldServerPacketId.AuraToChar]: struct({ charIndex: int16, aura: string, remove: bool, type: byte }),
  [WorldServerPacketId.SpeedToChar]: struct({ charIndex: int16, speeding: real32 }),
  /** color is the RGBA Long as stored (B, G, R, A bytes little endian); 0 removes the light. range < 100 square, else round (range - 99). */
  [WorldServerPacketId.LightToFloor]: struct({ x: byte, y: byte, color: int32, range: byte }),
  [WorldServerPacketId.NieveToggle]: struct({ snowing: bool }),
  /** The packet carries only the maximum fog alpha; the client flips bNiebla itself (HandleNieblaToggle). */
  [WorldServerPacketId.NieblaToggle]: struct({ maxAlpha: byte }),
};

export const worldClientCodecs = {
  [WorldClientPacketId.RainToggle]: struct({}),
  [WorldClientPacketId.NieveToggle]: struct({}),
  [WorldClientPacketId.NieblaToggle]: struct({}),
};
