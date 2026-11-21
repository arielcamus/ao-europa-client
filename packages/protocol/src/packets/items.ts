/*
 * Items feature packets: use/equip/drop/pick up, ground objects, gold and NPC
 * commerce. Adapted 2026-11-20 from the classic VB6 PacketId.bas (PYMMO=0),
 * Protocol.bas, Protocol_Writes.bas (client and server writers).
 * Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; no warranty.
 * See ../../../../LICENSE and ../../../../NOTICE.
 *
 * Self-contained on purpose (own tiny codec helpers, numeric packet ids) so the
 * file merges next to other feature files; packets.ts only spreads the two
 * codec tables below.
 */
import { Reader, Writer } from '../binary.js';
import { hooTail, isPreHoo } from '../profile.js';

export interface ItemsCodec<T> {
  read(reader: Reader): T;
  write(writer: Writer, value: T): void;
}
type Value<C> = C extends ItemsCodec<infer T> ? T : never;
type Shape<S> = { [K in keyof S]: Value<S[K]> };

function struct<const S extends Record<string, ItemsCodec<unknown>>>(fields: S): ItemsCodec<Shape<S>> {
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
const byte: ItemsCodec<number> = { read: r => r.readInt8(), write: (w, v) => { w.writeInt8(v); } };
const int16: ItemsCodec<number> = { read: r => r.readInt16(), write: (w, v) => { w.writeInt16(v); } };
const int32: ItemsCodec<number> = { read: r => r.readInt32(), write: (w, v) => { w.writeInt32(v); } };
const real32: ItemsCodec<number> = { read: r => r.readReal32(), write: (w, v) => { w.writeReal32(v); } };
const string: ItemsCodec<string> = { read: r => r.readString(), write: (w, v) => { w.writeString(v); } };
const bool: ItemsCodec<boolean> = { read: r => r.readBool(), write: (w, v) => { w.writeBool(v); } };

/** ServerPacketID values from the VB6 enumeration (eMinPacket = 0). */
export const ItemsServerPacketId = {
  CommerceEnd: 8,
  CommerceInit: 10,
  ChangeNPCInventorySlot: 77,
  FYA: 102,
  UpdateRM: 160,
  UpdateDM: 161,
  ShowPickUpObj: 202,
} as const;

/** ClientPacketID values from the VB6 enumeration (eMinPacket = 0). */
export const ItemsClientPacketId = {
  EquipItem: 5,
  CommerceBuy: 9,
  CommerceSell: 11,
  PickUp: 81,
  CommerceEnd: 88,
  Drop: 93,
  UseItem: 99,
  UseItemU: 288,
} as const;

/** Pseudo inventory slot that means "gold" in Drop (VB6 FLAGORO / GOLD_SLOT). */
export const GOLD_SLOT = 200;

// WriteEquipItem: slot, bSkin, [skin object type when bSkin], counter.
export interface EquipItemPacket { slot: number; skin: boolean; skinType?: number; counter: number }
const equipItem: ItemsCodec<EquipItemPacket> = {
  read(reader) {
    const slot = reader.readInt8(), skin = reader.readBool();
    const skinType = skin ? reader.readInt8() : undefined;
    const counter = reader.readInt32();
    return skinType === undefined ? { slot, skin, counter } : { slot, skin, skinType, counter };
  },
  write(writer, value) {
    writer.writeInt8(value.slot); writer.writeBool(value.skin);
    if (value.skin) writer.writeInt8(value.skinType ?? 0);
    writer.writeInt32(value.counter);
  },
};

export interface Fya { strength: number; agility: number; drugCounter: number; strengthBase?: number; agilityBase?: number }
const fya: ItemsCodec<Fya> = {
  read(reader) {
    const strength = reader.readInt8(), agility = reader.readInt8(), drugCounter = reader.readInt16();
    return hooTail(reader, 2) ? { strength, agility, drugCounter, strengthBase: reader.readInt8(), agilityBase: reader.readInt8() } : { strength, agility, drugCounter };
  },
  write(writer, value) {
    writer.writeInt8(value.strength); writer.writeInt8(value.agility); writer.writeInt16(value.drugCounter);
    if (!isPreHoo()) { writer.writeInt8(value.strengthBase ?? value.strength); writer.writeInt8(value.agilityBase ?? value.agility); }
  },
};

export const itemsServerCodecs = {
  [ItemsServerPacketId.CommerceEnd]: struct({}),
  [ItemsServerPacketId.CommerceInit]: struct({ npcName: string }),
  // ObjectCreate (50) / ObjectDelete (52) are the doors codecs (field objIndex) and CharacterChange (49) the npcs codec.
  // WriteChangeNPCInventorySlot: the shop's slot, priced for this user.
  [ItemsServerPacketId.ChangeNPCInventorySlot]: struct({
    slot: byte, object: int16, amount: int16, value: real32, elementalTags: int32, canUse: byte,
  }),
  // WriteFYA: strength and agility, drug timer, then the un-buffed base values.
  // The two base bytes exist only on the HOO-era server: absent on the pinned one (the client then colours the stats by the fixed 25/35 thresholds).
  [ItemsServerPacketId.FYA]: fya,
  [ItemsServerPacketId.UpdateRM]: struct({ value: int16 }),
  [ItemsServerPacketId.UpdateDM]: struct({ value: int16 }),
  [ItemsServerPacketId.ShowPickUpObj]: struct({ object: int16, amount: int16 }),
};

export const itemsClientCodecs = {
  [ItemsClientPacketId.EquipItem]: equipItem,
  [ItemsClientPacketId.CommerceBuy]: struct({ slot: byte, amount: int16 }),
  [ItemsClientPacketId.CommerceSell]: struct({ slot: byte, amount: int16 }),
  // WritePickUp sends the user's own tile and a destination slot of 0 (first free).
  [ItemsClientPacketId.PickUp]: struct({ x: byte, y: byte, slot: byte }),
  [ItemsClientPacketId.CommerceEnd]: struct({}),
  [ItemsClientPacketId.Drop]: struct({ slot: byte, amount: int32, counter: int32, x: byte, y: byte }),
  // LeftClick (95) is the doors codec; its counter comes from the session's PacketCounters.
  // The second byte is `ActiveInventoryTab = eInventory`.
  [ItemsClientPacketId.UseItem]: struct({ slot: byte, fromInventory: bool, counter: int32 }),
  [ItemsClientPacketId.UseItemU]: struct({ slot: byte, counter: int32 }),
};

export type ItemsServerPacket = { [K in keyof typeof itemsServerCodecs]: { id: K } & Value<(typeof itemsServerCodecs)[K]> }[keyof typeof itemsServerCodecs];
export type ItemsClientPacket = { [K in keyof typeof itemsClientCodecs]: { id: K } & Value<(typeof itemsClientCodecs)[K]> }[keyof typeof itemsClientCodecs];
