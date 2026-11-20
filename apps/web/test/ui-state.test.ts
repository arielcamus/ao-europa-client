import { describe, expect, it } from 'vitest';
import { ServerPacketId as S, ClientPacketId as C, FrameDecoder, decodeClientPacket, encodeServerFrame } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { ClassicState } from '../src/ui-state.js';
import { Session } from '../src/session.js';

describe('classic UI packet state', () => {
  it('keeps missing stats unknown, applies snapshots and partial updates without losing maxima', () => {
    const ui = new ClassicState();
    expect(ui.stats.hp).toBeUndefined();
    ui.receive(f.UpdateUserStats); ui.receive({ id: S.UpdateHP, hp: 0, shield: 0 });
    ui.receive({ id: S.UpdateMana, mana: 30 }); ui.receive({ id: S.UpdateGold, gold: 42, goldPerLevel: 10 });
    expect(ui.stats).toMatchObject({ maxHp: 100, hp: 0, maxMana: 80, mana: 30, gold: 42, goldPerLevel: 10, experience: 25 });
    ui.receive(f.UpdateHungerAndThirst);
    expect(ui.food).toMatchObject({ maxWater: 100, water: 75, maxFood: 100, food: 85 });
  });
  it('replaces and removes inventory slots, accepts spell slot 40, and rejects out-of-range slots', () => {
    const ui = new ClassicState(); ui.receive(f.ChangeInventorySlot);
    expect(ui.inventory.get(42)?.object).toBe(2);
    ui.receive({ ...f.ChangeInventorySlot, amount: 0 }); expect(ui.inventory.size).toBe(0);
    ui.receive(f.ChangeSpellSlot); expect(ui.spells.get(40)?.index).toBe(-1);
    expect(() => ui.receive({ ...f.ChangeInventorySlot, slot: 43 })).toThrow('Invalid inventory slot');
    expect(() => ui.receive({ ...f.ChangeSpellSlot, slot: 41 })).toThrow('Invalid spell slot');
    ui.receive({ id: S.InventoryUnlockSlots, rows: 255 }); expect(ui.unlockedRows).toBe(3);
  });
  it('bounds console history and preserves server text without interpreting HTML', () => {
    const ui = new ClassicState();
    for (let i = 0; i < 205; i++) ui.message(String(i));
    ui.receive({ ...f.ConsoleMsg, message: '<img src=x onerror=alert(1)> ñ' });
    expect(ui.messages).toHaveLength(200);
    expect(ui.messages[0]?.text).toBe('6');
    expect(ui.messages.at(-1)?.text).toBe('<img src=x onerror=alert(1)> ñ');
  });
  it('paces chat, enforces UTF-8 byte limits, uses a separate counter and clears state on a new session', () => {
    let now = 0;
    const sent: Uint8Array[] = [];
    const session = new Session({ email: 'a', password: 'b' }, bytes => sent.push(bytes), () => now);
    expect(session.talk('Hola')).toBe(false);
    for (const packet of [f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap, f.CharacterCreate, f.UserCharIndexInServer, f.Logged, f.ChangeInventorySlot]) session.receive(encodeServerFrame(packet));
    expect(session.talk('🙂'.repeat(70))).toBe(false);
    expect(session.talk('Hola ñ')).toBe(true); expect(session.talk('Hola')).toBe(false);
    now = 501; expect(session.talk('Otra vez')).toBe(true);
    const decoder = new FrameDecoder();
    const packets = sent.flatMap(bytes => decoder.push(bytes)).map(decodeClientPacket).filter(packet => packet.id === C.Talk);
    expect(packets).toEqual([{ id: C.Talk, message: 'Hola ñ', counter: 1 }, { id: C.Talk, message: 'Otra vez', counter: 2 }]);
    session.finish(); expect(session.talk('Adiós')).toBe(false);
    const fresh = new Session({ email: 'a', password: 'b' }, () => {});
    expect(fresh.ui.inventory.size).toBe(0); expect(fresh.ui.messages).toHaveLength(0);
  });
});
