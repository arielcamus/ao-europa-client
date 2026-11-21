/*
 * Key ring, item moving and deleting, and the papyrus form (wp04). Layouts from the classic VB6 client Protocol_Writes.bas
 * (WriteUseKey, WriteItemMove, WriteDeleteItem), Protocol.bas (HandleUpdateUserKey, HandleShowPapiro) and the server's
 * Protocol_Writes.bas (WriteUpdateUserKey, WriteShowPapiro); ids from server PacketId.bas (PYMMO=0).
 * Self-contained like the other feature files. Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; see ../../../../LICENSE.
 */
import type { Reader, Writer } from '../binary.js';

export const KeyringServerPacketId = { ShowPapiro: 105, UpdateUserKey: 159 } as const;
export const KeyringClientPacketId = { UseKey: 209, Moveitem: 225, DeleteItem: 285 } as const;
/** Declares.bas MAX_KEYS: slots of the key ring. */
export const MAX_KEYS = 10;

export interface KeyringCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }

export const keyringServerCodecs = {
  /** HandleShowPapiro reads nothing: it just shows frmMensajePapiro. */
  [KeyringServerPacketId.ShowPapiro]: { read: () => ({}), write: () => {} } as KeyringCodec<Record<never, never>>,
  /** WriteUpdateUserKey: slot and the key object, both Int16 (object 0 clears the slot). */
  [KeyringServerPacketId.UpdateUserKey]: {
    read: r => ({ slot: r.readInt16(), key: r.readInt16() }), write: (w, v) => { w.writeInt16(v.slot); w.writeInt16(v.key); },
  } as KeyringCodec<{ slot: number; key: number }>,
} as const;

export const keyringClientCodecs = {
  /** WriteUseKey: the key ring slot (Int8). */
  [KeyringClientPacketId.UseKey]: {
    read: r => ({ slot: r.readInt8() }), write: (w, v) => { w.writeInt8(v.slot); },
  } as KeyringCodec<{ slot: number }>,
  /** WriteItemMove: the dragged slot, then the slot it was dropped on. */
  [KeyringClientPacketId.Moveitem]: {
    read: r => ({ from: r.readInt8(), to: r.readInt8() }), write: (w, v) => { w.writeInt8(v.from); w.writeInt8(v.to); },
  } as KeyringCodec<{ from: number; to: number }>,
  /** WriteDeleteItem: isSkin first, then the slot (the order differs from the Moveitem style). */
  [KeyringClientPacketId.DeleteItem]: {
    read: r => ({ skin: r.readBool(), slot: r.readInt8() }), write: (w, v) => { w.writeBool(v.skin); w.writeInt8(v.slot); },
  } as KeyringCodec<{ skin: boolean; slot: number }>,
} as const;
