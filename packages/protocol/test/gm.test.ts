import { describe, expect, it } from 'vitest';
import { decodeClientPacket, decodeServerPacket, encodeClientPacket, encodeServerPacket, GmClientPacketId, GmServerPacketId as GS } from '../src/index.js';
import goldens from './gm-goldens.json' with { type: 'json' };

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
const ascii = (text: string) => Buffer.from(text, 'latin1').toString('hex');

/*
 * gm-goldens.json is generated from the VB6 client Protocol_Writes.bas (one Writer.Write* call per field, in order) by an independent
 * writer written in Python, with sample values per type (Int8 7, Int16 1234, Int32 100000, String8 "Ab c", Bool true, Real32 1.5).
 * Every wp12 client packet is in it, so a field order that drifts from VB6 fails here.
 */
describe('GM client packets: field order of every VB6 Write* procedure', () => {
  it('covers all 129 client packets of wp12', () => { expect(goldens).toHaveLength(129); expect(Object.keys(GmClientPacketId)).toHaveLength(129); });
  it.each(goldens.map(g => [g.id, g.name, g] as const))('C%i %s', (_id, name, golden) => {
    expect(GmClientPacketId[name as keyof typeof GmClientPacketId]).toBe(golden.id);
    const packet = { id: golden.id, ...golden.value };
    expect(hex(encodeClientPacket(packet as never))).toBe(golden.hex);
    expect(decodeClientPacket(bytes(golden.hex))).toEqual(packet);
    // A frame holds exactly one packet: a trailing byte is a malformed packet, and so is a missing field.
    expect(() => decodeClientPacket(bytes(golden.hex + '00'))).toThrow();
    if (golden.hex.length > 4) expect(() => decodeClientPacket(bytes(golden.hex.slice(0, -2)))).toThrow();
  });
});

describe('GM server packets (client Handle* readers, server Write* writers)', () => {
  it('Privilegios is one Bool', () => {
    expect(GS.Privilegios).toBe(177);
    expect(decodeServerPacket(bytes('b10001'))).toEqual({ id: 177, isGM: true });
    expect(hex(encodeServerPacket({ id: 177, isGM: false }))).toBe('b10000');
  });
  it('ShowGMPanelForm is head, body, casco, arma, escudo as Int16', () => {
    const golden = '6e00' + '0100' + '0200' + '0300' + '0400' + '0500';
    expect(decodeServerPacket(bytes(golden))).toEqual({ id: 110, head: 1, body: 2, casco: 3, arma: 4, escudo: 5 });
    expect(hex(encodeServerPacket({ id: 110, head: 1, body: 2, casco: 3, arma: 4, escudo: 5 }))).toBe(golden);
  });
  it('SpawnListt is one Bool; UserOnline one Int16', () => {
    expect(decodeServerPacket(bytes('6b0001'))).toEqual({ id: 107, listaCompleta: true });
    expect(decodeServerPacket(bytes('7000' + '2a00'))).toEqual({ id: 112, count: 42 });
  });
  it('UserNameList and ShowSOSForm carry one string joined with vbNullChar', () => {
    const list = 'Ana\0Beto';
    const golden = '6f00' + '08' + ascii(list);
    expect(decodeServerPacket(bytes(golden))).toEqual({ id: 111, list });
    expect(hex(encodeServerPacket({ id: 111, list }))).toBe(golden);
    expect(decodeServerPacket(bytes('6c00' + '00'))).toEqual({ id: 108, list: '' });
  });
  it('ShowMOTDEditionForm is the current MOTD as String8', () => {
    expect(decodeServerPacket(bytes('6d00' + '03' + ascii('Hi!')))).toEqual({ id: 109, motd: 'Hi!' });
  });
  it('AddForumMsg is two strings; ShowForumForm and GuardNotice are the id only (105 and 159 belong to the keyring codecs)', () => {
    expect(decodeServerPacket(bytes('5100' + '01' + ascii('t') + '01' + ascii('m')))).toEqual({ id: 81, title: 't', message: 'm' });
    for (const [id, hexId] of [[82, '5200'], [172, 'ac00']] as const) expect(decodeServerPacket(bytes(hexId))).toEqual({ id });
  });
  it('DebugDataResponse is a count then that many strings', () => {
    const golden = 'be00' + '0200' + '03' + ascii('abc') + '00';
    expect(decodeServerPacket(bytes(golden))).toEqual({ id: 190, messages: ['abc', ''] });
    expect(hex(encodeServerPacket({ id: 190, messages: ['abc', ''] }))).toBe(golden);
  });
});

describe('GM client packets with a conditional or fixed layout', () => {
  it('RequestDebug carries the user name only for eConnectionState (1)', () => {
    expect(decodeClientPacket(bytes('2801' + '00'))).toEqual({ id: 296, debugType: 0 });
    expect(decodeClientPacket(bytes('2801' + '02'))).toEqual({ id: 296, debugType: 2 });
    expect(decodeClientPacket(bytes('2801' + '01' + '03' + ascii('Bob')))).toEqual({ id: 296, debugType: 1, argument: 'Bob' });
  });
  it('IPToNick is four octets one Byte each', () => {
    expect(hex(encodeClientPacket({ id: 146, ip: [10, 0, 0, 1] }))).toBe('9200' + '0a000001');
    expect(() => encodeClientPacket({ id: 146, ip: [10, 0, 1] })).toThrow();
  });
  it('QuestionGM ends with the questionGM counter (sequence-checked)', () => {
    expect(hex(encodeClientPacket({ id: 215, consulta: 'a', tipoDeConsulta: 'b', counter: 7 }))).toBe('d700' + '01' + ascii('a') + '01' + ascii('b') + '07000000');
  });
});
