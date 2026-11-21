import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HOTKEY_TOGGLE, HotkeyType, KeysClientPacketId as KC, OptionsClientPacketId as OC, OptionsServerPacketId as OS,
  decodeClientPacket, decodeServerPacket, encodeClientPacket, encodeServerPacket,
} from '../src/index.js';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const bytes = (value: string) => Uint8Array.from(Buffer.from(value, 'hex'));
interface Line { dir: 'c2s' | 's2c'; id: number; name: string; hex: string }
const load = (file: string): Line[] => readFileSync(new URL(`../../../tests/fixtures/vb6/${file}`, import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l));

describe('options packets recorded from the VB6 server', () => {
  it('BindKeys (136) and SendClientToggles (195) from a real login decode and re-encode to the same bytes', () => {
    const login = load('chat/login.jsonl');
    const bindKeys = login.find(l => l.dir === 's2c' && l.id === OS.BindKeys)!, toggles = login.find(l => l.dir === 's2c' && l.id === OS.SendClientToggles)!;
    expect(bindKeys.hex).toBe('88000101');
    expect(decodeServerPacket(bytes(bindKeys.hex))).toEqual({ id: 136, chatCombat: 1, chatGlobal: 1 });
    expect(hex(encodeServerPacket(decodeServerPacket(bytes(toggles.hex)) as never))).toBe(toggles.hex);
    const decoded = decodeServerPacket(bytes(toggles.hex)) as { toggles: string[] };
    expect(decoded.toggles).toHaveLength(16);
    expect(decoded.toggles).toContain(HOTKEY_TOGGLE);
    expect(decoded.toggles[0]).toBe('bandit_unequip_bonus');
  });
  it('client frames follow the VB6 writer field order (Protocol_Writes.bas)', () => {
    // WriteSetHotkeySlot: id Int16, slot Int8, Index Int16, LastKnownSlot Int16, type Int8
    expect(hex(encodeClientPacket({ id: OC.SetHotkeySlot, slot: 2, index: 11, lastKnownSlot: 3, type: HotkeyType.Spell }))).toBe('2c01' + '02' + '0b00' + '0300' + '02');
    expect(decodeClientPacket(bytes('2c010a0000ffff03'))).toEqual({ id: 300, slot: 10, index: 0, lastKnownSlot: -1, type: 3 } as never);
    // WriteTransFerGold: id Int16, Amount Int32, destino String8
    expect(hex(encodeClientPacket({ id: OC.TransFerGold, amount: 1000, username: 'Aotest' }))).toBe('e000' + 'e8030000' + '06' + Buffer.from('Aotest').toString('hex'));
    expect(decodeClientPacket(bytes('e000e803000006416f74657374'))).toEqual({ id: 224, amount: 1000, username: 'Aotest' });
    // WriteUseHKeySlot (keys.ts): id Int16, slot Int8
    expect(hex(encodeClientPacket({ id: KC.UseHKeySlot, slot: 4 }))).toBe('2d0104');
  });
  it('rejects trailing bytes (a frame holds exactly one packet)', () => {
    expect(() => decodeClientPacket(bytes('e000e803000006416f7465737400'))).toThrow();
  });
});
