/*
 * Quest subset, adapted 2026-11-20 from Argentum 20 classic Protocol_Writes.bas
 * (server: WriteQuestDetails, WriteQuestListSend, WriteNpcQuestListSend, WriteObjQuestSend,
 * WriteUpdateNPCSimbolo) and Protocol.bas (client: HandleQuestDetails, HandleQuestListSend,
 * HandleNpcQuestListSend, HandleObjQuestListSend, HandleUpdateNPCSimbolo).
 * Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; no warranty. See ../../../../LICENSE.
 *
 * Self-contained on purpose: registers itself with two spread lines in ../packets.ts.
 * Ids follow the PacketId.bas enum order (verified against the live VB6 server).
 */
import type { Reader, Writer } from '../binary.js';
import { hooTail, isPreHoo } from '../profile.js';

export interface QuestCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }

/** Server to client ids of the quest subset (server PacketId.bas, e-prefix dropped). */
export enum QuestServerPacketId {
  QuestDetails = 153,
  QuestListSend = 154,
  NpcQuestListSend = 155,
  UpdateNPCSimbolo = 156,
  ObjQuestListSend = 174,
}
/** Client to server ids of the quest subset. */
export enum QuestClientPacketId {
  Quest = 258,
  QuestAccept = 259,
  QuestListRequest = 260,
  QuestDetailsRequest = 261,
  QuestAbandon = 262,
}

/** State byte of an offered quest (WriteNpcQuestListSend): 0 available, 1 in progress, 2 done, 3 cannot do it. */
export enum QuestState { Available = 0, InProgress = 1, Done = 2, Unavailable = 3 }

export interface RequiredNpc { amount: number; npcIndex: number }
export interface RequiredObj { amount: number; objIndex: number }
export interface RewardObj { amount: number; objIndex: number }
export interface QuestDetailsNpc extends RequiredNpc { killed: number }
export interface QuestDetailsObj extends RequiredObj { have: number }
export interface QuestDetailsSpell { spell: number; has: number }

/** Count byte + that many entries; the count of every VB6 list here is a Byte. */
function list<T>(entry: QuestCodec<T>): QuestCodec<T[]> {
  return {
    read(reader) { const count = reader.readInt8(); return Array.from({ length: count }, () => entry.read(reader)); },
    write(writer, value) { writer.writeInt8(value.length); for (const item of value) entry.write(writer, item); },
  };
}
const pair = <A extends string, B extends string>(a: A, b: B): QuestCodec<Record<A | B, number>> => ({
  read: r => ({ [a]: r.readInt16(), [b]: r.readInt16() }) as Record<A | B, number>,
  write: (w, v) => { w.writeInt16(v[a]); w.writeInt16(v[b]); },
});
const triple = <A extends string, B extends string, C extends string>(a: A, b: B, c: C): QuestCodec<Record<A | B | C, number>> => ({
  read: r => ({ [a]: r.readInt16(), [b]: r.readInt16(), [c]: r.readInt16() }) as Record<A | B | C, number>,
  write: (w, v) => { w.writeInt16(v[a]); w.writeInt16(v[b]); w.writeInt16(v[c]); },
});
const classId: QuestCodec<number> = { read: r => r.readInt8(), write: (w, v) => { w.writeInt8(v); } };
const spellId: QuestCodec<number> = { read: r => r.readInt16(), write: (w, v) => { w.writeInt16(v); } };

const classes = list(classId), reqNpcs = list(pair('amount', 'npcIndex')), reqObjs = list(pair('amount', 'objIndex'));
const rewardObjs = list(pair('amount', 'objIndex')), spells = list(spellId);

