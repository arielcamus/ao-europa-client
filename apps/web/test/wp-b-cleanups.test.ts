import { describe, expect, it } from 'vitest';
import { GmServerPacketId as GS, NpcsServerPacketId as NS, SessionServerPacketId as SS, SpellServerPacketId as SP, SkillsServerPacketId as SK, encodeServerFrame } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { parseIni } from '../src/assets.js';
import { ChatLocale } from '../src/chat-locale.js';
import { ClassicState } from '../src/ui-state.js';
import { Session } from '../src/session.js';
import { QuestCatalog } from '../src/quests.js';
import { QUEST_DESC_AUDIO_LABEL, QuestVoice, resolveQuestAudio } from '../src/quest-voice.js';
import { dragPosition } from '../src/window-drag.js';
import { hotkeySlotAt } from '../src/hotkeys-ui.js';

function harness() {
  const now = 0;
  const session = new Session({ email: 'a', password: 'b' }, () => {}, () => now);
  const recv = (...packets: ServerPacket[]) => { for (const packet of packets) session.receive(encodeServerFrame(packet)); };
  recv(f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap, { ...f.CharacterCreate, speeding: 1 }, f.UserCharIndexInServer, f.Logged);
  return { session, recv };
}

describe('the five packets with a codec and no obvious client reference (client Protocol.bas)', () => {
  it('UserIndexInServer stores userIndex like HandleUserIndexInServer, and nothing else changes', () => {
    const h = harness();
    h.recv({ id: SS.UserIndexInServer, userIndex: 321 });
    expect(h.session.userIndex).toBe(321);
    expect(h.session.phase).toBe('playing');
  });
  it('ShowFrmLogear and ShowForumForm are accepted and change nothing (the VB6 handlers show the account login form / have an empty body)', () => {
    const h = harness();
    const before = h.session.phase;
    h.recv({ id: SS.ShowFrmLogear } as ServerPacket, { id: GS.ShowForumForm } as ServerPacket);
    expect(h.session.phase).toBe(before);
  });
  it('NotificarClienteCasteo records where the cast came from (frmMain.shapexy colour, never visible)', () => {
    const h = harness();
    expect(h.session.spells.castFrom).toBe('spells');
    h.recv({ id: SP.NotifyCasting, value: 1 });
    expect(h.session.spells.castFrom).toBe('inventory');
    h.recv({ id: SP.NotifyCasting, value: 2 });
    expect(h.session.spells.castFrom).toBe('spells');
  });
  it('Fxpiso starts a floor FX (SetMapFx x, y, Fx, 0)', () => {
    const h = harness();
    h.recv({ id: SP.FxFloor, x: 50, y: 50, grh: 9 });
    expect(h.session.spells.effects.at(-1)).toMatchObject({ x: 50, y: 50, grh: 9, charIndex: undefined });
  });
});

describe('issue #38: skills and trainer', () => {
  it('a Disconnect resets the skills window state (SkillsState.reset)', () => {
    const h = harness();
    h.session.skills.resting = true; h.session.skills.skillPoints = 5; h.session.skills.skillsOpen = true;
    h.recv({ id: SK.TrainerCreatureList, creatures: [] });
    expect(h.session.skills.trainerCreatures).toEqual([]); // an empty list still opens the form (the window shows one empty row, like AddItem("") in VB6)
    h.session.skills.reset();
    expect(h.session.skills.resting).toBe(false); expect(h.session.skills.skillPoints).toBe(0); expect(h.session.skills.trainerCreatures).toBeUndefined();
  });
});

