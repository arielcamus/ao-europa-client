import { describe, expect, it, beforeEach } from 'vitest';
import { FrameDecoder, HotkeyType, KeysClientPacketId as KC, OptionsClientPacketId as OC, OptionsServerPacketId as OS, decodeClientPacket, encodeServerFrame } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { Session } from '../src/session.js';
import { OptionsController, OptionsState, hotkeysKey, parseHotkeys } from '../src/options-state.js';
import { DEFAULT_OPTIONS, OPTIONS_KEY, OptionsSettings, sanitizeOptions } from '../src/options-settings.js';
import { ACTION_LABELS, BINDINGS_KEY, KeyBindings, NUM_BINDS, hotkeyLabel, keyName, parseBindings } from '../src/key-bindings.js';
import { DEFAULTS_CLASSIC, DEFAULTS_MODERN, KeyAction, getActiveBindings, keyAction, setActiveBindings, vbKeyCode } from '../src/keymap.js';
import { hotkeySlotAt } from '../src/hotkeys-ui.js';

class MemoryStore { data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; } setItem(key: string, value: string) { this.data.set(key, value); } removeItem(key: string) { this.data.delete(key); } }

function harness(store = new MemoryStore()) {
  const sent: Uint8Array[] = [];
  const session = new Session({ email: 'test', password: 'secret' }, bytes => sent.push(bytes), () => 1000);
  const recv = (...packets: ServerPacket[]) => { for (const packet of packets) session.receive(encodeServerFrame(packet)); };
  recv(f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap, { ...f.CharacterCreate, speeding: 1 }, f.UserCharIndexInServer, f.Logged);
  sent.length = 0;
  const decoded = () => { const d = new FrameDecoder(); return sent.flatMap(bytes => d.push(bytes).map(decodeClientPacket)); };
  const messages: string[] = [];
  let cancelled = 0;
  const state = new OptionsState();
  const actions = new OptionsController({ send: p => session['send' as never] ? undefined : undefined, ready: () => true, dead: () => false, message: t => messages.push(t), cancelTargeting: () => { cancelled++; }, store }, state);
  return { session, recv, decoded, messages, state, actions, cancelled: () => cancelled, store };
}

describe('SendClientToggles and BindKeys (client Protocol.bas)', () => {
  it('"hotokey-enabled" among the active toggles turns the hotkey bar on; the other toggles are only remembered', () => {
    const { session, recv } = harness();
    expect(session.options.hotkeysEnabled).toBe(false);
    recv({ id: OS.SendClientToggles, toggles: ['anti-cheat', 'hotokey-enabled'] });
    expect(session.options).toMatchObject({ hotkeysEnabled: true, toggles: ['anti-cheat', 'hotokey-enabled'] });
    recv({ id: OS.SendClientToggles, toggles: ['anti-cheat'] });
    expect(session.options.hotkeysEnabled).toBe(false);
  });
  it('BindKeys keeps the two chat icons', () => {
    const { session, recv } = harness();
    recv({ id: OS.BindKeys, chatCombat: 1, chatGlobal: 0 });
    expect(session.options).toMatchObject({ chatCombat: 1, chatGlobal: 0 });
  });
});