export interface QuestDetails {
  questIndex: number; requiredLevel: number; limitLevel: number; requiredClasses: number[]; requiredQuest: number;
  npcs: QuestDetailsNpc[]; objs: QuestDetailsObj[]; spells: QuestDetailsSpell[];
  skillType: number; skillValue: number; rewardGold: number; rewardExp: number;
  rewardObjs: RewardObj[]; rewardSpells: number[]; talkTo: number; deliverMap: number;
}
// WriteQuestDetails; the NPC kill counter is always present because the details request always carries a quest slot.
const questDetails: QuestCodec<QuestDetails> = {
  read(r) {
    const questIndex = r.readInt16(), requiredLevel = r.readInt8(), limitLevel = r.readInt8();
    const requiredClasses = classes.read(r), requiredQuest = r.readInt16();
    const npcs = list(triple('amount', 'npcIndex', 'killed')).read(r);
    const objs = list(triple('amount', 'objIndex', 'have')).read(r);
    const spellList = list(pair('spell', 'has')).read(r);
    const skillType = r.readInt8(), skillValue = r.readInt8(), rewardGold = r.readInt32(), rewardExp = r.readInt32();
    return {
      questIndex, requiredLevel, limitLevel, requiredClasses, requiredQuest, npcs, objs, spells: spellList,
      skillType, skillValue, rewardGold, rewardExp, rewardObjs: rewardObjs.read(r), rewardSpells: spells.read(r),
      // talkTo / deliverMap exist only on the HOO-era server (turn-in NPC and map); absent on the pinned one.
      talkTo: hooTail(r, 4) ? r.readInt16() : 0, deliverMap: hooTail(r, 2) ? r.readInt16() : 0,
    };
  },
  write(w, v) {
    w.writeInt16(v.questIndex); w.writeInt8(v.requiredLevel); w.writeInt8(v.limitLevel);
    classes.write(w, v.requiredClasses); w.writeInt16(v.requiredQuest);
    list(triple('amount', 'npcIndex', 'killed')).write(w, v.npcs);
    list(triple('amount', 'objIndex', 'have')).write(w, v.objs);
    list(pair('spell', 'has')).write(w, v.spells);
    w.writeInt8(v.skillType); w.writeInt8(v.skillValue); w.writeInt32(v.rewardGold); w.writeInt32(v.rewardExp);
    rewardObjs.write(w, v.rewardObjs); spells.write(w, v.rewardSpells);
    if (!isPreHoo()) { w.writeInt16(v.talkTo); w.writeInt16(v.deliverMap); }
  },
};

export interface OfferedQuest {
  questIndex: number; requiredLevel: number; requiredQuest: number; requiredClasses: number[]; limitLevel: number;
  npcs: RequiredNpc[]; objs: RequiredObj[]; spells: number[]; skillType: number; skillValue: number;
  rewardGold: number; rewardExp: number; rewardObjs: RewardObj[]; rewardSpells: number[]; state: number;
}
// One entry of WriteNpcQuestListSend (LimitLevel follows the classes; reward spells present).
const offeredQuest: QuestCodec<OfferedQuest> = {
  read(r) {
    const questIndex = r.readInt16(), requiredLevel = r.readInt8(), requiredQuest = r.readInt16();
    const requiredClasses = classes.read(r), limitLevel = r.readInt8();
    const npcs = reqNpcs.read(r), objs = reqObjs.read(r), spellList = spells.read(r);
    const skillType = r.readInt8(), skillValue = r.readInt8(), rewardGold = r.readInt32(), rewardExp = r.readInt32();
    return {
      questIndex, requiredLevel, requiredQuest, requiredClasses, limitLevel, npcs, objs, spells: spellList, skillType, skillValue,
      rewardGold, rewardExp, rewardObjs: rewardObjs.read(r), rewardSpells: spells.read(r), state: r.readInt8(),
    };
  },
  write(w, v) {
    w.writeInt16(v.questIndex); w.writeInt8(v.requiredLevel); w.writeInt16(v.requiredQuest);
    classes.write(w, v.requiredClasses); w.writeInt8(v.limitLevel);
    reqNpcs.write(w, v.npcs); reqObjs.write(w, v.objs); spells.write(w, v.spells);
    w.writeInt8(v.skillType); w.writeInt8(v.skillValue); w.writeInt32(v.rewardGold); w.writeInt32(v.rewardExp);
    rewardObjs.write(w, v.rewardObjs); spells.write(w, v.rewardSpells); w.writeInt8(v.state);
  },
};

