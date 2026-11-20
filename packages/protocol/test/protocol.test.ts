import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  Reader, Writer, FrameDecoder, encodeFrame, decodeClientPacket, decodeServerPacket,
  encodeClientFrame, encodeServerFrame, encodeServerPacket, MAX_FRAME_BODY,
} from '../src/index.js';
import { clientFixtures, serverFixtures } from './fixtures.js';

// Frozen output of the independent C++ oracle, never regenerated during tests.
const goldens = JSON.parse(readFileSync(new URL('./goldens.json', import.meta.url), 'utf8')) as Record<string, string>;
const bytes = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, 'hex'));
const golden = (name: string): Uint8Array => bytes(goldens[name]!);
const hex = (value: Uint8Array): string => Buffer.from(value).toString('hex');

describe('Aurora C++ primitive goldens', () => {
  for (const [name, expected] of Object.entries(goldens).filter(([name]) => name.startsWith('int:'))) {
    const value = Number(name.slice(4));
    it(`COM WriteInt(${value})`, () => {
      expect(hex(new Writer().writeInt(value).toBytes())).toBe(expected);
      const reader = new Reader(bytes(expected));
      expect(reader.readInt()).toBe(value < 0 ? value & 0x7f : value);
      reader.end();
    });
  }

  it('uses LE fixed integers, one-byte bools, float32 and UTF-8 BYTE lengths', () => {
    const value = new Writer().writeBool(false).writeBool(true).writeInt8(255)
      .writeInt16(-32768).writeInt16(32767).writeInt32(-2147483648).writeInt32(2147483647)
      .writeReal32(1.5).writeString('').writeString('\0').writeString('ñ🙂').toBytes();
    expect(hex(value)).toBe(goldens.primitives);
    const reader = new Reader(golden('primitives'));
    expect([reader.readBool(), reader.readBool(), reader.readInt8(), reader.readInt16(),
      reader.readInt16(), reader.readInt32(), reader.readInt32(), reader.readReal32(),
      reader.readString(), reader.readString(), reader.readString()])
      .toEqual([false, true, 255, -32768, 32767, -2147483648, 2147483647, 1.5, '', '\0', 'ñ🙂']);
    reader.end();
  });

  it('writes a multibyte string length across the 127-byte boundary', () => {
    const value = new Writer().writeString('ñ'.repeat(64)).toBytes();
    expect([...value.slice(0, 2)]).toEqual([0x80, 0x01]);
    expect(value.length).toBe(130);
    expect(new Reader(value).readString()).toBe('ñ'.repeat(64));
  });

  it('preserves raw COM dimension order and unsigned lower-bound casts', () => {
    const value = { bounds: [{ lowerBound: -1, count: 2 }, { lowerBound: 7, count: 3 }], data: bytes('090807060504') };
    expect(hex(new Writer().writeSafeArrayInt8(value).toBytes())).toBe(goldens.safeArray);
    expect(new Reader(golden('safeArray')).readSafeArrayInt8()).toEqual(value);
  });

  it('rejects truncated fields, corrupt lengths, invalid UTF-8 and overflowing varints', () => {
    for (const input of ['80', 'ffffffff1f', '808080808000']) {
      expect(() => new Reader(bytes(input)).readInt()).toThrow();
    }
    expect(() => new Reader(bytes('01')).readInt16()).toThrow(/Truncated/);
    expect(() => new Reader(bytes('0361')).readString()).toThrow(/Truncated/);
    expect(() => new Reader(bytes('01ff')).readString()).toThrow(/UTF-8/);
    expect(() => new Reader(bytes('ff')).readBool()).toThrow(/bool/);
    expect(() => new Reader(bytes('ffffffff0f')).readSafeArrayInt8()).toThrow(/dimensions/);
    expect(() => new Reader(bytes('01010a01')).readSafeArrayInt8()).toThrow(/Truncated/);
    expect(() => new Reader(bytes('0200ffffffff0f00ffffffff0f')).readSafeArrayInt8()).toThrow(/overflow/);
    expect(() => new Writer().writeSafeArrayInt8({ bounds: [{ lowerBound: 1, count: 2 }], data: bytes('01') })).toThrow(/mismatch/);
    expect(() => new Writer().writeInt8(256)).toThrow();
    expect(() => new Writer().writeInt16(32768)).toThrow();
    expect(() => new Writer().writeInt(2147483648)).toThrow();
  });
});

