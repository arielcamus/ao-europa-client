/*
 * Audio and weather packets, adapted 2026-11-20 from the classic Argentum 20 server Protocol_Writes.bas
 * (WritePlayWaveStep, WriteRainToggle, WriteNieveToggle, PrepareMessagePlayMIDI) and the client Protocol.bas
 * (HandlePlayWaveStep, HandleRainToggle, HandleNieveToggle, HandlePlayMIDI).
 * Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; no warranty. See ../../../../LICENSE.
 *
 * PlayWave (55) is NOT here: it belongs to the spells table (packets/spells.ts, one codec per id). Ids are the
 * PacketId.bas enum order.
 */
import type { Reader, Writer } from '../binary.js';

export interface AudioCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }
type Value<C> = C extends AudioCodec<infer T> ? T : never;
type Shape<S> = { [K in keyof S]: Value<S[K]> };
function struct<const S extends Record<string, AudioCodec<unknown>>>(fields: S): AudioCodec<Shape<S>> {
  return {
    read(reader) {
      const value: Record<string, unknown> = {};
      for (const [key, codec] of Object.entries(fields)) value[key] = codec.read(reader);
      return value as Shape<S>;
    },
    write(writer, value) { for (const [key, codec] of Object.entries(fields)) codec.write(writer, value[key]); },
  };
}
const byte: AudioCodec<number> = { read: r => r.readInt8(), write: (w, v) => { w.writeInt8(v); } };
const int16: AudioCodec<number> = { read: r => r.readInt16(), write: (w, v) => { w.writeInt16(v); } };
const int32: AudioCodec<number> = { read: r => r.readInt32(), write: (w, v) => { w.writeInt32(v); } };
const bool: AudioCodec<boolean> = { read: r => r.readBool(), write: (w, v) => { w.writeBool(v); } };

/** Server to client ids of the audio and weather subset. */
export enum AudioServerPacketId {
  PlayMIDI = 54,        // ePlayMIDI: the VB6 client reads the two fields and ignores them (HandlePlayMIDI)
  RainToggle = 59,      // eRainToggle
  NieveToggle = 122,    // eNieveToggle
  PlayWaveStep = 188,   // ePlayWaveStep: footstep of an invisible character
}

export const audioServerCodecs = {
  [AudioServerPacketId.PlayMIDI]: struct({ file: byte, loop: int16 }),
  [AudioServerPacketId.RainToggle]: struct({ raining: bool }),
  [AudioServerPacketId.NieveToggle]: struct({ snowing: bool }),
  // WritePlayWaveStep: charindex, Grh, Grh2, Distance, balance, step.
  [AudioServerPacketId.PlayWaveStep]: struct({ charIndex: int16, grh: int32, grh2: int32, distance: byte, balance: int16, step: bool }),
};
