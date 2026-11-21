import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FrameDecoder, DoorClientPacketId as NC, NpcsServerPacketId as NS, decodeClientPacket, decodeServerPacket,
  encodeClientPacket, encodeServerPacket,
} from '../src/index.js';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');

/**
 * Goldens: the first three are bytes captured from the real VB6 server (2026-11-20, see
 * tests/fixtures/vb6/npcs); the others are written by hand from the field order of the
 * server Prepare* procedures and checked against the client Handle* readers.
 */
const server = [
  ['CharacterRemove (real VB6)', '2b00fa090100', { id: NS.CharacterRemove, charIndex: 0x09fa, vanish: true, warp: false }],
  ['RemoveCharDialog (real VB6)', '0400fa09', { id: NS.RemoveCharDialog, charIndex: 0x09fa }],
  ['LocaleMsg (real VB6)', '8d000a0206416f746573740800', { id: NS.LocaleMsg, messageId: 522, text: 'Aotest', font: 8, channel: 0 }],
  ['RemoveDialogs', '0300', { id: NS.RemoveDialogs }],
  ['ChatOverHead', '23000648c3b36cc3a00200ffffff000001020a00d007', { id: NS.ChatOverHead, chat: 'Hólà', charIndex: 2, color: 0x00ffffff, isSpell: false, x: 1, y: 2, minChatTime: 10, maxChatTime: 2000 }],
  ['LocaleChatOverHead', '2400580204616263010100ff00000000000000000000', { id: NS.LocaleChatOverHead, chatId: 600, params: 'abc\u0001', charIndex: 1, color: 0x000000ff, isSpell: false, x: 0, y: 0, minChatTime: 0, maxChatTime: 0 }],
  
] as const;

describe('npcs server packets', () => {
  for (const [name, golden, packet] of server) {
    if (!packet) continue;
    it(`${name} decodes and re-encodes to the golden bytes`, () => {
      expect(decodeServerPacket(bytes(golden))).toEqual(packet);
      expect(hex(encodeServerPacket(packet as never))).toBe(golden);
    });
  }
  it('CharacterChange follows the server writer: index, flags, body, head, heading, weapon, shield, helmet, cart, backpack, fx, loops', () => {
    const packet = { id: NS.CharacterChange, charIndex: 0x09fa, flags: 3, body: 107, head: 1, heading: 3, weapon: 5, shield: 6, helmet: 7, cart: 0, backpack: 9, fx: 0, fxLoops: -1 } as const;
    const golden = '3100fa09036b00010003050006000700000009000000ffff';
    expect(hex(encodeServerPacket(packet))).toBe(golden);
    expect(decodeServerPacket(bytes(golden))).toEqual(packet);
  });
  it('LocaleMsg without a channel byte (older writers) still decodes', () => {
    expect(decodeServerPacket(bytes('8d0001000178 03'.replace(' ', '')))).toEqual({ id: NS.LocaleMsg, messageId: 1, text: 'x', font: 3 });
  });
  it('rejects truncated and trailing bytes with the packet id in the error', () => {
    expect(() => decodeServerPacket(bytes('2b00fa0901'))).toThrow('id=43');
    expect(() => decodeServerPacket(bytes('2b00fa09010000'))).toThrow('id=43');
  });
});

describe('npcs client packets', () => {
  it('LeftClick: x, y and its own counter', () => {
    const packet = { id: NC.LeftClick, x: 58, y: 44, counter: 0x01020304 } as const;
    const golden = '5f003a2c04030201';
    expect(hex(encodeClientPacket(packet))).toBe(golden);
    expect(decodeClientPacket(bytes(golden))).toEqual(packet);
  });
});

describe('recorded VB6 sessions', () => {
  const directory = new URL('../../../tests/fixtures/vb6/npcs/', import.meta.url);
  const files = existsSync(directory) ? readdirSync(directory).filter(name => name.endsWith('.jsonl')) : [];
  it('has at least one recording per sub-feature', () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
  });
  for (const file of files) {
    it(`${file}: every npcs packet decodes and re-encodes byte for byte`, () => {
      const lines = readFileSync(new URL(file, directory), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { dir: string; id: number; hex: string });
      let checked = 0;
      for (const { dir, id, hex: body } of lines) {
        const known = dir === 's2c' ? Object.values(NS).includes(id) : id === NC.LeftClick;
        if (!known) continue;
        const frame = bytes(body);
        if (dir === 's2c') {
          const packet = decodeServerPacket(frame);
          expect('unknown' in packet).toBe(false);
          expect(hex(encodeServerPacket(packet as never))).toBe(body);
        } else {
          expect(hex(encodeClientPacket(decodeClientPacket(frame) as never))).toBe(body);
        }
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
  it('frames split across chunks reassemble', () => {
    const decoder = new FrameDecoder();
    const frame = bytes('06002b00fa090100');
    expect(decoder.push(frame.subarray(0, 3))).toEqual([]);
    expect(decoder.push(frame.subarray(3)).map(hex)).toEqual(['2b00fa090100']);
  });
});

describe('String8 carries accents and ñ ¿ ¡ as UTF-8 (the Aurora COM writer converts the BSTR to CP_UTF8)', () => {
  const text = 'Ámora <Pescadora de Forgat>: ¿Qué quieres, niño? ¡Vigía!';
  const speech = { id: NS.ChatOverHead, chat: text, charIndex: 5, color: 0xff00ff, isSpell: false, x: 10, y: 12, minChatTime: 100, maxChatTime: 300 };
  it('ChatOverHead puts accented text on the wire as UTF-8 and reads it back', () => {
    const body = encodeServerPacket(speech as never);
    expect(hex(body)).toContain('c3816d6f7261'); // "Ámora"
    expect(hex(body)).toContain('c2bf'); // ¿
    expect(hex(body)).toContain('c3b1'); // ñ
    expect(decodeServerPacket(body)).toMatchObject({ id: NS.ChatOverHead, chat: text });
  });
  it('decodes accented text from UTF-8 bytes written by hand (not produced by our own writer)', () => {
    // id 35 (Int16), then "¿Qué?" = 7 UTF-8 bytes, charIndex 1, color 0, isSpell 0, x 0, y 0, min 0, max 0
    const body = bytes('2300' + '07' + 'c2bf5175c3a93f' + '0100' + '00000000' + '00' + '00' + '00' + '0000' + '0000');
    expect(decodeServerPacket(body)).toMatchObject({ id: NS.ChatOverHead, chat: '¿Qué?' });
  });
  it('raw windows-1252 bytes in a String8 are rejected, as PROTOCOL.md documents (the live server never sends them)', () => {
    const body = bytes('2300' + '01' + 'e9' + '0100' + '00000000' + '00' + '00' + '00' + '0000' + '0000');
    expect(() => decodeServerPacket(body)).toThrow(/Invalid UTF-8/);
  });
});
