import { readFileSync } from 'node:fs';
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

// Real recordings (tests/fixtures/vb6/audio, #28): the bytes the VB6 server actually sent.
const recorded = (file: string, id: number) => readFileSync(new URL(`../../../tests/fixtures/vb6/audio/${file}`, import.meta.url), 'utf8').trim().split('\n')
  .map(line => JSON.parse(line) as { dir: string; id: number; hex: string }).filter(r => r.dir === 's2c' && r.id === id).map(r => decodeServerPacket(bytes(r.hex)));
describe('audio packets as the real VB6 server sends them', () => {
  it('PlayMIDI from /FORCEMIDIMAP 5 and /FORCEMIDIMAP 0 (map 1 music_numberLow 4): loops is the default -1', () => {
    expect(recorded('force-midi-map.jsonl', A.PlayMIDI)).toEqual([{ id: A.PlayMIDI, file: 5, loop: -1 }, { id: A.PlayMIDI, file: 4, loop: -1 }]);
  });
  it('PlayWaveStep of an invisible walker: the first step, three tiles east of the watcher (Grh 6002 under it)', () => {
    const steps = recorded('invisible-walker-steps.jsonl', A.PlayWaveStep);
    expect(steps.length).toBe(17);
    expect(steps[0]).toEqual({ id: A.PlayWaveStep, charIndex: 0x1537, grh: 6002, grh2: 0, distance: 3, balance: 1, step: false });
  });
});
