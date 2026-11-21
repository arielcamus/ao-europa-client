import { describe, expect, it } from 'vitest';
import {
  FrameDecoder, KeysClientPacketId as K, SkillsClientPacketId as SC, SkillsServerPacketId as SS, decodeClientPacket, encodeServerFrame,
} from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { Session } from '../src/session.js';
import { ChatInput } from '../src/chat-input.js';
import { ALIGNMENTS, MAX_SKILL_POINTS, SkillAllocation, statsView } from '../src/skills.js';

const SELF = 0x1234, OTHER = 77;
function harness() {
  let now = 1000;
  const sent: Uint8Array[] = [];
  const session = new Session({ email: 'test', password: 'secret' }, bytes => sent.push(bytes), () => now);
  const recv = (...packets: ServerPacket[]) => { for (const packet of packets) session.receive(encodeServerFrame(packet)); };
  recv(f.Connected, f.AccountCharacterList, { ...f.Intervals, walk: 100 }, f.ChangeMap,
    { ...f.CharacterCreate, speeding: 1, heading: 2, x: 50, y: 60 }, f.UserCharIndexInServer, f.Logged);
  sent.length = 0;
  const decoded = () => { const d = new FrameDecoder(); return sent.flatMap(bytes => d.push(bytes).map(decodeClientPacket)); };
  return { session, recv, sent, decoded, advance: (ms: number) => { now += ms; } };
}
const skills = (over: Record<number, number> = {}) => Array.from({ length: 24 }, (_, i) => over[i + 1] ?? 0);
const attributes = { id: SS.Atributes, strength: 19, agility: 18, intelligence: 17, constitution: 16, charisma: 15 } as const;
const miniStats = { id: SS.MiniStats, citizensKilled: 1, criminalsKilled: 2, alignment: 1, npcsKilled: 33, classId: 3, jailMinutes: 4, deaths: 5, gender: 2, fishingPoints: 6, race: 5 } as const;
void SELF;

describe('skill window requests (RequestSkills, LevelUp, SendSkills)', () => {
  it('the server pushes SendSkills + LevelUp at login without opening anything; the skills button asks and then opens', () => {
    const h = harness();
    h.recv({ id: SS.LevelUp, skillPoints: 10 }, { id: SS.SendSkills, skills: skills({ 3: 5 }) });
    expect(h.session.skills).toMatchObject({ skillPoints: 10, skillsOpen: false });
    expect(h.session.skills.skills[3]).toBe(5);
    expect(h.session.requestSkills()).toBe(true);
    expect(h.decoded()).toEqual([{ id: SC.RequestSkills }]);
    expect(h.session.skills.skillsOpen).toBe(false);
    h.recv({ id: SS.SendSkills, skills: skills({ 3: 6 }) });
    expect(h.session.skills.skillsOpen).toBe(true);
    expect(h.session.skills.skills[3]).toBe(6);
    h.session.skills.closeSkills();
    h.recv({ id: SS.SendSkills, skills: skills() }); // an unsolicited refresh does not reopen it (LlegaronSkills was cleared)
    expect(h.session.skills.skillsOpen).toBe(false);
  });
  it('values above 100 are shown as 100 (Iniciar_Labels) and nothing is sent before login', () => {
    const h = harness();
    h.recv({ id: SS.SendSkills, skills: skills({ 1: 120 }) });
    expect(h.session.skills.skills[1]).toBe(100);
    expect(new Session({ email: 'a', password: 'b' }, () => { throw new Error('nothing may be sent'); }, () => 0).requestSkills()).toBe(false);
  });
  it('ModifySkills sends the 24 added points, refuses all-zero, wrong sizes and negative values', () => {
    const h = harness();
    expect(h.session.modifySkills(skills({ 24: 1, 2: 3 }))).toBe(true);
    expect(h.session.modifySkills(skills())).toBe(false);
    expect(h.session.modifySkills([1, 2])).toBe(false);
    expect(h.session.modifySkills(skills({ 1: -1 }))).toBe(false);
    expect(h.decoded()).toEqual([{ id: SC.ModifySkills, points: skills({ 24: 1, 2: 3 }) }]);
  });
});

