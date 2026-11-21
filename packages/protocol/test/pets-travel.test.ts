import { describe, expect, it } from 'vitest';
import { decodeClientPacket, decodeServerPacket, encodeClientPacket, encodeServerPacket, PetsTravelClientPacketId as PC, PetsTravelServerPacketId as PS } from '../src/index.js';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
const ascii = (text: string) => Buffer.from(text).toString('hex');

describe('pet commands (client WritePetStand/Follow/Leave/FollowAll/LeaveAll: the id and nothing else)', () => {
  it.each([['PetStand', 42, '2a00'], ['PetFollow', 43, '2b00'], ['PetLeave', 44, '2c00'], ['PetLeaveAll', 282, '1a01'], ['PetFollowAll', 309, '3501']] as const)('%s', (name, id, golden) => {
    expect(PC[name]).toBe(id);
    expect(hex(encodeClientPacket({ id } as never))).toBe(golden);
    expect(decodeClientPacket(bytes(golden))).toEqual({ id });
    expect(() => decodeClientPacket(bytes(golden + '00'))).toThrow();
  });
});

describe('travel (server WriteViajarForm, client WriteCompletarViaje)', () => {
  // count=2, String8 "Nix-1000" and "Lindos-Ullathorpe-250" (split at the LAST dash), Interface=1. String8 is an varint length then the bytes.
  const form = '9300' + '02' + '08' + ascii('Nix-1000') + '15' + ascii('Lindos-Ullathorpe-250') + '01';
  it('ViajarForm round trips, splitting at the last dash', () => {
    expect(PS.ViajarForm).toBe(147);
    const packet = decodeServerPacket(bytes(form));
    expect(packet).toEqual({ id: 147, destinations: [{ city: 'Nix', cost: 1000 }, { city: 'Lindos-Ullathorpe', cost: 250 }], interface: 1 });
    expect(hex(encodeServerPacket(packet as never))).toBe(form);
  });
  it('ViajarForm with no destinations is count 0 plus the interface byte', () => {
    expect(decodeServerPacket(bytes('93000002'))).toEqual({ id: 147, destinations: [], interface: 2 });
    expect(() => decodeServerPacket(bytes('930002'))).toThrow();
  });
  it('rejects a destination with no dash or a non-numeric price', () => {
    expect(() => decodeServerPacket(bytes('9300' + '01' + '03' + ascii('Nix') + '00'))).toThrow();
    expect(() => decodeServerPacket(bytes('9300' + '01' + '06' + ascii('Nix-ab') + '00'))).toThrow();
  });
  it('CompletarViaje is destination Int8 then cost Int32', () => {
    const golden = 'fc00' + '02' + 'e8030000';
    expect(hex(encodeClientPacket({ id: PC.CompletarViaje, destination: 2, cost: 1000 }))).toBe(golden);
    expect(decodeClientPacket(bytes(golden))).toEqual({ id: 252, destination: 2, cost: 1000 });
    expect(() => decodeClientPacket(bytes('fc0002'))).toThrow();
  });
});
