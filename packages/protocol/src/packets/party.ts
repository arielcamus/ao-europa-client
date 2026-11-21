/*
 * Party (group) packets, 2026-11-20, from the Argentum 20 classic VB6 client Protocol.bas / Protocol_Writes.bas
 * (HandleDatosGrupo, HandleUpdateGroupInfo, HandleShowPregunta, WriteInvitarGrupo ...) and the server
 * Protocol_Writes.bas (WriteDatosGrupo, PrepareUpdateGroupInfo, WritePreguntaBox). PYMMO=0.
 * Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; see ../../../../LICENSE.
 *
 * WorkRequestTarget (62) / WorkLeftClick (2) belong to the spells table and ShowPregunta (142) / ResponderPregunta (235) to bank-trade: one codec per id.
 * Own file, self-contained (packets.ts spreads `partyServerCodecs` / `partyClientCodecs`).
 */
import { Reader, Writer } from '../binary.js';

export enum PartyServerPacketId {
  /** eDatosGrupo: the FrmGrupo member list. */
  DatosGrupo = 143,
  /** eUpdateGroupInfo: the member frames drawn at the left of the map (Group.bas). */
  UpdateGroupInfo = 193,
}

export enum PartyClientPacketId {
  InvitarGrupo = 234,
  RequestGrupo = 236,
  AbandonarGrupo = 237,
  HecharDeGrupo = 238,
  ActionOnGroupFrame = 299,
}

/** Server Declares.bas e_Skill: Magia = 1, Grupo = 90 (MarcaDeClan = 91); Grupo is the skill the invite flow asks a target for. */
export const GROUP_SKILL = 90;
export const CLAN_MARK_SKILL = 91;

export interface PartyCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }
type Shape<S> = { [K in keyof S]: S[K] extends PartyCodec<infer T> ? T : never };
function struct<const S extends Record<string, PartyCodec<unknown>>>(fields: S): PartyCodec<Shape<S>> {
  return {
    read(reader) {
      const value: Record<string, unknown> = {};
      for (const [key, codec] of Object.entries(fields)) value[key] = codec.read(reader);
      return value as Shape<S>;
    },
    write(writer, value) { for (const [key, codec] of Object.entries(fields)) codec.write(writer, (value as Record<string, unknown>)[key]); },
  };
}
const byte: PartyCodec<number> = { read: r => r.readInt8(), write: (w, v) => { w.writeInt8(v); } };
const int16: PartyCodec<number> = { read: r => r.readInt16(), write: (w, v) => { w.writeInt16(v); } };
const int32: PartyCodec<number> = { read: r => r.readInt32(), write: (w, v) => { w.writeInt32(v); } };
const string: PartyCodec<string> = { read: r => r.readString(), write: (w, v) => { w.writeString(v); } };
const bool: PartyCodec<boolean> = { read: r => r.readBool(), write: (w, v) => { w.writeBool(v); } };

/**
 * WriteDatosGrupo / HandleDatosGrupo: inGroup:bool, then only when true count:byte and `count` names. The leader's name carries
 * the "(Líder)" suffix the server appends.
 */
const datosGrupo: PartyCodec<{ inGroup: boolean; members: string[] }> = {
  read(reader) {
    const inGroup = reader.readBool();
    if (!inGroup) return { inGroup, members: [] };
    const count = reader.readInt8();
    return { inGroup, members: Array.from({ length: count }, () => reader.readString()) };
  },
  write(writer, value) {
    writer.writeBool(value.inGroup);
    if (!value.inGroup) return;
    writer.writeInt8(value.members.length);
    for (const name of value.members) writer.writeString(name);
  },
};

export interface GroupFrameMember { name: string; charIndex: number; head: number; minHp: number; maxHp: number }
const groupMember = struct({ name: string, charIndex: int16, head: int16, minHp: int16, maxHp: int16 });
/**
 * PrepareUpdateGroupInfo / HandleUpdateGroupInfo: count:byte, then per member name:s, charIndex:i16, head:i16, minHp:i16, maxHp:i16.
 * The server writes count 0 when the player is not in a group.
 */
const updateGroupInfo: PartyCodec<{ members: GroupFrameMember[] }> = {
  read(reader) {
    const count = reader.readInt8();
    // Each member is at least 9 bytes; never allocate from an unchecked count.
    if (count > Math.floor(reader.remaining / 9)) throw new RangeError('Invalid group size');
    return { members: Array.from({ length: count }, () => groupMember.read(reader)) };
  },
  write(writer, value) {
    writer.writeInt8(value.members.length);
    for (const member of value.members) groupMember.write(writer, member);
  },
};

export const partyServerCodecs = {
  [PartyServerPacketId.DatosGrupo]: datosGrupo,
  [PartyServerPacketId.UpdateGroupInfo]: updateGroupInfo,
};

export const partyClientCodecs = {
  [PartyClientPacketId.InvitarGrupo]: struct({}),
  [PartyClientPacketId.RequestGrupo]: struct({}),
  [PartyClientPacketId.AbandonarGrupo]: struct({}),
  /** WriteEcharDeGrupo: the 0-based list index of the member to expel. */
  [PartyClientPacketId.HecharDeGrupo]: struct({ index: byte }),
  /** WriteActionOnGroupFrame: the member's GroupId (1-based position in the frame list). */
  [PartyClientPacketId.ActionOnGroupFrame]: struct({ groupId: byte }),
};
