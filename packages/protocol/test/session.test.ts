import { describe, expect, it } from 'vitest';
import { decodeClientPacket, decodeServerPacket, encodeClientPacket, encodeServerPacket, SessionClientPacketId as SC, SessionServerPacketId as SS } from '../src/index.js';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
const ascii = (text: string) => Buffer.from(text).toString('hex');

describe('account and character creation (client WriteCreateAccount / WriteLoginNewChar / WriteDeleteCharacter, PYMMO=0)', () => {
  it('CreateAccount is the id then String8 email and String8 password', () => {
    const golden = '3001' + '09' + ascii('a@local.es') .slice(0, 18) + '08' + ascii('password');
    const packet = { id: SC.CreateAccount, email: 'a@local.e', password: 'password' };
    expect(hex(encodeClientPacket(packet))).toBe(golden);
    expect(decodeClientPacket(bytes(golden))).toEqual(packet);
    expect(() => decodeClientPacket(bytes(golden + '00'))).toThrow();
  });
  it('LoginNewChar is name, race, gender, class, head, home, each a varint (a head above 127 takes two bytes)', () => {
    // Ariel, race 1 (human), gender 1, class 3, head 778, home 7 (Forgat).
    const golden = '4a00' + '05' + ascii('Ariel') + '01' + '01' + '03' + '8a06' + '07';
    const packet = { id: SC.LoginNewChar, name: 'Ariel', race: 1, gender: 1, characterClass: 3, head: 778, home: 7 };
    expect(hex(encodeClientPacket(packet))).toBe(golden);
    expect(decodeClientPacket(bytes(golden))).toEqual(packet);
    expect(() => decodeClientPacket(bytes('4a0005' + ascii('Ariel') + '0101'))).toThrow();
  });
  it('DeleteCharacter has no payload in PYMMO=0 (client writer and server handler are both empty)', () => {
    expect(SC.DeleteCharacter).toBe(306);
    expect(hex(encodeClientPacket({ id: SC.DeleteCharacter }))).toBe('3201');
    expect(() => decodeClientPacket(bytes('320100'))).toThrow();
  });
});

describe('empty client packets', () => {
  it.each([['Help', 51, '3300'], ['RequestMOTD', 57, '3900'], ['NavigateToggle', 183, 'b700'], ['Home', 264, '0801']] as const)('%s', (name, id, golden) => {
    expect(SC[name]).toBe(id);
    expect(hex(encodeClientPacket({ id } as never))).toBe(golden);
    expect(decodeClientPacket(bytes(golden))).toEqual({ id });
  });
  it('ChangeHeading is the heading Int8 and the Int32 counter', () => {
    expect(hex(encodeClientPacket({ id: SC.ChangeHeading, heading: 3, counter: 7 }))).toBe('0600' + '03' + '07000000');
    expect(decodeClientPacket(bytes('060003' + '07000000'))).toEqual({ id: 6, heading: 3, counter: 7 });
  });
});

describe('server packets (server Write* / Prepare*, client Handle*)', () => {
  it('ShowMessageBox is the message id Int16 and the String8 of dynamic values', () => {
    const golden = '2800' + 'f506' + '00';
    expect(decodeServerPacket(bytes(golden))).toEqual({ id: SS.ShowMessageBox, messageId: 1781, extra: '' });
    expect(hex(encodeServerPacket({ id: SS.ShowMessageBox, messageId: 1781, extra: '' }))).toBe(golden);
    const withExtra = '2800' + '0100' + '03' + ascii('Ana');
    expect(decodeServerPacket(bytes(withExtra))).toEqual({ id: 40, messageId: 1, extra: 'Ana' });
    expect(() => decodeServerPacket(bytes('2800f506'))).toThrow();
  });
  it.each([['MostrarCuenta', 41, '2900'], ['EquiteToggle', 6, '0600'], ['CerrarleCliente', 103, '6700'], ['ShowFrmLogear', 137, '8900'], ['AnswerReset', 173, 'ad00']] as const)('%s has no payload', (name, id, golden) => {
    expect(SS[name]).toBe(id);
    expect(decodeServerPacket(bytes(golden))).toEqual({ id });
    expect(hex(encodeServerPacket({ id } as never))).toBe(golden);
    expect(() => decodeServerPacket(bytes(golden + '00'))).toThrow();
  });
  it('toggles: NavigateToggle Bool, NadarToggle two Bools, VelocidadToggle Real32', () => {
    expect(decodeServerPacket(bytes('050001'))).toEqual({ id: 5, sailing: true });
    expect(decodeServerPacket(bytes('9400' + '01' + '00'))).toEqual({ id: 148, swimming: true, rubberSuit: false });
    expect(decodeServerPacket(bytes('8600' + '0000c03f'))).toEqual({ id: 134, speeding: 1.5 });
    expect(() => decodeServerPacket(bytes('050002'))).toThrow();
  });
  it('character updates: Translate, Flag, CharValue, TagAndStatus, ForceCharMove, UserIndexInServer', () => {
    expect(decodeServerPacket(bytes('2d00' + '0a00' + '14' + '1e' + 'e8030000'))).toEqual({ id: 45, charIndex: 10, x: 20, y: 30, time: 1000 });
    expect(decodeServerPacket(bytes('b500' + '0a00' + '02'))).toEqual({ id: 181, charIndex: 10, flag: 2 });
    expect(decodeServerPacket(bytes('c200' + '0a00' + '0000' + '01000000'))).toEqual({ id: 194, charIndex: 10, valueType: 0, value: 1 });
    const tag = 'Ana <Clan>';
    const golden = '6500' + '0a00' + '01' + '0a' + ascii(tag) + '0000' + '0300' + '02';
    expect(decodeServerPacket(bytes(golden))).toEqual({ id: 101, charIndex: 10, status: 1, tag, groupIndex: 0, clanIndex: 3, clanAlignment: 2 });
    expect(hex(encodeServerPacket(decodeServerPacket(bytes(golden)) as never))).toBe(golden);
    expect(decodeServerPacket(bytes('3000' + '03'))).toEqual({ id: 48, heading: 3 });
    expect(decodeServerPacket(bytes('2e00' + '0500'))).toEqual({ id: 46, userIndex: 5 });
  });
  it('floating text: TextOverTile and TextCharDrop (string, position or char, colour Int32, duration Int16, ...)', () => {
    const over = '7e00' + '03' + ascii('hit') + '0a00' + '0b00' + 'ff0000ff' + '1405' + '0000' + '01';
    expect(decodeServerPacket(bytes(over))).toEqual({ id: 126, text: 'hit', x: 10, y: 11, color: -16776961, duration: 1300, offsetY: 0, animated: true });
    expect(hex(encodeServerPacket(decodeServerPacket(bytes(over)) as never))).toBe(over);
    const drop = '7f00' + '02' + ascii('ok') + '0300' + '0000ff00' + '1405' + '00';
    expect(decodeServerPacket(bytes(drop))).toMatchObject({ id: 127, text: 'ok', charIndex: 3, duration: 1300, animated: false });
  });
  it('FlashScreen, Contadores, ShowSignal', () => {
    expect(decodeServerPacket(bytes('8100' + 'ffffff00' + 'f4010000' + '01'))).toEqual({ id: 129, color: 0xffffff, duration: 500, ignore: true });
    expect(decodeServerPacket(bytes('6800' + '0a00' + '1400'))).toEqual({ id: 104, invisibility: 10, effect: 20 });
    expect(decodeServerPacket(bytes('4c00' + '2a00' + '8a0c'))).toEqual({ id: 76, objIndex: 42, grh: 3210 });
  });
});
