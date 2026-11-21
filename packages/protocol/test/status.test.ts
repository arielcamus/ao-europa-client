import { describe, expect, it } from 'vitest';
import { decodeClientPacket, decodeServerPacket, encodeClientPacket, encodeServerPacket, StatusClientPacketId as C, StatusServerPacketId as S } from '../src/index.js';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
const roundTrip = (h: string) => { const p = decodeServerPacket(bytes(h)); expect(hex(encodeServerPacket(p as never))).toBe(h); return p; };

describe('combat status packets (VB6 writer field order, ids from PacketId.bas)', () => {
  it('payload-free server packets', () => {
    for (const [name, id] of Object.entries({ NPCKillUser: 16, BlockedWithShieldUser: 17, BlockedWithShieldOther: 18, PartySafeOn: 22, PartySafeOff: 23, Blind: 74, Dumb: 75, BlindNoMore: 85, DumbNoMore: 86, ParalizeOK: 97, InmovilizadoOK: 139 })) {
      expect(S[name as keyof typeof S]).toBe(id);
      expect(roundTrip(id.toString(16).padStart(2, '0') + '00')).toEqual({ id });
    }
  });
  it('SetInvisible: charIndex Int16, Bool, x, y (PrepareMessageSetInvisible)', () => {
    expect(roundTrip('5300' + 'e813' + '01' + '2043')).toEqual({ id: S.SetInvisible, charIndex: 5096, invisible: true, x: 32, y: 67 });
  });
  it('StunStart Int16; UpdateCooldownType Int8; CharUpdateMAN Int16 + 2 x Int32', () => {
    expect(roundTrip('6200' + 'b80b')).toEqual({ id: S.StunStart, duration: 3000 });
    expect(roundTrip('6a00' + '02')).toEqual({ id: S.UpdateCooldownType, cdType: 2 });
    expect(roundTrip('9700' + '0100' + '32000000' + '2d000000')).toEqual({ id: S.CharUpdateMAN, charIndex: 1, mana: 50, maxMana: 45 });
  });
  it('BarFx charIndex, time Int16, action; EscudoMov; DoAnimation charIndex + body', () => {
    expect(roundTrip('8c00' + '0500' + 'bc02' + '03')).toEqual({ id: S.BarFx, charIndex: 5, barTime: 700, action: 3 });
    expect(roundTrip('9200' + '0500')).toEqual({ id: S.EscudoMov, charIndex: 5 });
    expect(roundTrip('a700' + '0500' + '3d03')).toEqual({ id: S.DoAnimation, charIndex: 5, animation: 829 });
  });
  it('safes and Stopped carry one Boolean; UpdateTrap is state, x, y', () => {
    expect(roundTrip('9d00' + '01')).toEqual({ id: S.ClanSeguro, enabled: true });
    expect(roundTrip('a200' + '00')).toEqual({ id: S.SeguroResu, enabled: false });
    expect(roundTrip('a300' + '01')).toEqual({ id: S.LegionarySecure, enabled: true });
    expect(roundTrip('a400' + '01')).toEqual({ id: S.Stopped, stopped: true });
    expect(roundTrip('c000' + '01' + '2043')).toEqual({ id: S.UpdateTrap, state: 1, x: 32, y: 67 });
  });
  it('client toggles have no payload', () => {
    for (const id of [C.UseSpellMacro, C.SeguroClan, C.SeguroResu, C.LegionarySecure]) {
      const frame = encodeClientPacket({ id } as never);
      expect(hex(frame)).toBe((id & 255).toString(16).padStart(2, '0') + (id >> 8).toString(16).padStart(2, '0'));
      expect(decodeClientPacket(frame)).toEqual({ id });
    }
  });
});
