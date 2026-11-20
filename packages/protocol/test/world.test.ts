import { describe, expect, it } from 'vitest';
import { decodeClientPacket, decodeServerPacket, encodeClientPacket, encodeServerPacket, AudioServerPacketId as A, WorldClientPacketId as C, WorldServerPacketId as S } from '../src/index.js';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
const roundTrip = (h: string) => { const p = decodeServerPacket(bytes(h)); expect(hex(encodeServerPacket(p as never))).toBe(h); return p; };

describe('world FX packets (VB6 writer field order)', () => {
  // Bytes recorded from the VB6 server (tests/fixtures/vb6/world-fx and the older fixtures).
  it('Hora: elapsed Int32 then day length Int32 (PrepareMessageHora)', () => {
    expect(roundTrip('7500' + 'a6672600' + '00dd6d00')).toEqual({ id: S.Hora, elapsedMs: 2516902, dayLenMs: 7200000 });
  });
  it('AreaChanged x, y; NieblaToggle carries the maximum alpha only', () => {
    expect(roundTrip('3900' + '4826')).toEqual({ id: S.AreaChanged, x: 72, y: 38 });
    expect(roundTrip('7b00' + '2b')).toEqual({ id: S.NieblaToggle, maxAlpha: 43 });
  });
  it('SpeedToChar is charIndex Int16 + Real32; AuraToChar is charIndex, String8, Remove, type', () => {
    expect(roundTrip('7800' + 'e813' + '0000803f')).toEqual({ id: S.SpeedToChar, charIndex: 5096, speeding: 1 });
    expect(roundTrip('7700' + 'e913' + '0130' + '01' + '02')).toEqual({ id: S.AuraToChar, charIndex: 5097, aura: '0', remove: true, type: 2 });
  });
  it('RainToggle / NieveToggle are one Boolean; PauseToggle has no payload', () => {
    expect(roundTrip('3b00' + '01')).toEqual({ id: A.RainToggle, raining: true });
    expect(roundTrip('7a00' + '00')).toEqual({ id: A.NieveToggle, snowing: false });
    expect(roundTrip('3a00')).toEqual({ id: S.PauseToggle });
  });
  it('LightToFloor is x, y, colour Int32, range; Light is the map base light as String8', () => {
    expect(roundTrip('7900' + '2140' + '3030ff00' + '69')).toEqual({ id: S.LightToFloor, x: 33, y: 64, color: 0x00ff3030, range: 105 });
    expect(roundTrip('7600' + '0130')).toEqual({ id: S.Light, baseLight: '0' });
  });
  it('rejects a second packet in the same frame and truncated payloads', () => {
    expect(() => decodeServerPacket(bytes('3b00' + '0101'))).toThrow();
    expect(() => decodeServerPacket(bytes('7500' + 'a6672600'))).toThrow();
  });
  it('the GM weather switches are bare ids', () => {
    for (const id of [C.RainToggle, C.NieveToggle, C.NieblaToggle]) {
      const body = encodeClientPacket({ id } as never);
      expect(body.length).toBe(2);
      expect(decodeClientPacket(body)).toEqual({ id });
    }
  });
});
