/*
 * Pet commands and the travel (Transporter NPC) form, 2026-11-21, from the classic VB6 client Protocol_Writes.bas
 * (WritePetStand/PetFollow/PetLeave/PetFollowAll/PetLeaveAll/CompletarViaje), Protocol.bas HandleViajarForm and the
 * server Protocol_Writes.bas WriteViajarForm + Protocol.bas HandlePet* / HandleCompletarViaje; ids from PacketId.bas (PYMMO=0).
 * Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; no warranty. See ../../../../LICENSE.
 * Own file so parallel feature branches do not conflict; packets.ts only spreads the two tables.
 */
import type { Reader, Writer } from '../binary.js';

export const PetsTravelServerPacketId = { ViajarForm: 147 } as const;
export const PetsTravelClientPacketId = {
  PetStand: 42, PetFollow: 43, PetLeave: 44, CompletarViaje: 252, PetLeaveAll: 282, PetFollowAll: 309,
} as const;

export interface PetsTravelCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }
const empty: PetsTravelCodec<Record<never, never>> = { read: () => ({}), write: () => {} };

/** One row of the form: the server sends `<city>-<price>` and the client splits at the LAST `-` (InStrRev). */
export interface TravelDestination { city: string; cost: number }
export interface ViajarForm { destinations: TravelDestination[]; interface: number }

export const petsTravelServerCodecs = {
  /** WriteViajarForm: count Int8, String8 `<name>-<price>` per destination, then the NPC's Interface Int8 (ViajarInterface). */
  [PetsTravelServerPacketId.ViajarForm]: {
    read: r => {
      const count = r.readInt8(), destinations: TravelDestination[] = [];
      for (let i = 0; i < count; i++) {
        const text = r.readString(), cut = text.lastIndexOf('-');
        destinations.push({ city: cut < 0 ? '' : text.slice(0, cut), cost: Number(text.slice(cut + 1)) });
      }
      return { destinations, interface: r.readInt8() };
    },
    write: (w, v) => {
      w.writeInt8(v.destinations.length);
      for (const d of v.destinations) w.writeString(`${d.city}-${d.cost}`);
      w.writeInt8(v.interface);
    },
  } as PetsTravelCodec<ViajarForm>,
} as const;

export const petsTravelClientCodecs = {
  [PetsTravelClientPacketId.PetStand]: empty,
  [PetsTravelClientPacketId.PetFollow]: empty,
  [PetsTravelClientPacketId.PetLeave]: empty,
  [PetsTravelClientPacketId.PetLeaveAll]: empty,
  [PetsTravelClientPacketId.PetFollowAll]: empty,
  /** WriteCompletarViaje: 1-based destination Byte and the price Int32 (the server reads and ignores it, it recomputes the price). */
  [PetsTravelClientPacketId.CompletarViaje]: {
    read: r => ({ destination: r.readInt8(), cost: r.readInt32() }),
    write: (w, v) => { w.writeInt8(v.destination); w.writeInt32(v.cost); },
  } as PetsTravelCodec<{ destination: number; cost: number }>,
} as const;
