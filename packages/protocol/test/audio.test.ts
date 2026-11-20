import { describe, expect, it } from 'vitest';
import { AudioServerPacketId as A, codecTables, decodeServerPacket, encodeServerPacket } from '../src/index.js';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex.replaceAll(' ', ''), 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');

// Frame bodies written by hand from the VB6 server writers (Protocol_Writes.bas), little endian, id first.
const server = [
  ['PlayMIDI', '3600 05 e803', { id: A.PlayMIDI, file: 5, loop: 1000 }],
  ['RainToggle on', '3b00 01', { id: A.RainToggle, raining: true }],
  ['RainToggle off', '3b00 00', { id: A.RainToggle, raining: false }],
  ['NieveToggle', '7a00 01', { id: A.NieveToggle, snowing: true }],
  // WritePlayWaveStep: charindex Int16, Grh Int32, Grh2 Int32, Distance Byte, balance Int16, step Bool
  ['PlayWaveStep', 'bc00 0700 e8030000 00000000 03 ffff 01', { id: A.PlayWaveStep, charIndex: 7, grh: 1000, grh2: 0, distance: 3, balance: -1, step: true }],
] as const;

describe('audio and weather packet codecs (hand-derived VB6 bytes)', () => {
  for (const [name, body, packet] of server) {
    it(`S->C ${name} round trips`, () => {
      expect(hex(encodeServerPacket(packet as never))).toBe(body.replaceAll(' ', ''));
      expect(decodeServerPacket(bytes(body))).toEqual(packet);
    });
  }
  it('uses the enum order of PacketId.bas and leaves PlayWave (55) to the spells table', () => {
    expect([A.PlayMIDI, A.RainToggle, A.NieveToggle, A.PlayWaveStep]).toEqual([54, 59, 122, 188]);
    expect(Object.keys(codecTables.server.audio).map(Number)).not.toContain(55);
  });
});
