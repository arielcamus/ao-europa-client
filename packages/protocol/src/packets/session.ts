/*
 * Core session packets (wp01), 2026-11-21, from the classic VB6 client Protocol.bas Handle* / Protocol_Writes.bas Write* and the
 * server Protocol_Writes.bas Write* / Prepare*; ids from PacketId.bas (PYMMO=0). Account creation, character creation, message boxes,
 * logout/disconnect, the movement-mode toggles, floating text and the few character value updates.
 * Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; no warranty. See ../../../../LICENSE.
 * Own file so parallel feature branches do not conflict; packets.ts only spreads the two tables.
 */
import type { Reader, Writer } from '../binary.js';
import { hooTail, isPreHoo } from '../profile.js';

export const SessionServerPacketId = {
  NavigateToggle: 5, EquiteToggle: 6, ShowMessageBox: 40, MostrarCuenta: 41, CharacterTranslate: 45, UserIndexInServer: 46,
  ForceCharMove: 48, ShowSignal: 76, UpdateTagAndStatus: 101, CerrarleCliente: 103, Contadores: 104, TextOverTile: 126,
  TextCharDrop: 127, FlashScreen: 129, VelocidadToggle: 134, ShowFrmLogear: 137, NadarToggle: 148,
  AnswerReset: 173, UpdateFlag: 181, UpdateCharValue: 194,
} as const;
export const SessionClientPacketId = {
  ChangeHeading: 6, Help: 51, RequestMOTD: 57, LoginNewChar: 74, NavigateToggle: 183, Home: 264,
  CreateAccount: 304, DeleteCharacter: 306, CancelarExit: 247,
} as const;

export interface SessionCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }
const empty: SessionCodec<Record<never, never>> = { read: () => ({}), write: () => {} };
const codec = <T>(read: (r: Reader) => T, write: (w: Writer, v: T) => void): SessionCodec<T> => ({ read, write });

/** e_CharValue (Declares.bas, server and client alike: eDontBlockTile = 1); the only value the VB6 client handles. */
export const CharValueType = { DontBlockTile: 1 } as const;

