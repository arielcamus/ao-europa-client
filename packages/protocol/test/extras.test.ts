import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeClientPacket, decodeServerPacket, encodeClientPacket, encodeServerPacket } from '../src/index.js';
import goldens from './extras-goldens.json' with { type: 'json' };

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
const SAMPLE = { i8: 7, i16: 1234, i32: 100000, s8: 'Ab c', bool: true } as const;

/*
 * extras-goldens.json comes from tools/gen-extras-goldens.py, which reads the VB6 Write* / Handle* procedures and writes a sample
 * frame per flat packet without using these codecs. A field order or width that drifts from VB6 fails here.
 */
describe('events, duels, shop, remort, anti-cheat: flat packets follow the VB6 field order', () => {
  it.each(goldens.map(g => [g.dir, g.id, g.name, g] as const))('%s %i %s', (_dir, _id, _name, g) => {
    const decode = g.dir === 'c2s' ? decodeClientPacket : decodeServerPacket;
    const encode = g.dir === 'c2s' ? encodeClientPacket : encodeServerPacket;
    const packet = decode(bytes(g.hex)) as Record<string, unknown> & { id: number };
    expect(packet.id).toBe(g.id);
    const { id: _ignored, ...fields } = packet;
    expect(Object.values(fields)).toEqual(g.types.map(t => SAMPLE[t as keyof typeof SAMPLE]));
    expect(hex(encode(packet as never))).toBe(g.hex);
    expect(() => decode(bytes(g.hex + '00'))).toThrow();
    if (g.hex.length > 4) expect(() => decode(bytes(g.hex.slice(0, -2)))).toThrow();
  });
});

describe('packets with lists', () => {
  it('ShopInit: count, credits, then objNum / value / name', () => {
    // WriteShopInit: Int16 2, Int32 credits 500, (Int32 11, Int32 100, "Sword"), (Int32 12, Int32 250, "Axe")
    const frame = 'b2000200' + 'f4010000' + '0b000000' + '64000000' + '05' + Buffer.from('Sword').toString('hex') + '0c000000' + 'fa000000' + '03' + Buffer.from('Axe').toString('hex');
    // the packet id 178 is a two byte Int16: 0xb2 0x00
    const packet = decodeServerPacket(bytes(frame));
    expect(packet).toEqual({ id: 178, credits: 500, items: [{ objNum: 11, value: 100, name: 'Sword' }, { objNum: 12, value: 250, name: 'Axe' }] });
    expect(hex(encodeServerPacket(packet as never))).toBe(frame);
  });
  it('ReportLobbyList: the thirteen fields of HandleReportLobbyList per lobby', () => {
    const entry = { id: 3, description: 'Fun', scenarioType: 'CTF', minLevel: 10, maxLevel: 47, minPlayers: 2, maxPlayers: 8, registeredPlayers: 1, teamSize: 4, teamType: 1, inscriptionPrice: 1000, isPrivate: 1 };
    const frame = hex(encodeServerPacket({ id: 198, lobbies: [entry] }));
    expect(frame).toBe('c600' + '0100' + '0300' + '03' + hex(Buffer.from('Fun')) + '03' + hex(Buffer.from('CTF')) + '0a00' + '2f00' + '0200' + '0800' + '0100' + '0400' + '0100' + 'e8030000' + '01');
    expect(decodeServerPacket(bytes(frame))).toEqual({ id: 198, lobbies: [entry] });
    expect(decodeServerPacket(bytes('c6000000'))).toEqual({ id: 198, lobbies: [] });
  });
  it('ChangeSkinSlot: a full slot and the empty slot with the VB6 server\'s extra zero byte', () => {
    const full = { id: 200, slot: 2, objIndex: 900, equipped: true, grhIndex: 12345, objType: 21, name: 'Skin' };
    const frame = hex(encodeServerPacket(full));
    expect(frame).toBe('c800' + '02' + '8403' + '01' + '39300000' + '15' + '04' + hex(Buffer.from('Skin')));
    expect(decodeServerPacket(bytes(frame))).toEqual(full);
    // WriteChangeSkinSlot, else branch: Int32 0, Int16 0, String8 "" (7 bytes after the slot, objIndex and equipped fields)
    const empty = 'c800' + '03' + '0000' + '00' + '00000000' + '0000' + '00';
    expect(decodeServerPacket(bytes(empty))).toEqual({ id: 200, slot: 3, objIndex: 0, equipped: false, grhIndex: 0, objType: 0, name: '' });
    expect(hex(encodeServerPacket(decodeServerPacket(bytes(empty)) as never))).toBe(empty);
  });
  it('AntiCheatMessage is one SAFEARRAY of bytes in both directions', () => {
    const data = { bounds: [{ lowerBound: 0, count: 3 }], data: Uint8Array.from([1, 2, 3]) };
    const server = hex(encodeServerPacket({ id: 196, data }));
    expect(server).toBe('c400' + '01' + '00' + '03' + '010203');
    expect(decodeServerPacket(bytes(server))).toEqual({ id: 196, data });
    const client = hex(encodeClientPacket({ id: 302, data }));
    expect(client).toBe('2e01' + '01' + '00' + '03' + '010203');
    expect(decodeClientPacket(bytes(client))).toEqual({ id: 302, data });
  });
  it('RequestLobbyList is an empty packet and ChangeSkinSlot c2s has no codec (no payload exists on either side)', () => {
    expect(hex(encodeClientPacket({ id: 303 }))).toBe('2f01');
    expect(decodeClientPacket(bytes('3301'))).toMatchObject({ unknown: true, id: 307 });
  });
});

