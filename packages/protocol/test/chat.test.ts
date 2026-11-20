import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ClientPacketId as C, ServerPacketId as S, decodeClientPacket, decodeServerPacket,
  encodeClientPacket, encodeServerPacket, toVbColor, vbColor,
} from '../src/index.js';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex.replaceAll(' ', ''), 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');

// Golden bytes written by hand from the VB6 writers (server Protocol_Writes.bas Prepare*, client
// Protocol_Writes.bas Write*): fixed little-endian integers, String8 = varint byte length + UTF-8.
const overHead = '23 00  02 48 69  34 12  ff 80 00 00  01  05  06  02 01  04 03';
const serverGoldens = [
  { name: 'RemoveDialogs (WriteRemoveAllDialogs)', hex: '03 00', packet: { id: S.RemoveDialogs } },
  { name: 'RemoveCharDialog (PrepareMessageRemoveCharDialog)', hex: '04 00  34 12', packet: { id: S.RemoveCharDialog, charIndex: 0x1234 } },
  { name: 'ChatOverHead (PrepareMessageChatOverHead)', hex: overHead,
    packet: { id: S.ChatOverHead, chat: 'Hi', charIndex: 0x1234, color: toVbColor(255, 128, 0), isSpell: true, x: 5, y: 6, minTime: 0x0102, maxTime: 0x0304 } },
  { name: 'LocaleChatOverHead (PrepareLocaleChatOverHead)', hex: '24 00  2a 08  03 61 c3 b1  34 12  00 00 ff 00  00  00  00  00 00  00 00',
    packet: { id: S.LocaleChatOverHead, chatId: 0x082a, params: 'añ', charIndex: 0x1234, color: toVbColor(0, 0, 255), isSpell: false, x: 0, y: 0, minTime: 0, maxTime: 0 } },
  { name: 'ConsoleFactionMessage (PrepareFactionMessageConsole)', hex: '26 00  03 20 41 3e  14  0e 4d 45 4e 53 41 4a 45 5f 41 52 4d 41 44 41',
    packet: { id: S.ConsoleFactionMessage, message: ' A>', font: 20, label: 'MENSAJE_ARMADA' } },
  { name: 'GuildChat (PrepareMessageGuildChat): status first, then text', hex: '27 00  0a  05 41 3e 20 68 69', packet: { id: S.GuildChat, status: 10, message: 'A> hi' } },
  { name: 'ConsoleCharText (PrepareConsoleCharText)', hex: '80 00  02 68 69  9d e2 14 00  03 42 6f 62  01 00  08 00',
    packet: { id: S.ConsoleCharText, message: 'hi', color: toVbColor(157, 226, 20), sourceName: 'Bob', sourceStatus: 1, privileges: 8 } },
  { name: 'LocaleMsg (PrepareMessageLocaleMsg) with channel', hex: '8d 00  0a 02  02 61 62  03  01', packet: { id: S.LocaleMsg, messageId: 0x020a, message: 'ab', font: 3, channel: 1 } },
  { name: 'LocaleMsg from an older sender, no channel', hex: '8d 00  0a 02  02 61 62  03', packet: { id: S.LocaleMsg, messageId: 0x020a, message: 'ab', font: 3 } },
] as const;
const clientGoldens = [
  { name: 'GroupMessage (WriteGrupoMsg): text only', hex: '2d 00  02 68 69', packet: { id: C.GroupMessage, message: 'hi' } },
  { name: 'GuildMessage (WriteGuildMessage): text, then counter', hex: '3b 00  02 68 69  07 00 00 00', packet: { id: C.GuildMessage, message: 'hi', counter: 7 } },
  { name: 'GuildOnline (WriteGuildOnline)', hex: '3c 00', packet: { id: C.GuildOnline } },
  { name: 'CouncilMessage (WriteCouncilMessage)', hex: '3d 00  02 68 69', packet: { id: C.CouncilMessage, message: 'hi' } },
  { name: 'FactionMessage (WriteFactionMessage)', hex: '3e 00  02 68 69', packet: { id: C.FactionMessage, message: 'hi' } },
  { name: 'Yell (WriteYell): text only, no counter', hex: '4c 00  02 c2 a1', packet: { id: C.Yell, message: '¡' } },
  { name: 'Whisper (WriteWhisper): target, then text', hex: '4d 00  03 42 6f 62  02 68 69', packet: { id: C.Whisper, name: 'Bob', message: 'hi' } },
  { name: 'GlobalMessage (WriteGlobalMessage)', hex: 'cf 00  02 68 69', packet: { id: C.GlobalMessage, message: 'hi' } },
] as const;

describe('chat packet goldens', () => {
  for (const { name, hex: expected, packet } of serverGoldens) {
    it(`server ${name}`, () => {
      expect(hex(encodeServerPacket(packet as never))).toBe(expected.replaceAll(' ', ''));
      expect(decodeServerPacket(bytes(expected))).toEqual(packet);
    });
  }
  for (const { name, hex: expected, packet } of clientGoldens) {
    it(`client ${name}`, () => {
      expect(hex(encodeClientPacket(packet as never))).toBe(expected.replaceAll(' ', ''));
      expect(decodeClientPacket(bytes(expected))).toEqual(packet);
    });
  }
  it('keeps the colour byte order: byte 0 is red', () => {
    expect(vbColor(0x14e29d)).toEqual({ r: 157, g: 226, b: 20 });
    expect(toVbColor(157, 226, 20)).toBe(0x14e29d);
  });
  it('rejects trailing bytes and truncated fields instead of guessing', () => {
    expect(() => decodeServerPacket(bytes('04 00  34 12  00'))).toThrow('Packet id=4');
    expect(() => decodeServerPacket(bytes('23 00  02 48'))).toThrow('Packet id=35');
    expect(() => decodeClientPacket(bytes('4d 00  03 42 6f 62'))).toThrow('Packet id=77');
  });
});

// Frames recorded from the real VB6 server (tools/real-server/vb6-chat-session.mjs). Every frame must
// decode without error and re-encode to the same bytes.
const root = new URL('../../../tests/fixtures/vb6/chat/', import.meta.url);
const files = existsSync(root) ? readdirSync(root).filter(name => name.endsWith('.jsonl')) : [];
describe('recorded VB6 chat sessions', () => {
  it('has recordings', () => { expect(files.length).toBeGreaterThan(0); });
  for (const file of files) {
    it(`${file}: every known frame round-trips`, () => {
      const lines = readFileSync(new URL(file, root), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { dir: string; id: number; name: string; hex: string });
      let known = 0;
      for (const line of lines) {
        const body = bytes(line.hex);
        const packet = line.dir === 's2c' ? decodeServerPacket(body) : decodeClientPacket(body);
        expect(packet.id, line.name).toBe(line.id);
        if ('unknown' in packet) continue;
        known++;
        expect(hex(line.dir === 's2c' ? encodeServerPacket(packet as never) : encodeClientPacket(packet as never)), `${line.dir} ${line.name}`).toBe(line.hex);
      }
      expect(known).toBeGreaterThan(0);
    });
  }
});
