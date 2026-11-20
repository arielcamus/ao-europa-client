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
/**
 * Client LeftClick: tile x, y, then a per-session counter Int32 (WriteLeftClick increments TS_LeftClick; the server runs
 * verifyTimeStamp on it, and a payload without it is logged as an "edited packet"). HandleLeftClick -> HandleWorldAction opens/closes
 * doors and uses world objects. Verified live 2026-11-20: x,y alone is rejected.
 */
export const leftClick: DoorCodec<{ x: number; y: number; counter: number }> = {
  read: r => ({ x: r.readInt8(), y: r.readInt8(), counter: r.readInt32() }),
  write: (w, v) => { w.writeInt8(v.x); w.writeInt8(v.y); w.writeInt32(v.counter); },
};
/** Client DoubleClick: tile x, y. The reference server reads and ignores it ("World interactions are handled on left click"). */
export const doubleClick: DoorCodec<{ x: number; y: number }> = objectDelete;

export const doorServerCodecs = {
  [DoorServerPacketId.ObjectCreate]: objectCreate,
  [DoorServerPacketId.ObjectDelete]: objectDelete,
  [DoorServerPacketId.BlockPosition]: blockPosition,
} as const;
export const doorClientCodecs = {
  [DoorClientPacketId.LeftClick]: leftClick,
  [DoorClientPacketId.DoubleClick]: doubleClick,
} as const;