describe('hotkeys (ModSettings.LoadHotkeys / SetHotkey, modBindKeys.DoHotKey)', () => {
  it('UseHKeySlot is sent only when the server enabled hotkeys, and cancels a pending spell target first', () => {
    const { session, recv, decoded } = harness();
    let cancelled = 0;
    const original = session.spells.cancel.bind(session.spells); session.spells.cancel = () => { cancelled++; original(); };
    session.optionsActions.useHotkey(0);
    expect(decoded()).toEqual([]);
    recv({ id: OS.SendClientToggles, toggles: ['hotokey-enabled'] });
    session.optionsActions.setHotkey(0, 11, 3, HotkeyType.Spell);
    session.optionsActions.useHotkey(0);
    expect(cancelled).toBe(1);
    expect(decoded()).toEqual([{ id: OC.SetHotkeySlot, slot: 0, index: 11, lastKnownSlot: 3, type: 2 }, { id: KC.UseHKeySlot, slot: 0 }]);
  });
  it('an empty slot still sends UseHKeySlot (the server ignores it) but does not cancel targeting', () => {
    const { session, recv, decoded } = harness();
    let cancelled = 0; session.spells.cancel = () => { cancelled++; };
    recv({ id: OS.SendClientToggles, toggles: ['hotokey-enabled'] });
    session.optionsActions.useHotkey(5);
    expect(cancelled).toBe(0); expect(decoded()).toEqual([{ id: KC.UseHKeySlot, slot: 5 }]);
  });
  it('a dead player is told so and nothing is sent', () => {
    const { session, recv, decoded } = harness();
    recv({ id: OS.SendClientToggles, toggles: ['hotokey-enabled'] }, { id: 27, hp: 0, shield: 0 } as never);
    session.optionsActions.useHotkey(1);
    expect(decoded()).toEqual([]); expect(session.ui.messages.at(-1)).toBeDefined();
  });
  it('rejects slots outside 0..9 and spells below 1', () => {
    const { session, decoded } = harness();
    expect(session.optionsActions.setHotkey(10, 5, 1, 2)).toBe(false); expect(session.optionsActions.setHotkey(-1, 5, 1, 2)).toBe(false);
    expect(session.optionsActions.setHotkey(0, 0, 1, 2)).toBe(false);
    session.optionsActions.useHotkey(10); expect(decoded()).toEqual([]);
  });
  it('loadHotkeys sends all ten saved slots (empty ones as -1) and restores them; setHotkey persists per character', () => {
    const store = new MemoryStore();
    store.setItem(hotkeysKey('Aotest'), JSON.stringify([{ index: 9, lastKnownSlot: 2, type: 2 }]));
    store.setItem('ao.hotkeys.hide.v1', '1');
    const sent: unknown[] = [];
    const state = new OptionsState();
    const actions = new OptionsController({ send: p => sent.push(p), ready: () => true, dead: () => false, message: () => {}, cancelTargeting: () => {}, store }, state);
    actions.loadHotkeys('Aotest');
    expect(sent).toHaveLength(10);
    expect(sent[0]).toEqual({ id: OC.SetHotkeySlot, slot: 0, index: 9, lastKnownSlot: 2, type: 2 });
    expect(sent[1]).toEqual({ id: OC.SetHotkeySlot, slot: 1, index: -1, lastKnownSlot: -1, type: 3 });
    expect(state.hideHotkeys).toBe(true);
    actions.setHotkey(4, 14, 6, HotkeyType.Spell);
    expect(JSON.parse(store.getItem(hotkeysKey('Aotest'))!)[4]).toEqual({ index: 14, lastKnownSlot: 6, type: 2 });
    actions.toggleHide(); expect(store.getItem('ao.hotkeys.hide.v1')).toBe('0');
  });
  it('parseHotkeys survives hostile storage', () => {
    for (const raw of [null, '', 'nope', '{"a":1}', '[1,"x",null,{"index":"9"}]', '[{"index":99999999,"lastKnownSlot":1,"type":2}]']) {
      expect(parseHotkeys(raw)).toHaveLength(10); expect(parseHotkeys(raw).every(e => e.index === -1)).toBe(true);
    }
    expect(parseHotkeys('[{"index":3,"lastKnownSlot":1,"type":2}]')[0]).toEqual({ index: 3, lastKnownSlot: 1, type: 2 });
  });
  it('the bar geometry: slots start at x=188, 36 px apart, 45 px above the bottom of the 608 px renderer', () => {
    expect(hotkeySlotAt(189, 570)).toBe(0); expect(hotkeySlotAt(188, 570)).toBe(-1); expect(hotkeySlotAt(187 + 36 * 9 + 20, 570)).toBe(9);
    expect(hotkeySlotAt(548, 570)).toBe(-1); expect(hotkeySlotAt(300, 562)).toBe(-1); expect(hotkeySlotAt(300, 600)).toBe(-1);
  });
});

describe('Goliath Transferir (WriteTransFerGold)', () => {
  it('sends amount and destination exactly as the VB6 writer, trimmed, and nothing for empty input', () => {
    const { session, decoded } = harness();
    expect(session.optionsActions.transferGold(0, 'Aotest')).toBe(false); expect(session.optionsActions.transferGold(5, '  ')).toBe(false);
    expect(session.optionsActions.transferGold(1000, ' Aotest ')).toBe(true);
    expect(decoded()).toEqual([{ id: OC.TransFerGold, amount: 1000, username: 'Aotest' }]);
  });
});

describe('game options (frmOpciones)', () => {
  it('defaults, persistence and hostile stored values', () => {
    expect(DEFAULT_OPTIONS).toEqual({ showFps: false, moveWhileTyping: false, copyDialogToConsole: true });
    const store = new MemoryStore();
    const a = new OptionsSettings(store); const seen: unknown[] = []; a.subscribe(o => seen.push(o));
    a.update({ showFps: true });
    expect(JSON.parse(store.getItem(OPTIONS_KEY)!)).toEqual({ showFps: true, moveWhileTyping: false, copyDialogToConsole: true });
    expect(seen).toHaveLength(1); expect(new OptionsSettings(store).value.showFps).toBe(true);
    expect(sanitizeOptions({ showFps: 'yes', moveWhileTyping: 1, extra: true })).toEqual(DEFAULT_OPTIONS);
    store.setItem(OPTIONS_KEY, '{broken'); expect(new OptionsSettings(store).value).toEqual(DEFAULT_OPTIONS);
  });
});

