/*
 * Skills, attributes, statistics, trainers and rest/meditation subset, adapted 2026-11-20 from Argentum 20 classic
 * Protocol_Writes.bas (server: WriteAttributes, WriteSendSkills, WriteMiniStats, WriteLevelUp, WriteTrainerCreatureList,
 * WriteRestOK, PrepareMessageMeditateToggle, WriteCantUseWhileMeditating) and Protocol.bas / Protocol_Writes.bas (client).
 * Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; no warranty. See ../../../../LICENSE.
 *
 * Self-contained: registers itself with two spread lines in ../packets.ts. Meditate (client 48) is the keys table's codec.
 * Ids follow the PacketId.bas enum order (verified against the live VB6 server).
 */
import type { Reader, Writer } from '../binary.js';

export interface SkillsCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }

/** NUMSKILLS (client Declares.bas): one byte per skill, eSkill 1 Magia .. 24 Domar. */
export const NUM_SKILLS = 24;

export enum SkillsServerPacketId {
  CantUseWhileMeditating = 24,
  Atributes = 67,
  RestOK = 72,
  MiniStats = 79,
  LevelUp = 80,
  MeditateToggle = 84,
  SendSkills = 87,
  TrainerCreatureList = 88,
}
export enum SkillsClientPacketId {
  ModifySkills = 7,
  Train = 8,
  TrainList = 46,
  Rest = 47,
  RequestStats = 52,
  RequestAtributes = 85,
  RequestSkills = 86,
  RequestMiniStats = 87,
}

/** Server SEPARATOR (Protocol.bas): the trainer's creature names are joined with a NUL. */
export const TRAINER_SEPARATOR = '\0';

const empty: SkillsCodec<Record<never, never>> = { read: () => ({}), write: () => {} };
/** NUM_SKILLS bytes: the skill values (SendSkills) or the points to add to each skill (ModifySkills). */
const skillBytes: SkillsCodec<number[]> = {
  read: r => Array.from({ length: NUM_SKILLS }, () => r.readInt8()),
  write: (w, v) => {
    if (v.length !== NUM_SKILLS) throw new Error(`Expected ${NUM_SKILLS} skill values`);
    for (const value of v) w.writeInt8(value);
  },
};

export const skillsServerCodecs = {
  [SkillsServerPacketId.CantUseWhileMeditating]: empty,
  // WriteAttributes: Fuerza, Agilidad, Inteligencia, Constitucion, Carisma.
  [SkillsServerPacketId.Atributes]: {
    read: r => ({ strength: r.readInt8(), agility: r.readInt8(), intelligence: r.readInt8(), constitution: r.readInt8(), charisma: r.readInt8() }),
    write: (w, v) => { w.writeInt8(v.strength); w.writeInt8(v.agility); w.writeInt8(v.intelligence); w.writeInt8(v.constitution); w.writeInt8(v.charisma); },
  } as SkillsCodec<{ strength: number; agility: number; intelligence: number; constitution: number; charisma: number }>,
  [SkillsServerPacketId.RestOK]: empty,
  // WriteMiniStats.
  [SkillsServerPacketId.MiniStats]: {
    read: r => ({
      citizensKilled: r.readInt32(), criminalsKilled: r.readInt32(), alignment: r.readInt8(), npcsKilled: r.readInt32(), classId: r.readInt8(),
      jailMinutes: r.readInt32(), deaths: r.readInt32(), gender: r.readInt8(), fishingPoints: r.readInt32(), race: r.readInt8(),
    }),
    write: (w, v) => {
      w.writeInt32(v.citizensKilled); w.writeInt32(v.criminalsKilled); w.writeInt8(v.alignment); w.writeInt32(v.npcsKilled); w.writeInt8(v.classId);
      w.writeInt32(v.jailMinutes); w.writeInt32(v.deaths); w.writeInt8(v.gender); w.writeInt32(v.fishingPoints); w.writeInt8(v.race);
    },
  } as SkillsCodec<{
    citizensKilled: number; criminalsKilled: number; alignment: number; npcsKilled: number; classId: number;
    jailMinutes: number; deaths: number; gender: number; fishingPoints: number; race: number;
  }>,
  // WriteLevelUp: the free skill points the player has now.
  [SkillsServerPacketId.LevelUp]: { read: r => ({ skillPoints: r.readInt16() }), write: (w, v) => { w.writeInt16(v.skillPoints); } } as SkillsCodec<{ skillPoints: number }>,
  // PrepareMessageMeditateToggle: fx 0 = stopped; x,y (non-zero) relocate an invisible character.
  [SkillsServerPacketId.MeditateToggle]: {
    read: r => ({ charIndex: r.readInt16(), fx: r.readInt16(), x: r.readInt8(), y: r.readInt8() }),
    write: (w, v) => { w.writeInt16(v.charIndex); w.writeInt16(v.fx); w.writeInt8(v.x); w.writeInt8(v.y); },
  } as SkillsCodec<{ charIndex: number; fx: number; x: number; y: number }>,
  [SkillsServerPacketId.SendSkills]: { read: r => ({ skills: skillBytes.read(r) }), write: (w, v) => skillBytes.write(w, v.skills) } as SkillsCodec<{ skills: number[] }>,
  // WriteTrainerCreatureList: one String8 of the names joined with NUL ("" when the trainer has none).
  [SkillsServerPacketId.TrainerCreatureList]: {
    read: r => { const text = r.readString(); return { creatures: text === '' ? [] : text.split(TRAINER_SEPARATOR) }; },
    write: (w, v) => { w.writeString(v.creatures.join(TRAINER_SEPARATOR)); },
  } as SkillsCodec<{ creatures: string[] }>,
};

export const skillsClientCodecs = {
  // WriteModifySkills: for each skill the number of points ADDED (not the new value).
  [SkillsClientPacketId.ModifySkills]: { read: r => ({ points: skillBytes.read(r) }), write: (w, v) => skillBytes.write(w, v.points) } as SkillsCodec<{ points: number[] }>,
  // WriteTrain: 1-based position in the trainer's creature list.
  [SkillsClientPacketId.Train]: { read: r => ({ creature: r.readInt8() }), write: (w, v) => { w.writeInt8(v.creature); } } as SkillsCodec<{ creature: number }>,
  [SkillsClientPacketId.TrainList]: empty,
  [SkillsClientPacketId.Rest]: empty,
  [SkillsClientPacketId.RequestStats]: empty,
  [SkillsClientPacketId.RequestAtributes]: empty,
  [SkillsClientPacketId.RequestSkills]: empty,
  [SkillsClientPacketId.RequestMiniStats]: empty,
};