export const sessionServerCodecs = {
  /** WriteNavigateToggle: HandleNavigateToggle `UserNavegando = ReadBool`. */
  [SessionServerPacketId.NavigateToggle]: codec(r => ({ sailing: r.readBool() }), (w, v) => { w.writeBool(v.sailing); }),
  /** WriteEquiteToggle: no payload; HandleEquiteToggle flips `UserMontado`. */
  [SessionServerPacketId.EquiteToggle]: empty,
  /** WriteShowMessageBox / PrepareShowMessageBox: Int16 message id (Locale_Parse_ServerMessage) and a String8 of dynamic values. */
  [SessionServerPacketId.ShowMessageBox]: codec(r => ({ messageId: r.readInt16(), extra: r.readString() }), (w, v) => { w.writeInt16(v.messageId); w.writeString(v.extra); }),
  /** WriteMostrarCuenta: no payload; the client returns to the account screen. */
  [SessionServerPacketId.MostrarCuenta]: empty,
  /** PrepareCharacterTranslate: char Int16, tile Int8 x2, Int32 time in ms (HandleCharacterTranslate). */
  [SessionServerPacketId.CharacterTranslate]: codec(
    r => ({ charIndex: r.readInt16(), x: r.readInt8(), y: r.readInt8(), time: r.readInt32() }),
    (w, v) => { w.writeInt16(v.charIndex); w.writeInt8(v.x); w.writeInt8(v.y); w.writeInt32(v.time); }),
  /** WriteUserIndexInServer: the player's server user slot (HandleUserIndexInServer `userIndex`). */
  [SessionServerPacketId.UserIndexInServer]: codec(r => ({ userIndex: r.readInt16() }), (w, v) => { w.writeInt16(v.userIndex); }),
  /** PrepareMessageForceCharMove: a heading Int8 (HandleForceCharMove). */
  [SessionServerPacketId.ForceCharMove]: codec(r => ({ heading: r.readInt8() }), (w, v) => { w.writeInt8(v.heading); }),
  /** WriteShowSignal: object index Int16 (its Texto) and the secondary Grh Int16 (HandleShowSignal -> InitCartel). */
  [SessionServerPacketId.ShowSignal]: codec(r => ({ objIndex: r.readInt16(), grh: r.readInt16() }), (w, v) => { w.writeInt16(v.objIndex); w.writeInt16(v.grh); }),
  /**
   * PrepareMessageUpdateTagAndStatus: char Int16, status Int8, "Name <clan>" String8, group Int16, then (HOO-era server only) guild Int16 and
   * alignment Int8. The pinned server stops after the group, so the two clan fields are absent and the client leaves the char's clan data alone.
   */
  [SessionServerPacketId.UpdateTagAndStatus]: codec<{ charIndex: number; status: number; tag: string; groupIndex: number; clanIndex?: number; clanAlignment?: number }>(
    r => {
      const head = { charIndex: r.readInt16(), status: r.readInt8(), tag: r.readString(), groupIndex: r.readInt16() };
      return hooTail(r, 3) ? { ...head, clanIndex: r.readInt16(), clanAlignment: r.readInt8() } : head;
    },
    (w, v) => {
      w.writeInt16(v.charIndex); w.writeInt8(v.status); w.writeString(v.tag); w.writeInt16(v.groupIndex);
      if (!isPreHoo()) { w.writeInt16(v.clanIndex ?? 0); w.writeInt8(v.clanAlignment ?? 0); }
    }),
  /** WriteCerrarleCliente: no payload; HandleCerrarleCliente runs CloseClient. */
  [SessionServerPacketId.CerrarleCliente]: empty,
  /** WriteContadores: invisibility seconds and potion-effect seconds, both Int16 (InviCounter, DrogaCounter). */
  [SessionServerPacketId.Contadores]: codec(r => ({ invisibility: r.readInt16(), effect: r.readInt16() }), (w, v) => { w.writeInt16(v.invisibility); w.writeInt16(v.effect); }),
  /** PrepareMessageTextOverTile: text, x Int16, y Int16, colour Int32 (vbColor), duration Int16, offsetY Int16, animated Bool. */
  [SessionServerPacketId.TextOverTile]: codec(
    r => ({ text: r.readString(), x: r.readInt16(), y: r.readInt16(), color: r.readInt32(), duration: r.readInt16(), offsetY: r.readInt16(), animated: r.readBool() }),
    (w, v) => { w.writeString(v.text); w.writeInt16(v.x); w.writeInt16(v.y); w.writeInt32(v.color); w.writeInt16(v.duration); w.writeInt16(v.offsetY); w.writeBool(v.animated); }),
  /** PrepareMessageTextCharDrop: text, char Int16, colour Int32, duration Int16, animated Bool. */
  [SessionServerPacketId.TextCharDrop]: codec(
    r => ({ text: r.readString(), charIndex: r.readInt16(), color: r.readInt32(), duration: r.readInt16(), animated: r.readBool() }),
    (w, v) => { w.writeString(v.text); w.writeInt16(v.charIndex); w.writeInt32(v.color); w.writeInt16(v.duration); w.writeBool(v.animated); }),
  /** WriteFlashScreen / PrepareMessageFlashScreen: colour Int32 (BGR, vbColor), duration Int32 in ms, ignore-fog Bool. */
  [SessionServerPacketId.FlashScreen]: codec(
    r => ({ color: r.readInt32(), duration: r.readInt32(), ignore: r.readBool() }),
    (w, v) => { w.writeInt32(v.color); w.writeInt32(v.duration); w.writeBool(v.ignore); }),
  /** WriteVelocidadToggle: the character's Speeding as Real32. */
  [SessionServerPacketId.VelocidadToggle]: codec(r => ({ speeding: r.readReal32() }), (w, v) => { w.writeReal32(v.speeding); }),
  /** WriteShowFrmLogear: no payload; FrmLogear is shown over frmConnect. */
  [SessionServerPacketId.ShowFrmLogear]: empty,
  /** WriteNadarToggle: can swim Bool, wearing a rubber suit Bool. */
  [SessionServerPacketId.NadarToggle]: codec(r => ({ swimming: r.readBool(), rubberSuit: r.readBool() }), (w, v) => { w.writeBool(v.swimming); w.writeBool(v.rubberSuit); }),
  /** WriteAnswerReset: no payload; the client asks "reset character?" and answers with ResetearPersonaje. */
  [SessionServerPacketId.AnswerReset]: empty,
  /** PrepareMessageUpdateFlag: char Int16, flag (banderaIndex) Int8. */
  [SessionServerPacketId.UpdateFlag]: codec(r => ({ charIndex: r.readInt16(), flag: r.readInt8() }), (w, v) => { w.writeInt16(v.charIndex); w.writeInt8(v.flag); }),
  /** PrepareUpdateCharValue: char Int16, e_CharValue Int16, value Int32. */
  [SessionServerPacketId.UpdateCharValue]: codec(
    r => ({ charIndex: r.readInt16(), valueType: r.readInt16(), value: r.readInt32() }),
    (w, v) => { w.writeInt16(v.charIndex); w.writeInt16(v.valueType); w.writeInt32(v.value); }),
} as const;

export const sessionClientCodecs = {
  /** WriteChangeHeading: heading Int8 then the sequence counter Int32 (TS_ChangeHeading, the session's `changeHeading` family). */
  [SessionClientPacketId.ChangeHeading]: codec(r => ({ heading: r.readInt8(), counter: r.readInt32() }), (w, v) => { w.writeInt8(v.heading); w.writeInt32(v.counter); }),
  [SessionClientPacketId.Help]: empty,
  [SessionClientPacketId.RequestMOTD]: empty,
  /**
   * WriteLoginNewChar (PYMMO=0): String8 name, then race, gender, class, head and home city, each a WriteInt varint.
   * The server (HandleLoginNewChar) reads them in this order and enters the new character directly.
   */
  [SessionClientPacketId.LoginNewChar]: codec(
    r => ({ name: r.readString(), race: r.readInt(), gender: r.readInt(), characterClass: r.readInt(), head: r.readInt(), home: r.readInt() }),
    (w, v) => { w.writeString(v.name); w.writeInt(v.race); w.writeInt(v.gender); w.writeInt(v.characterClass); w.writeInt(v.head); w.writeInt(v.home); }),
  [SessionClientPacketId.NavigateToggle]: empty,
  [SessionClientPacketId.Home]: empty,
  /** WriteCancelarExit: no payload (UserSaliendo = False on the client); the server's CancelExit answers LocaleMsg 578 "/salir cancelado". */
  [SessionClientPacketId.CancelarExit]: empty,
  /** WriteCreateAccount (PYMMO=0): String8 email then String8 password; the server answers with an (empty) AccountCharacterList. */
  [SessionClientPacketId.CreateAccount]: codec(r => ({ email: r.readString(), password: r.readString() }), (w, v) => { w.writeString(v.email); w.writeString(v.password); }),
  /** WriteDeleteCharacter is an empty body in PYMMO=0 on the client AND the server (HandleDeleteCharacter does nothing). */
  [SessionClientPacketId.DeleteCharacter]: empty,
} as const;