describe('key bindings (frmCustomKeys)', () => {
  beforeEach(() => setActiveBindings(DEFAULTS_MODERN));
  it('the presets are DefaultKey.ini [DEFAULTS] and [DEFAULTSMODERN], 34 bindings each', () => {
    expect(Object.keys(DEFAULTS_CLASSIC)).toHaveLength(NUM_BINDS); expect(Object.keys(ACTION_LABELS)).toHaveLength(NUM_BINDS);
    expect([DEFAULTS_CLASSIC[KeyAction.Loot], DEFAULTS_CLASSIC[KeyAction.MoveUp], DEFAULTS_CLASSIC[KeyAction.ChangeSafe]]).toEqual([65, 38, 83]);
    expect([DEFAULTS_MODERN[KeyAction.Loot], DEFAULTS_MODERN[KeyAction.MoveUp], DEFAULTS_MODERN[KeyAction.ChangeSafe]]).toEqual([81, 87, 72]);
  });
  it('rebinding changes what keyAction answers; the old key stops working and a taken key is refused', () => {
    const store = new MemoryStore();
    const bindings = new KeyBindings(store);
    const draft = { ...bindings.table };
    expect(KeyBindings.taken(draft, vbKeyCode('KeyQ')!, KeyAction.Attack)).toBe(true);   // Q is Loot
    expect(KeyBindings.taken(draft, vbKeyCode('KeyQ')!, KeyAction.Loot)).toBe(false);    // its own key is fine
    expect(KeyBindings.taken(draft, vbKeyCode('KeyZ')!)).toBe(false);
    draft[KeyAction.Loot] = vbKeyCode('KeyZ')!;
    bindings.save(draft);
    expect(keyAction('KeyZ')).toBe(KeyAction.Loot); expect(keyAction('KeyQ')).toBeUndefined();
    expect(JSON.parse(store.getItem(BINDINGS_KEY)!)[KeyAction.Loot]).toBe(90);
    // a fresh client reads the saved layout
    setActiveBindings(DEFAULTS_MODERN);
    new KeyBindings(store); expect(keyAction('KeyZ')).toBe(KeyAction.Loot);
  });
  it('Clásica puts the arrows and A back; Restaurar forgets the saved layout', () => {
    const store = new MemoryStore(); const bindings = new KeyBindings(store);
    bindings.preset('classic');
    expect(keyAction('KeyA')).toBe(KeyAction.Loot); expect(keyAction('KeyW')).toBeUndefined(); expect(keyAction('ArrowUp')).toBe(KeyAction.MoveUp);
    expect(JSON.parse(store.getItem(BINDINGS_KEY)!)[KeyAction.Loot]).toBe(65);
    bindings.restore();
    expect(store.getItem(BINDINGS_KEY)).toBeNull(); expect(keyAction('KeyW')).toBe(KeyAction.MoveUp); expect(getActiveBindings()).toEqual(DEFAULTS_MODERN);
  });
  it('arrows keep walking unless they are bound to something else', () => {
    const table = { ...DEFAULTS_MODERN, [KeyAction.Loot]: 38 }; setActiveBindings(table);
    expect(keyAction('ArrowUp')).toBe(KeyAction.Loot); expect(keyAction('ArrowDown')).toBe(KeyAction.MoveDown);
  });
  it('a hostile or half-written saved value falls back to the defaults per binding', () => {
    for (const raw of [null, '', 'x', '[]', '{"1":"a","2":-5,"3":999,"4":1.5}']) expect(parseBindings(raw)).toEqual(DEFAULTS_MODERN);
    expect(parseBindings('{"2":65,"99":1}')[2]).toBe(65);
    expect(new KeyBindings({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => {} }).table).toEqual(DEFAULTS_MODERN);
  });
  it('names and hotkey labels follow frmCustomKeys.txConfig_KeyUp and modBindKeys.GetHotkeyLabel', () => {
    expect([keyName(17), keyName(112), keyName(106), keyName(87), keyName(96), keyName(38)]).toEqual(['Control', 'F1', '*', 'W', 'Numerico 0', 'Flecha Arriba']);
    expect([hotkeyLabel(49), hotkeyLabel(46), hotkeyLabel(97), hotkeyLabel(17), hotkeyLabel(0), hotkeyLabel(117)]).toEqual(['1', 'Supr', 'N1', 'Ctrl', '', 'F6']);
    expect(vbKeyCode('Numpad5')).toBe(101); expect(vbKeyCode('Space')).toBe(32);
  });
});
