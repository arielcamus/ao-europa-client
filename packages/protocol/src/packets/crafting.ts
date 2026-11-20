/*
 * Crafting and work packets, adapted 2026-11-20 from the classic Argentum 20 server
 * Protocol_Writes.bas / Protocol.bas and client Protocol.bas / Protocol_Writes.bas.
 * Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; no warranty.
 * See ../../../../LICENSE and ../../../../NOTICE.
 *
 * Smith, carpenter, alchemy and tailor object lists, the generic crafting window (frmCrafteo),
 * macro toggle, the special-fish fight and the automated extraction action. Ids are enum order in PacketId.bas.
 * Own tiny codec helpers so the file merges next to the other feature files; packets.ts only spreads the two tables below.
 */
import { ProtocolError, Reader, Writer } from '../binary.js';

export interface CraftingCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }
type Value<C> = C extends CraftingCodec<infer T> ? T : never;
type Shape<S> = { [K in keyof S]: Value<S[K]> };
function struct<const S extends Record<string, CraftingCodec<unknown>>>(fields: S): CraftingCodec<Shape<S>> {
  return {
    read(reader) {
      const value: Record<string, unknown> = {};
      for (const [key, codec] of Object.entries(fields)) value[key] = codec.read(reader);
      return value as Shape<S>;
    },
    write(writer, value) { for (const [key, codec] of Object.entries(fields)) codec.write(writer, value[key]); },
  };
}
const byte: CraftingCodec<number> = { read: r => r.readInt8(), write: (w, v) => { w.writeInt8(v); } };
const int16: CraftingCodec<number> = { read: r => r.readInt16(), write: (w, v) => { w.writeInt16(v); } };
const int32: CraftingCodec<number> = { read: r => r.readInt32(), write: (w, v) => { w.writeInt32(v); } };
const bool: CraftingCodec<boolean> = { read: r => r.readBool(), write: (w, v) => { w.writeBool(v); } };

/** A count (Int16 or Byte, as the VB6 writer chose) followed by that many Int16 object numbers. */
function objectList(countCodec: CraftingCodec<number>): CraftingCodec<{ objects: number[] }> {
  return {
    read(reader) {
      const count = countCodec.read(reader);
      if (count < 0 || count * 2 > reader.remaining) throw new ProtocolError('Invalid crafting object count');
      return { objects: Array.from({ length: count }, () => int16.read(reader)) };
    },
    write(writer, value) { countCodec.write(writer, value.objects.length); for (const object of value.objects) int16.write(writer, object); },
  };
}

/** HandleCraftingResult: the percentage and price follow only when the object is not 0. */
const craftingResult: CraftingCodec<{ object: number; percent?: number; price?: number }> = {
  read(reader) {
    const object = int16.read(reader);
    return object === 0 ? { object } : { object, percent: byte.read(reader), price: int32.read(reader) };
  },
  write(writer, value) {
    int16.write(writer, value.object);
    if (value.object !== 0) { byte.write(writer, value.percent ?? 0); int32.write(writer, value.price ?? 0); }
  },
};

/** ServerPacketID values from the VB6 enumeration (eMinPacket = 0). */
export const CraftingServerPacketId = {
  ShowBlacksmithForm: 14,
  ShowCarpenterForm: 15,
  BlacksmithWeapons: 68,
  BlacksmithArmors: 69,
  BlacksmithExtraObjects: 70,
  CarpenterObjects: 71,
  AlquimistaObj: 130,
  ShowAlquimiaForm: 131,
  SastreObj: 132,
  ShowSastreForm: 133,
  MacroTrabajoToggle: 135,
  OpenCrafting: 168,
  CraftingItem: 169,
  CraftingCatalyst: 170,
  CraftingResult: 171,
  PelearConPezEspecial: 176,
} as const;