describe('skill allocation (FrmEstadisticas Command1_Click)', () => {
  const original = [0, ...skills({ 1: 10, 2: 100 })];
  it('adds while points remain and the skill is below 100; removes only what this session added', () => {
    const a = new SkillAllocation(original, 2);
    expect(a.add(1)).toBe(true); expect(a.add(1)).toBe(true);
    expect([a.values[1], a.remaining]).toEqual([12, 0]);
    expect(a.add(3)).toBe(false);                          // no points left
    expect(a.remove(2)).toBe(false);                       // nothing added there
    expect(a.remove(1)).toBe(true); expect([a.values[1], a.remaining]).toEqual([11, 1]);
    expect(a.changed).toBe(true);
    expect(a.delta).toEqual(skills({ 1: 1 }));
    expect(a.remove(1)).toBe(true); expect(a.changed).toBe(false);
    expect(a.remove(1)).toBe(false);                       // never below the server's value
  });
  it('stops at MAXSKILLPOINTS', () => {
    const a = new SkillAllocation(original, 5);
    expect(a.add(2)).toBe(false);
    expect(MAX_SKILL_POINTS).toBe(100);
  });
});

describe('statistics window requests (ImgEstadisticas: RequestAtributes + RequestMiniStats)', () => {
  it('opens when both answers are in, whichever comes first, and asks again on the next click', () => {
    const h = harness();
    h.session.requestStats();
    expect(h.decoded()).toEqual([{ id: SC.RequestAtributes }, { id: SC.RequestMiniStats }]);
    h.recv(attributes); expect(h.session.skills.statsOpen).toBe(false);
    h.recv(miniStats); expect(h.session.skills.statsOpen).toBe(true);
    h.session.skills.closeStats();
    h.session.requestStats();
    h.recv(miniStats); expect(h.session.skills.statsOpen).toBe(false);
    h.recv(attributes); expect(h.session.skills.statsOpen).toBe(true);
  });
  it('formats class, race, gender, alignment colour and the five attributes', () => {
    const v = statsView({ strength: 19, agility: 18, intelligence: 17, constitution: 16, charisma: 15 }, miniStats);
    expect(v).toMatchObject({ className: 'Guerrero', race: 'Enano', gender: 'Mujer', jail: '4 min', criminalsKilled: 2, citizensKilled: 1, npcsKilled: 33, fishingPoints: 6 });
    expect(v.attributes).toEqual([19, 18, 17, 16, 15]);
    expect(v.alignment).toEqual(ALIGNMENTS[1]);
    expect(statsView({ strength: 1, agility: 1, intelligence: 1, constitution: 1, charisma: 1 }, { ...miniStats, gender: 1, alignment: 0 }).gender).toBe('Hombre');
  });
});

describe('trainer (TrainList, TrainerCreatureList, Train)', () => {
  it('lists the creatures and sends the 1-based choice', () => {
    const h = harness();
    expect(h.session.requestTrainerList()).toBe(true);
    h.recv({ id: SS.TrainerCreatureList, creatures: ['Lobo', 'Oso'] });
    expect(h.session.skills.trainerCreatures).toEqual(['Lobo', 'Oso']);
    expect(h.session.train(2)).toBe(true);
    expect(h.session.train(0)).toBe(false);
    h.session.skills.closeTrainer();
    expect(h.session.skills.trainerCreatures).toBeUndefined();
    expect(h.decoded()).toEqual([{ id: SC.TrainList }, { id: SC.Train, creature: 2 }]);
  });
});