describe('recorded against the real VB6 server (Aotest as GM, tests/fixtures/vb6/extras)', () => {
  const load = (file: string) => readFileSync(new URL(`../../../tests/fixtures/vb6/extras/${file}`, import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l) as { dir: string; id: number; name: string; hex: string });
  it('the commands session: every extras packet we sent round-trips and the server kept the connection', () => {
    const rows = load('live-events-commands.jsonl');
    const sent = rows.filter(r => r.dir === 'c2s' && r.id !== 305 && r.id !== 73);
    expect(sent.map(r => r.name)).toEqual(['EventoInfo', 'SubastaInfo', 'MapPriceEntrance', 'Participar', 'OfertaInicial', 'Casarse', 'Duel', 'AcceptDuel', 'CancelDuel', 'QuitDuel', 'AntiMacroMessage', 'LobbyCommand', 'CuentaRegresiva', 'EventoFaccionario', 'FinEvento']);
    for (const row of sent) expect(hex(encodeClientPacket(decodeClientPacket(bytes(row.hex)) as never)), row.name).toBe(row.hex);
    expect(decodeClientPacket(bytes(sent.find(r => r.name === 'Duel')!.hex))).toEqual({ id: 218, players: 'Nadie', bet: 0, redPotions: -1, dropItems: false });
    expect(rows.some(r => r.dir === 's2c' && (r.id === 7 || r.id === 73))).toBe(false);
  });
  it('the lobby session: StartEvent made a lobby, ListPlayers listed us, CancelarEvento closed it', () => {
    const rows = load('live-lobby.jsonl');
    const start = rows.find(r => r.name === 'StartEvent')!;
    expect(decodeClientPacket(bytes(start.hex))).toMatchObject({ id: 291, scenarioType: 0, minLevel: 1, maxLevel: 47, maxPlayers: 4, description: 'Prueba cobertura' });
    expect(hex(encodeClientPacket(decodeClientPacket(bytes(start.hex)) as never))).toBe(start.hex);
    const join = rows.filter(r => r.name === 'Participar').map(r => decodeClientPacket(bytes(r.hex)));
    expect(join).toEqual([{ id: 185, roomId: -1, password: '' }]);
    expect(rows.some(r => r.name === 'CancelarEvento')).toBe(true);
  });
});