export interface ObjQuest {
  questIndex: number; requiredLevel: number; requiredQuest: number; npcs: RequiredNpc[]; objs: RequiredObj[]; spells: number[];
  skillType: number; skillValue: number; rewardGold: number; rewardExp: number; rewardObjs: RewardObj[]; state: number;
}
// WriteObjQuestSend: no classes, no limit level, no reward spells.
const objQuest: QuestCodec<ObjQuest> = {
  read(r) {
    const questIndex = r.readInt16(), requiredLevel = r.readInt8(), requiredQuest = r.readInt16();
    const npcs = reqNpcs.read(r), objs = reqObjs.read(r), spellList = spells.read(r);
    return {
      questIndex, requiredLevel, requiredQuest, npcs, objs, spells: spellList, skillType: r.readInt8(), skillValue: r.readInt8(),
      rewardGold: r.readInt32(), rewardExp: r.readInt32(), rewardObjs: rewardObjs.read(r), state: r.readInt8(),
    };
  },
  write(w, v) {
    w.writeInt16(v.questIndex); w.writeInt8(v.requiredLevel); w.writeInt16(v.requiredQuest);
    reqNpcs.write(w, v.npcs); reqObjs.write(w, v.objs); spells.write(w, v.spells);
    w.writeInt8(v.skillType); w.writeInt8(v.skillValue); w.writeInt32(v.rewardGold); w.writeInt32(v.rewardExp);
    rewardObjs.write(w, v.rewardObjs); w.writeInt8(v.state);
  },
};

// WriteQuestListSend: the Byte count, then (only when > 0) one String8 "3;7;12" of quest numbers.
const questList: QuestCodec<{ quests: number[] }> = {
  read(r) {
    const count = r.readInt8();
    if (count === 0) return { quests: [] };
    const quests = r.readString().split(';').map(Number);
    if (quests.length !== count || quests.some(n => !Number.isInteger(n) || n < 1)) throw new Error('Quest list does not match its count');
    return { quests };
  },
  write(w, v) { w.writeInt8(v.quests.length); if (v.quests.length) w.writeString(v.quests.join(';')); },
};

const empty: QuestCodec<Record<never, never>> = { read: () => ({}), write: () => {} };
const slot: QuestCodec<{ slot: number }> = { read: r => ({ slot: r.readInt8() }), write: (w, v) => { w.writeInt8(v.slot); } };

export const questServerCodecs = {
  [QuestServerPacketId.QuestDetails]: questDetails,
  [QuestServerPacketId.QuestListSend]: questList,
  [QuestServerPacketId.NpcQuestListSend]: { read: r => ({ quests: list(offeredQuest).read(r) }), write: (w, v) => list(offeredQuest).write(w, v.quests) } as QuestCodec<{ quests: OfferedQuest[] }>,
  [QuestServerPacketId.UpdateNPCSimbolo]: { read: r => ({ charIndex: r.readInt16(), symbol: r.readInt8() }), write: (w, v) => { w.writeInt16(v.charIndex); w.writeInt8(v.symbol); } } as QuestCodec<{ charIndex: number; symbol: number }>,
  [QuestServerPacketId.ObjQuestListSend]: objQuest,
};

export const questClientCodecs = {
  [QuestClientPacketId.Quest]: empty,
  [QuestClientPacketId.QuestAccept]: slot,
  [QuestClientPacketId.QuestListRequest]: empty,
  [QuestClientPacketId.QuestDetailsRequest]: slot,
  [QuestClientPacketId.QuestAbandon]: slot,
};
