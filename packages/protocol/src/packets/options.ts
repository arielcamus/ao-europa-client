/*
 * Options, hotkeys and bank-transfer packets, 2026-11-20, from the classic VB6 PacketId.bas (PYMMO=0), the client
 * Protocol.bas HandleBindKeys / HandleSendClientToggles, Protocol_Writes.bas WriteSetHotkeySlot / WriteTransFerGold and the
 * server Protocol.bas HandleSetHotkeySlot / HandleTransFerGold. UseHKeySlot (301) already lives in keys.ts (one codec per id).
 * Own file so parallel feature branches do not conflict; packets.ts only spreads the two tables below.
 * Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; no warranty. See ../../../../LICENSE.
 */
import type { Reader, Writer } from '../binary.js';

export const OptionsServerPacketId = { BindKeys: 136, SendClientToggles: 195 } as const;
export const OptionsClientPacketId = { TransFerGold: 224, SetHotkeySlot: 300 } as const;
/** client Declares.bas e_HotkeyType. */
export const HotkeyType = { Item: 1, Spell: 2, Unknown: 3 } as const;
/** Server feature toggle that turns the hotkey bar on (SendClientToggles, sent once at login). */
export const HOTKEY_TOGGLE = 'hotokey-enabled';
export const HOTKEY_COUNT = 10;

export interface OptionsCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }

export const optionsServerCodecs = {
  /** HandleBindKeys: ChatCombate Int8, ChatGlobal Int8 (the two toggle icons next to the chat box). */
  [OptionsServerPacketId.BindKeys]: {
    read: r => ({ chatCombat: r.readInt8(), chatGlobal: r.readInt8() }),
    write: (w, v) => { w.writeInt8(v.chatCombat); w.writeInt8(v.chatGlobal); },
  } as OptionsCodec<{ chatCombat: number; chatGlobal: number }>,
  /** HandleSendClientToggles: Int16 count, then one String8 per ACTIVE server feature toggle. */
  [OptionsServerPacketId.SendClientToggles]: {
    read: r => { const count = r.readInt16(), toggles: string[] = []; for (let i = 0; i < count; i++) toggles.push(r.readString()); return { toggles }; },
    write: (w, v) => { w.writeInt16(v.toggles.length); for (const name of v.toggles) w.writeString(name); },
  } as OptionsCodec<{ toggles: string[] }>,
} as const;

export const optionsClientCodecs = {
  /** WriteTransFerGold: Amount Int32, destination String8 (Goliath "Transferir"). */
  [OptionsClientPacketId.TransFerGold]: {
    read: r => ({ amount: r.readInt32(), username: r.readString() }),
    write: (w, v) => { w.writeInt32(v.amount); w.writeString(v.username); },
  } as OptionsCodec<{ amount: number; username: string }>,
  /** WriteSetHotkeySlot: slot Int8, Index Int16 (spell or object number), LastKnownSlot Int16, type Int8 (HotkeyType). */
  [OptionsClientPacketId.SetHotkeySlot]: {
    read: r => ({ slot: r.readInt8(), index: r.readInt16(), lastKnownSlot: r.readInt16(), type: r.readInt8() }),
    write: (w, v) => { w.writeInt8(v.slot); w.writeInt16(v.index); w.writeInt16(v.lastKnownSlot); w.writeInt8(v.type); },
  } as OptionsCodec<{ slot: number; index: number; lastKnownSlot: number; type: number }>,
} as const;
