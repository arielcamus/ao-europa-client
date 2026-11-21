import { describe, expect, it } from 'vitest';
import {
  FrameDecoder, NpcsServerPacketId as NS, PetsTravelClientPacketId as PC, PetsTravelServerPacketId as PS, SpellServerPacketId as SS, SpellClientPacketId as SC,
  decodeClientPacket, encodeServerFrame, WorkSkill, KeysClientPacketId as K,
} from '@ao/protocol';
import type { CharacterCreate, ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { Session } from '../src/session.js';
import { ChatInput } from '../src/chat-input.js';
import { ChatLocale } from '../src/chat-locale.js';
import { ClassicState } from '../src/ui-state.js';
import { TravelState } from '../src/travel.js';
import { CARTEL_FADE_MS, dialogLifeMs, dialogTimeline } from '../src/npc-dialog.js';

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

describe('pet commands (ParseUserCommand)', () => {
  const run = (text: string, context = {}) => new ChatInput().submit(text, context);
  it.each([
    [['/QUIETO', '/still'], PC.PetStand], [['/ACOMPAÑAR', '/accompany'], PC.PetFollow], [['/ACOMPAÑARTODOS', '/accompanyall'], PC.PetFollowAll],
    [['/LIBERAR', '/release'], PC.PetLeave], [['/LIBERARTODOS', '/liberartodas', '/liberartall'], PC.PetLeaveAll],
  ] as const)('%s write packet %i', (commands, id) => {
    for (const command of commands) expect(run(command).packet).toEqual({ id });
  });
  it('the dead are refused locally with the dead message', () => {
    for (const command of ['/QUIETO', '/ACOMPAÑAR', '/ACOMPAÑARTODOS', '/LIBERAR', '/LIBERARTODOS']) {
      const result = run(command, { dead: true });
      expect(result.packet).toBeUndefined();
      expect(result.notes[0]?.text).toBe('¡¡Estás muerto!!');
    }
  });
  it('travels through the session door as an empty packet', () => {
    const h = harness();
    expect(h.session.sendAction({ id: PC.PetFollow })).toBe(true);
    expect(h.decoded()).toEqual([{ id: PC.PetFollow }]);
  });
});

describe('taming (J key: Work with skill Domar, then the target click)', () => {
  it('the key sends Work(24) with the shared work counter; the server asks for a target and the click is WorkLeftClick(24)', () => {
    const h = harness();
    h.session.sendAction({ id: K.Work, skill: WorkSkill.Tame, counter: 0 });
    h.recv({ id: SS.WorkRequestTarget, skill: WorkSkill.Tame, area: false, radius: 0 });
    expect(h.session.spells.targeting).toMatchObject({ skill: 24 });
    expect(h.session.spells.click(52, 61)).toBe(true);
    expect(h.decoded()).toEqual([{ id: K.Work, skill: 24, counter: 1 }, { id: SC.WorkLeftClick, x: 52, y: 61, skill: 24, counter: 1 }]);
    expect(h.session.spells.targeting).toBeUndefined();
  });
});

describe('travel form (FrmViajes)', () => {
  const form: ServerPacket = { id: PS.ViajarForm, destinations: [{ city: 'Nix', cost: 150 }, { city: 'Lindos', cost: 300 }], interface: 0 };
  it('ViajarForm opens the list with the VB6 row text; the viajar button sends CompletarViaje with the 1-based row and its price, and closes', () => {
    const h = harness();
    h.recv(form);
    expect(h.session.travel.destinations).toHaveLength(2);
    expect(h.session.travel.destinations!.map(TravelState.rowText)).toEqual(['Nix - 150 monedas', 'Lindos - 300 monedas']);
    expect(h.session.travel.travel(0)).toBeUndefined(); // nothing selected: ListIndex + 1 = 0
    expect(h.session.travel.destinations).toBeDefined();
    const packet = h.session.travel.travel(2)!;
    expect(packet).toEqual({ id: PC.CompletarViaje, destination: 2, cost: 300 });
    expect(h.session.travel.destinations).toBeUndefined();
    expect(h.session.sendPacket(packet)).toBe(true);
    expect(h.decoded()).toEqual([packet]);
  });
  it('a map change unloads the form (HandleChangeMap)', () => {
    const h = harness();
    h.recv(form, f.ChangeMap);
    expect(h.session.travel.destinations).toBeUndefined();
  });
});

describe('NPC cartel timing (RenderScreen_Cartel: 0.72 units per ms, fade 1..255 each way)', () => {
  it('fades in and out in ~354 ms and holds for duration / 0.72', () => {
    expect(Math.round(CARTEL_FADE_MS)).toBe(354);
    const text = 'Hola, hijo mio!';
    const { fadeMs, holdMs } = dialogTimeline(text);
    expect(fadeMs).toBeCloseTo(354.17, 1);
    expect(holdMs).toBeCloseTo(dialogLifeMs(text) / 0.72, 5);
    expect(Math.round(holdMs)).toBe(Math.round(650 / 0.72));
  });
});

describe('LocaleChatOverHead before the locale file has loaded (issue #12)', () => {
  const character = { ...f.CharacterCreate, charIndex: 1, name: 'Eva', status: 1, privileges: 0, npc: 0 } as CharacterCreate;
  it('queues locale-built bubbles until the table is ready, instead of showing them empty', () => {
    const ui = new ClassicState();
    ui.chat.locale = new ChatLocale(); ui.chat.characters = () => character;
    const overhead = { charIndex: 1, color: 0, isSpell: false, x: 0, y: 0, minChatTime: 0, maxChatTime: 0 } as const;
    ui.receive({ id: NS.LocaleChatOverHead, chatId: 2, params: '', ...overhead });
    ui.receive({ id: NS.ChatOverHead, chat: 'LOCMSG*2*', ...overhead });
    ui.receive({ id: NS.ChatOverHead, chat: 'hola directo', ...overhead });
    expect(ui.chat.dialogs.get(1)?.text).toBe('hola directo'); // plain speech needs no locale
    ui.chat.dialogs.clear();
    ui.chat.locale.load('[SP_MSG]\r\nMsg2=Hola');
    ui.chat.flushPending();
    expect(ui.chat.dialogs.get(1)?.text).toBe('Hola');
  });
  it('keeps at most 200 waiting bubbles', () => {
    const ui = new ClassicState();
    ui.chat.locale = new ChatLocale(); ui.chat.characters = (index: number) => ({ ...character, charIndex: index });
    for (let i = 1; i <= 250; i++) ui.receive({ id: NS.LocaleChatOverHead, chatId: 2, params: '', charIndex: i, color: 0, isSpell: false, x: 0, y: 0, minChatTime: 0, maxChatTime: 0 });
    ui.chat.locale.load('[SP_MSG]\r\nMsg2=Hola');
    ui.chat.flushPending();
    expect(ui.chat.dialogs.size).toBe(200);
    expect(ui.chat.dialogs.has(1)).toBe(true); expect(ui.chat.dialogs.has(201)).toBe(false);
  });
});
