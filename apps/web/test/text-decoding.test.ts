import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeGameText, parseIni } from '../src/assets.js';
import { ChatLocale } from '../src/chat-locale.js';

const sample = 'Aquí está el niño: ¿Qué quieres? ¡Ámora <Pescadora de Forgat>! Vigía, sacerdotisa, ÓÚ €';
const cp1252 = (value: string) => new Uint8Array([...value].map(c => {
  const code = c.charCodeAt(0);
  return c === '€' ? 0x80 : code;
}));

describe('decodeGameText: one decoder for every game text file', () => {
  it('reads windows-1252 bytes (the Dat files) with accents, ñ, ¿ ¡ and the euro sign', () => {
    const bytes = cp1252(sample);
    expect(bytes.includes(0xed) && bytes.includes(0xf1) && bytes.includes(0xbf) && bytes.includes(0xa1) && bytes.includes(0x80)).toBe(true);
    expect(decodeGameText(bytes)).toBe(sample);
  });
  it('reads UTF-8 bytes (init/sp_localindex.dat) without turning them into mojibake', () => {
    const bytes = new TextEncoder().encode(sample);
    expect(bytes.includes(0xc3)).toBe(true);
    expect(decodeGameText(bytes)).toBe(sample);
    expect(decodeGameText(bytes)).not.toMatch(/Ã|Â/);
  });
  it('is ASCII-transparent and drops a UTF-8 BOM', () => {
    expect(decodeGameText(new TextEncoder().encode('[NPC1]\r\nNAME=Pepe'))).toBe('[NPC1]\r\nNAME=Pepe');
    expect(decodeGameText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A');
  });
  it('a windows-1252 accent followed by ASCII is never mistaken for UTF-8', () => {
    for (const word of ['á ', 'é.', 'ñ,', 'Ó\r', 'ü=']) expect(decodeGameText(cp1252(word))).toBe(word);
  });
  it('decodes a MIXED file line by line (SP_LocalMsg.dat: windows-1252 with a few UTF-8 lines)', () => {
    const mixed = new Uint8Array([...cp1252('Msg1=Estás muy lejos.\r\n'), ...new TextEncoder().encode('Msg2=Tu música es única\r\n'), ...cp1252('Msg3=¿Qué niño?')]);
    expect(decodeGameText(mixed)).toBe('Msg1=Estás muy lejos.\r\nMsg2=Tu música es única\r\nMsg3=¿Qué niño?');
  });
  it('a single line holding both a windows-1252 byte and a UTF-8 sequence keeps both right (SP_LocalMsg Msg213)', () => {
    const line = new Uint8Array([...cp1252('¡Tu bella m'), 0xc3, 0xba, ...cp1252('sica, qué bien!')]);
    expect(decodeGameText(line)).toBe('¡Tu bella música, qué bien!');
  });
  it('repairs a line that was UTF-8 encoded twice in the data, and leaves real text alone', () => {
    const double = new TextEncoder().encode('MSG213=¡Tu bella mÃºsica!'); // "música" encoded twice, in a line with other accents
    expect(decodeGameText(double)).toBe('MSG213=¡Tu bella música!');
    expect(decodeGameText(cp1252('Ã y Â'))).toBe('Ã y Â');
  });
  it('the locale parser gets accented NPC text from either encoding', () => {
    const index = '[NPC1289]\r\nDESC=¡Hola hijo mío! ¿Quieres resucitar?\r\nNAME=Ámora <Sacerdotisa de Forgat>\r\n';
    for (const bytes of [new TextEncoder().encode(index), cp1252(index)]) {
      const locale = new ChatLocale();
      locale.load(decodeGameText(bytes), '');
      expect(locale.npcName(1289)).toBe('Ámora <Sacerdotisa de Forgat>');
      expect(locale.npcDescription(1289)).toBe('¡Hola hijo mío! ¿Quieres resucitar?');
      expect(parseIni(decodeGameText(bytes)).get('npc1289')?.get('name')).toBe('Ámora <Sacerdotisa de Forgat>');
    }
  });
});

// Real data: every pinned text file must decode with no mojibake, on whichever AO_ASSETS tree is set.
const root = process.env.AO_ASSETS ?? '';
const MOJIBAKE = /Ã[\u0080-¿]|Â[\u00A0-¿]|�/;
describe.skipIf(!root || !existsSync(join(root, 'init')))('real data files decode cleanly', () => {
  const files = ['init', 'Dat'].flatMap(dir => existsSync(join(root!, dir)) ? readdirSync(join(root!, dir)).filter(f => /\.(dat|ini)$/i.test(f)).map(f => `${dir}/${f}`) : []);
  it('has files to check', () => expect(files.length).toBeGreaterThan(10));
  it('no init/Dat .dat/.ini file shows mojibake or replacement characters', () => {
    const bad = files.filter(f => MOJIBAKE.test(decodeGameText(new Uint8Array(readFileSync(join(root!, f))))));
    expect(bad).toEqual([]);
  });
  it('sp_localindex.dat keeps its accents', () => {
    const file = ['init/sp_localindex.dat', 'init/SP_LocalIndex.dat'].find(f => existsSync(join(root!, f)));
    if (!file) return;
    const text = decodeGameText(new Uint8Array(readFileSync(join(root!, file))));
    expect(text).toMatch(/[áéíóúñ¿¡]/);
  });
  it('pure windows-1252 Dat files (npcs, Hechizos, obj) decode exactly as windows-1252', () => {
    for (const f of ['Dat/npcs.dat', 'Dat/Hechizos.dat', 'Dat/obj.dat']) {
      const path = join(root!, f); if (!existsSync(path)) continue;
      const raw = new Uint8Array(readFileSync(path));
      expect(decodeGameText(raw)).toBe(new TextDecoder('windows-1252').decode(raw).replace(/^\ufeff/, ''));
    }
  });
});