/** ClientPacketID values from the VB6 enumeration (eMinPacket = 0). None of these carries a sequence counter. */
export const CraftingClientPacketId = {
  CraftCarpenter: 1,
  CraftBlacksmith: 100,
  CraftAlquimista: 228,
  FlagTrabajar: 229,
  CraftSastre: 230,
  CompletarAccion: 233,
  AddItemCrafting: 275,
  RemoveItemCrafting: 276,
  AddCatalyst: 277,
  RemoveCatalyst: 278,
  CraftItem: 279,
  CloseCrafting: 280,
  MoveCraftItem: 281,
  FinalizarPescaEspecial: 286,
  RomperCania: 287,
  RepeatMacro: 289,
  StartAutomatedAction: 308,
} as const;

const empty = struct({});

export const craftingServerCodecs = {
  [CraftingServerPacketId.ShowBlacksmithForm]: empty,
  [CraftingServerPacketId.ShowCarpenterForm]: empty,
  [CraftingServerPacketId.BlacksmithWeapons]: objectList(int16),
  [CraftingServerPacketId.BlacksmithArmors]: objectList(int16),
  [CraftingServerPacketId.BlacksmithExtraObjects]: objectList(int16),
  [CraftingServerPacketId.CarpenterObjects]: objectList(byte),
  [CraftingServerPacketId.AlquimistaObj]: objectList(int16),
  [CraftingServerPacketId.ShowAlquimiaForm]: empty,
  [CraftingServerPacketId.SastreObj]: objectList(int16),
  [CraftingServerPacketId.ShowSastreForm]: empty,
  [CraftingServerPacketId.MacroTrabajoToggle]: struct({ active: bool }),
  [CraftingServerPacketId.OpenCrafting]: struct({ type: byte }),
  [CraftingServerPacketId.CraftingItem]: struct({ slot: byte, object: int16 }),
  [CraftingServerPacketId.CraftingCatalyst]: struct({ object: int16, amount: int16, percent: byte }),
  [CraftingServerPacketId.CraftingResult]: craftingResult,
  [CraftingServerPacketId.PelearConPezEspecial]: empty,
};

export const craftingClientCodecs = {
  [CraftingClientPacketId.CraftCarpenter]: struct({ object: int16, amount: int32 }),
  [CraftingClientPacketId.CraftBlacksmith]: struct({ object: int16 }),
  [CraftingClientPacketId.CraftAlquimista]: struct({ object: int16 }),
  [CraftingClientPacketId.FlagTrabajar]: empty,
  [CraftingClientPacketId.CraftSastre]: struct({ object: int16 }),
  [CraftingClientPacketId.CompletarAccion]: struct({ action: byte }),
  [CraftingClientPacketId.AddItemCrafting]: struct({ inventorySlot: byte, craftSlot: byte }),
  [CraftingClientPacketId.RemoveItemCrafting]: struct({ craftSlot: byte, inventorySlot: byte }),
  [CraftingClientPacketId.AddCatalyst]: struct({ inventorySlot: byte }),
  [CraftingClientPacketId.RemoveCatalyst]: struct({ inventorySlot: byte }),
  [CraftingClientPacketId.CraftItem]: empty,
  [CraftingClientPacketId.CloseCrafting]: empty,
  [CraftingClientPacketId.MoveCraftItem]: struct({ drag: byte, drop: byte }),
  [CraftingClientPacketId.FinalizarPescaEspecial]: empty,
  [CraftingClientPacketId.RomperCania]: empty,
  [CraftingClientPacketId.RepeatMacro]: empty,
  [CraftingClientPacketId.StartAutomatedAction]: struct({ x: byte, y: byte, skill: byte }),
};

/** e_Skill values (server Declares.bas) the work flow uses. */
export const ExtractionSkill = { Talar: 17, Pescar: 18, Mineria: 19, Herreria: 20, Carpinteria: 21, Alquimia: 22, Sastreria: 23, TargetableItem: 25, Smelting: 26 } as const;