describe('rest and meditation', () => {
  it('RestOK toggles resting; a resting character does not walk, asks once to stand up and cannot attack', () => {
    const h = harness();
    h.recv({ id: SS.RestOK });
    expect(h.session.skills.resting).toBe(true);
    h.advance(1000);
    expect(h.session.walk(1)).toBe(false);
    h.advance(1000);
    expect(h.session.walk(1)).toBe(false);
    expect(h.decoded()).toEqual([{ id: SC.Rest }]);                 // one stand-up request (UserAvisado)
    expect(h.session.attack()).toBe(false);
    h.recv({ id: SS.RestOK });
    expect(h.session.skills.resting).toBe(false);
    h.advance(1000);
    expect(h.session.walk(1)).toBe(true);
  });
  it('MeditateToggle for yourself prints the console line and loops the effect until fx is 0; others only get the effect', () => {
    const h = harness();
    h.recv({ id: SS.MeditateToggle, charIndex: f.UserCharIndexInServer.charIndex, fx: 7, x: 0, y: 0 });
    expect(h.session.skills.meditating).toBe(true);
    expect(h.session.ui.messages.at(-1)?.text).toBe('Comienzas a meditar.');
    expect(h.session.spells.effects).toEqual([expect.objectContaining({ fx: 7, charIndex: f.UserCharIndexInServer.charIndex, loops: -1 })]);
    h.recv({ id: SS.MeditateToggle, charIndex: OTHER, fx: 7, x: 0, y: 0 });
    expect(h.session.spells.effects).toHaveLength(2);
    expect(h.session.ui.messages.filter(m => m.text === 'Comienzas a meditar.')).toHaveLength(1);
    h.recv({ id: SS.MeditateToggle, charIndex: f.UserCharIndexInServer.charIndex, fx: 0, x: 0, y: 0 });
    expect(h.session.skills.meditating).toBe(false);
    expect(h.session.ui.messages.at(-1)?.text).toBe('Has dejado de meditar.');
    expect(h.session.spells.effects).toEqual([expect.objectContaining({ charIndex: OTHER })]);
  });
  it('a level-tier meditation FX missing from FXs.ini loops as the classic aura until fx 0, drawn as the meditation animation', () => {
    const h = harness();
    h.recv({ id: SS.MeditateToggle, charIndex: f.UserCharIndexInServer.charIndex, fx: 155, x: 57, y: 50 });
    expect(h.session.spells.effects).toEqual([expect.objectContaining({ fx: 116, loops: -1 })]);
    expect(h.session.spells.effects[0]!.meditation).toBeUndefined(); // ordinary additive FX path (IsPNG=0 art)
    h.recv({ id: SS.MeditateToggle, charIndex: f.UserCharIndexInServer.charIndex, fx: 0, x: 0, y: 0 });
    expect(h.session.spells.effects).toEqual([]);
  });
  it('the meditation lines follow the INFO channel (ChatCombate), the effect does not', () => {
    const h = harness();
    h.session.ui.chatCombate = false;
    h.recv({ id: SS.MeditateToggle, charIndex: f.UserCharIndexInServer.charIndex, fx: 7, x: 0, y: 0 });
    expect(h.session.skills.meditating).toBe(true);
    expect(h.session.ui.messages.some(m => m.text.includes('meditar'))).toBe(false);
    expect(h.session.spells.effects).toHaveLength(1);
  });
  it('CantUseWhileMeditating prints the red warning', () => {
    const h = harness();
    h.recv({ id: SS.CantUseWhileMeditating });
    expect(h.session.ui.messages.at(-1)?.text).toBe('¡Estás meditando! Debes dejar de meditar para usar objetos.');
  });
});

describe('chat commands (ParseUserCommand)', () => {
  const run = (text: string, context = {}) => new ChatInput().submit(text, context);
  it('/ENTRENAR, /DESCANSAR, /MEDITAR and /EST send their packets; the dead and a full mana pool are refused locally', () => {
    expect(run('/entrenar').packet).toEqual({ id: SC.TrainList });
    expect(run('/DESCANSAR').packet).toEqual({ id: SC.Rest });
    expect(run('/meditar').packet).toEqual({ id: K.Meditate });
    expect(run('/EST').packet).toEqual({ id: SC.RequestStats });
    expect(run('/REST', { dead: true })).toMatchObject({ notes: [{ text: '¡¡Estás muerto!!' }] });
    expect(run('/MEDITAR', { dead: true }).packet).toBeUndefined();
    expect(run('/MEDITAR', { manaFull: true })).toMatchObject({ notes: [{ text: '¡Tu maná está completo!' }] });
    expect(run('/MEDITAR', { manaFull: true }).packet).toBeUndefined();
  });
});
