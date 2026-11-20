import { describe, expect, it } from 'vitest';
import { ClientPacketId as C, DoorClientPacketId, DoorServerPacketId as D, ServerPacketId as S, decodeClientPacket, encodeServerFrame, FrameDecoder } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { parseMap } from '../src/assets.js';
import { MapObjects, RoofFade, hayTecho, parseObjectGraphics, roofHidden, tileKey } from '../src/map-objects.js';
import { Session } from '../src/session.js';

function harness() {
  let now = 0; const sent: Uint8Array[] = [];
  const session = new Session({ email: 'a', password: 'b' }, bytes => sent.push(bytes), () => now);
  const recv = (...packets: ServerPacket[]) => { for (const packet of packets) session.receive(encodeServerFrame(packet)); };
  const login = () => recv(f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap, { ...f.CharacterCreate, speeding: 1 }, f.UserCharIndexInServer, f.Logged);
  const clicks = () => { const d = new FrameDecoder(); return sent.flatMap(b => d.push(b).map(decodeClientPacket)).filter(p => p.id === 95 || p.id === 96); };
  return { session, recv, login, clicks, advance: (ms: number) => { now += ms; } };
}

describe('roof rule (TileEngine.HayTecho)', () => {
  it('matches the VB6 predicate: >= 60, BAJOTECHO 1, ZONASEGURA 4, NADOBAJOTECHO 16', () => {
    for (const t of [1, 4, 16, 60, 61, 200]) expect(hayTecho(t), String(t)).toBe(true);
    for (const t of [0, 2, 3, 5, 26, 29, 54, 59]) expect(hayTecho(t), String(t)).toBe(false);
  });
  it('hides only roof tiles sharing the trigger of the tile the player stands on', () => {
    const triggers = new Uint16Array(10_000);
    triggers[tileKey(10, 10)] = 61; triggers[tileKey(11, 10)] = 61; triggers[tileKey(30, 30)] = 62; triggers[tileKey(5, 5)] = 29;
    expect(roofHidden(triggers, tileKey(10, 10), tileKey(11, 10))).toBe(true);
    expect(roofHidden(triggers, tileKey(10, 10), tileKey(30, 30))).toBe(false);
    expect(roofHidden(triggers, tileKey(20, 20), tileKey(11, 10))).toBe(false); // outdoors: nothing hides
    expect(roofHidden(triggers, tileKey(5, 5), tileKey(5, 5))).toBe(false);      // 29 is not a roof trigger
  });
  it('fades out toward a floor and back in to opaque at the client rate', () => {
    const roof = new RoofFade();
    let alpha = 1; for (let i = 0; i < 40; i++) alpha = roof.step(1, true, 16);
    expect(alpha).toBeLessThan(0.1); expect(alpha).toBeGreaterThan(0);
    for (let i = 0; i < 40; i++) alpha = roof.step(1, false, 16);
    expect(alpha).toBe(1);
  });
  it('reads the trigger section of a CSM map', () => {
    const chunks: Buffer[] = []; const n = (v: number, s: number) => { const b = Buffer.alloc(s); b.writeIntLE(v, 0, s); chunks.push(b); };
    const text = (v: string) => { const b = Buffer.from(v, 'latin1'); n(b.length, 2); chunks.push(b); };
    n(0, 4); for (let i = 0; i < 4; i++) n(0, 4); n(2, 4); for (let i = 0; i < 5; i++) n(0, 4); // 2 triggers, nothing else
    for (let i = 0; i < 4; i++) n(0, 2); text('Casa'); n(0, 1); text(''); n(0, 4); n(0, 4); n(1, 1); text(''); text(''); text('');
    for (let i = 0; i < 4; i++) n(0, 4); text(''); n(0, 3);
    n(12, 2); n(14, 2); n(61, 2); n(13, 2); n(14, 2); n(7, 2);
    const map = parseMap(Buffer.concat(chunks));
    expect(map.triggers[tileKey(12, 14)]).toBe(61); expect(map.triggers[tileKey(13, 14)]).toBe(7); expect(map.triggers[tileKey(1, 1)]).toBe(0);
  });
});

describe('ground objects and doors', () => {
  it('parses Obj.dat graphics and door type', () => {
    const objects = parseObjectGraphics('[OBJ2334]\r\nName=Puerta cerrada\r\nGrhIndex=7001\r\nObjType=6\r\nLlave=0\r\n[OBJ2333]\r\nGrhIndex=7002\r\nObjType=6\r\n[OBJ5]\nGrhIndex=9\n');
    expect(objects.get(2334)).toEqual({ grh: 7001, type: 6 }); expect(objects.get(5)).toEqual({ grh: 9, type: 0 });
  });
  it('tracks ObjectCreate/ObjectDelete/BlockPosition (HandleBlockPosition replaces the side bits)', () => {
    const map = new MapObjects();
    map.create(72, 35, { objIndex: 2334, amount: 1, elementalTags: 0 });
    expect(map.objectAt(72, 35)?.objIndex).toBe(2334);
    map.block(72, 35, 1); expect(map.blocked.get(tileKey(72, 35))).toBe(1);
    map.block(72, 35, 0); expect(map.blocked.get(tileKey(72, 35))).toBe(0); // door opened
    map.create(72, 35, { objIndex: 2333, amount: 1, elementalTags: 0 }); expect(map.objectAt(72, 35)?.objIndex).toBe(2333);
    map.delete(72, 35); expect(map.objectAt(72, 35)).toBeUndefined();
  });
  it('session applies door packets from the server and drops them on a map change', () => {
    const h = harness(); h.login();
    h.recv({ id: D.ObjectCreate, x: 72, y: 35, objIndex: 2334, amount: 1, elementalTags: 0 }, { id: D.BlockPosition, x: 72, y: 35, sides: 15 });
    expect(h.session.mapObjects.objectAt(72, 35)?.objIndex).toBe(2334);
    expect(h.session.mapObjects.blocked.get(tileKey(72, 35))).toBe(15);
    h.recv({ id: D.ObjectCreate, x: 72, y: 35, objIndex: 2333, amount: 1, elementalTags: 0 }, { id: D.BlockPosition, x: 72, y: 35, sides: 0 });
    expect(h.session.mapObjects.objectAt(72, 35)?.objIndex).toBe(2333);
    h.recv({ id: S.ChangeMap, map: 600, resourceMap: 600 });
    expect(h.session.mapObjects.objects.size).toBe(0); expect(h.session.mapObjects.blocked.size).toBe(0);
    expect(h.session.ready).toBe(false); // placement is awaited again after a ChangeMap
  });
  it('sends DoubleClick/LeftClick for a tile only when playing, in range and paced by the leftClick interval', () => {
    const h = harness();
    expect(h.session.doubleClick(72, 35)).toBe(false);          // not logged in
    h.login(); h.advance(1000);
    expect(h.session.doubleClick(0, 35)).toBe(false); expect(h.session.doubleClick(72, 101)).toBe(false);
    expect(h.session.doubleClick(72, 35)).toBe(true);
    expect(h.session.leftClick(72, 35)).toBe(false);            // too soon
    h.advance(1000); expect(h.session.leftClick(72, 35)).toBe(true);
    expect(h.clicks()).toEqual([{ id: DoorClientPacketId.DoubleClick, x: 72, y: 35 }, { id: DoorClientPacketId.LeftClick, x: 72, y: 35 }]);
  });
});