describe('VB6 paired writer/reader field layouts against C++ goldens', () => {
  for (const [name, packet] of Object.entries(clientFixtures)) {
    it(`client ${name}`, () => {
      expect(hex(encodeClientFrame(packet))).toBe(goldens[name]);
      expect(decodeClientPacket(golden(name).slice(2))).toEqual(packet);
    });
  }
  for (const [name, packet] of Object.entries(serverFixtures)) {
    it(`server ${name}`, () => {
      expect(hex(encodeServerFrame(packet))).toBe(goldens[name]);
      expect(decodeServerPacket(golden(name).slice(2))).toEqual(packet);
    });
  }

  it('rejects every truncated known layout and any extra packet in the same frame', () => {
    for (const [name] of Object.entries(serverFixtures)) {
      const body = golden(name).slice(2);
      for (let length = 0; length < body.length; length++) {
        // A 2-byte Connected body is the valid non-debug variant.
        if (name === 'ConnectedDebug' && length === 2) continue;
        expect(() => decodeServerPacket(body.slice(0, length)), `${name} length=${length}`).toThrow();
      }
      expect(() => decodeServerPacket(bytes(hex(body) + '020000'))).toThrow(/id=/);
    }
    for (const [name] of Object.entries(clientFixtures)) {
      const body = golden(name).slice(2);
      for (let length = 0; length < body.length; length++) {
        expect(() => decodeClientPacket(body.slice(0, length))).toThrow();
      }
      expect(() => decodeClientPacket(bytes(hex(body) + '00'))).toThrow(/trailing/);
    }
  });

  it('validates Connected debug values and rejects unreasonable account counts', () => {
    const body = golden('ConnectedDebug').slice(2);
    body[body.length - 1] = 11;
    expect(() => decodeServerPacket(body)).toThrow(/id=1.*SAFEARRAY/);
    expect(() => decodeServerPacket(bytes('c700ffffffff07'))).toThrow(/count/);
  });
});

describe('TCP byte accumulation', () => {
  const stream = bytes(goldens.ConnectedDebug! + goldens.AccountCharacterList! + goldens.CharacterCreate!);

  it('handles every possible split, coalesced frames, and byte-at-a-time input', () => {
    const expected = ['ConnectedDebug', 'AccountCharacterList', 'CharacterCreate'].map(name => golden(name).slice(2));
    for (let split = 0; split <= stream.length; split++) {
      const decoder = new FrameDecoder();
      expect([...decoder.push(stream.slice(0, split)), ...decoder.push(stream.slice(split))]).toEqual(expected);
      decoder.finish();
    }
    const decoder = new FrameDecoder();
    expect([...stream].flatMap(byte => decoder.push(Uint8Array.of(byte)))).toEqual(expected);
    expect(decoder.pendingBytes).toBe(0);
  });

  it('skips unknown frame payload by the envelope size, preserving the next packet', () => {
    const decoder = new FrameDecoder();
    const frames = decoder.push(bytes('0600307501000200' + goldens.Logged));
    expect(decodeServerPacket(frames[0]!)).toEqual({ unknown: true, id: 30000, payload: bytes('01000200') });
    expect(decodeServerPacket(frames[1]!)).toEqual(serverFixtures.Logged);
  });

  it('retains partial tails, reports the packet ID on EOF, and never resynchronizes by guessing', () => {
    const decoder = new FrameDecoder();
    expect(decoder.push(bytes(goldens.Logged! + '0800310101'))).toHaveLength(1);
    expect(decoder.pendingBytes).toBe(5);
    expect(() => decoder.finish()).toThrow(/Truncated frame.*id=305/);
    expect(() => decoder.push(golden('Logged'))).toThrow(/stopped/);
    const header = new FrameDecoder();
    header.push(bytes('03'));
    expect(() => header.finish()).toThrow(/id=unavailable/);
    for (const invalid of ['0000', '0100']) {
      expect(() => new FrameDecoder().push(bytes(invalid))).toThrow(/length/);
    }
  });

  it('supports maximum uint16 bodies and rejects oversized/ID-less frames', () => {
    const body = new Uint8Array(MAX_FRAME_BODY).fill(7);
    const frame = encodeFrame(body);
    expect([...frame.slice(0, 2)]).toEqual([255, 255]);
    expect(new FrameDecoder().push(frame)).toEqual([body]);
    expect(() => encodeFrame(new Uint8Array(MAX_FRAME_BODY + 1))).toThrow();
    expect(() => encodeFrame(new Uint8Array(1))).toThrow();
  });

  it('does not retain borrowed caller memory', () => {
    const decoder = new FrameDecoder();
    const chunk = encodeServerFrame(serverFixtures.Logged);
    decoder.push(chunk.slice(0, 3));
    const frames = decoder.push(chunk.slice(3));
    chunk.fill(0);
    decoder.push(encodeServerFrame(serverFixtures.Connected));
    expect(frames[0]).toEqual(encodeServerPacket(serverFixtures.Logged));
  });
});