describe('issue #16: LOCMSG parameters and QUESTFIN voice', () => {
  const locale = new ChatLocale(); locale.load('[SP_MSG]\nMsg7=Hola ¬1.\n[QUEST2]\nDescFinal=Gracias.\nDescFinalAudio=1049\nDescAudio=1048\n');
  it('reads the LOCMSG extra from field 3 (the documented deviation from the VB6 client bug)', () => {
    const ui = new ClassicState(); ui.chat.locale = locale; ui.chat.characters = () => ({ npc: 1, name: 'x', privileges: 0, status: 0 }) as never;
    ui.receive({ id: NS.ChatOverHead, chat: 'LOCMSG*7*Ana', charIndex: 1, color: 0, isSpell: true, x: 0, y: 0, minChatTime: 0, maxChatTime: 0 });
    expect(ui.chat.dialogs.get(1)!.text).toBe('Hola Ana.');
  });
  it('QUESTFIN voices the quest DESCFINALAUDIO (PlayQuestFinalDescAudio)', () => {
    const ui = new ClassicState(); ui.chat.locale = locale; ui.chat.characters = () => undefined;
    const heard: string[] = []; ui.chat.onQuestFinal = audio => heard.push(audio);
    ui.receive({ id: NS.ChatOverHead, chat: 'QUESTFIN*2', charIndex: 1, color: 0, isSpell: true, x: 0, y: 0, minChatTime: 0, maxChatTime: 0 });
    expect(heard).toEqual(['1049']);
  });
});

describe('quest voice-over (PlayQuestDescAudio, StopQuestDescAudio, ResolveLocalizedAudioId)', () => {
  it('resolves ids: prefixed or Spanish as is, another language prefixed with the base id as fallback, empty plays nothing', () => {
    expect(resolveQuestAudio('1048', 'es')).toEqual({ primary: '1048' });
    expect(resolveQuestAudio('en_1048', 'en')).toEqual({ primary: 'en_1048' });
    expect(resolveQuestAudio(' 1048 ', 'en')).toEqual({ primary: 'en_1048', fallback: '1048' });
    expect(resolveQuestAudio('  ', 'es')).toBeUndefined();
  });
  it('stops the previous voice under the one label, plays the new one, and falls back to the base id', async () => {
    const calls: string[] = [];
    const engine = {
      playWave: async (id: string | number, options?: { label?: string }) => { calls.push(`play ${id} ${options?.label}`); return id !== 'en_5'; },
      stopWave: (id: string | number, label?: string) => { calls.push(`stop ${id} ${label}`); },
    };
    const voice = new QuestVoice(engine, () => 'en');
    voice.play('7'); voice.play('5');
    await Promise.resolve(); await Promise.resolve();
    expect(calls).toEqual([`play en_7 ${QUEST_DESC_AUDIO_LABEL}`, `stop en_7 ${QUEST_DESC_AUDIO_LABEL}`, `play en_5 ${QUEST_DESC_AUDIO_LABEL}`, `play 5 ${QUEST_DESC_AUDIO_LABEL}`]);
    voice.stop(); expect(calls.at(-1)).toBe(`stop 5 ${QUEST_DESC_AUDIO_LABEL}`);
    voice.enabled = false; calls.length = 0; voice.play('9'); expect(calls).toEqual([]); // SndDescNpcsQuestEnabled = 0
  });
  it('reads DESCAUDIO from the QUEST section (empty when the data has none)', () => {
    const catalog = new QuestCatalog(); catalog.load('[QUEST3]\nNombre=Lobos\nDescAudio=1048\n[QUEST4]\nNombre=Sin voz\n');
    expect(catalog.questAudio(3)).toBe('1048'); expect(catalog.questAudio(4)).toBe('');
  });
});

describe('MoverForm drag', () => {
  const stage = { width: 1024, height: 768 }, size = { width: 400, height: 300 };
  it('moves by the pointer delta and keeps the form inside the stage', () => {
    expect(dragPosition({ x: 100, y: 100 }, { x: 30, y: -20 }, size, stage)).toEqual({ x: 130, y: 80 });
    expect(dragPosition({ x: 100, y: 100 }, { x: -500, y: -500 }, size, stage)).toEqual({ x: 0, y: 0 });
    expect(dragPosition({ x: 100, y: 100 }, { x: 900, y: 900 }, size, stage)).toEqual({ x: 624, y: 468 });
  });
});

describe('issue #19: hotkey bar and the shared spell data', () => {
  it('has one copy of Dat/Hechizos.dat: ChatLocale.spellData (the hotkey bar reads it for IsBindable and the icon)', () => {
    const locale = new ChatLocale(); locale.spellData = parseIni('[HECHIZO4]\nIsBindable=1\nIconoIndex=77\n');
    expect(locale.spellData.get('hechizo4')?.get('isbindable')).toBe('1');
    expect(hotkeySlotAt(190, 608 - 40)).toBe(0);
  });
});

