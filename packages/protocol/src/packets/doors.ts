/*
 * Doors, ground objects and tile blocking. Layouts verified 2026-11-20 against the live VB6 server
 * (Protocol_Writes.bas PrepareMessageObjectCreate/ObjectDelete, WriteBlockPosition) and the client
 * handlers (Protocol.bas HandleObjectCreate/HandleObjectDelete/HandleBlockPosition, Write{Left,Double}Click).
 * Self-contained on purpose: depends only on binary.ts so other feature files cannot form an import cycle.
 * AGPL-3.0-or-later; see ../../../../LICENSE.
 */
import type { Reader, Writer } from '../binary.js';

export const DoorServerPacketId = { ObjectCreate: 50, ObjectDelete: 52, BlockPosition: 53 } as const;
export const DoorClientPacketId = { LeftClick: 95, DoubleClick: 96 } as const;

export interface DoorCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }

/** x, y (VB6 Byte), ObjIndex Int16, Amount Int16, ElementalTags Int32. */
export const objectCreate: DoorCodec<{ x: number; y: number; objIndex: number; amount: number; elementalTags: number }> = {
  read: r => ({ x: r.readInt8(), y: r.readInt8(), objIndex: r.readInt16(), amount: r.readInt16(), elementalTags: r.readInt32() }),
  write: (w, v) => { w.writeInt8(v.x); w.writeInt8(v.y); w.writeInt16(v.objIndex); w.writeInt16(v.amount); w.writeInt32(v.elementalTags); },
};
/** x, y. Removes the ground object on that tile. */
export const objectDelete: DoorCodec<{ x: number; y: number }> = {
  read: r => ({ x: r.readInt8(), y: r.readInt8() }),
  write: (w, v) => { w.writeInt8(v.x); w.writeInt8(v.y); },
};
/** x, y, sides. Client: Blocked = (Blocked And Not ALL_SIDES) Or sides. Closed doors send 1/6/12 around the door tile. */
export const blockPosition: DoorCodec<{ x: number; y: number; sides: number }> = {
  read: r => ({ x: r.readInt8(), y: r.readInt8(), sides: r.readInt8() }),
  write: (w, v) => { w.writeInt8(v.x); w.writeInt8(v.y); w.writeInt8(v.sides); },
};
/** Client LeftClick / DoubleClick: tile x, y. A door is opened or closed with DoubleClick. */
export const tileClick: DoorCodec<{ x: number; y: number }> = objectDelete;

export const doorServerCodecs = {
  [DoorServerPacketId.ObjectCreate]: objectCreate,
  [DoorServerPacketId.ObjectDelete]: objectDelete,
  [DoorServerPacketId.BlockPosition]: blockPosition,
} as const;
export const doorClientCodecs = {
  [DoorClientPacketId.LeftClick]: tileClick,
  [DoorClientPacketId.DoubleClick]: tileClick,
} as const;
