import { describe, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { ClientPacketId as C, ServerPacketId as S, Heading, encodeServerFrame, decodeClientPacket, FrameDecoder } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { startStandin } from '../../../tools/standin-server/src/index.js';
import { startBridge } from '../../../packages/bridge/src/index.js';
import { Session } from '../src/session.js';

function harness() {
  let now = 0;
  const sent: Uint8Array[] = [];
  const session = new Session({ email: 'test', password: 'secret' }, bytes => sent.push(bytes), () => now);
  const recv = (...packets: ServerPacket[]) => { for (const packet of packets) session.receive(encodeServerFrame(packet)); };
  const login = () => recv(f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap,
    { ...f.CharacterCreate, speeding: 1 }, f.UserCharIndexInServer, f.Logged);
  return { session, recv, login, sent, advance: (ms: number) => { now += ms; } };
}
describe('browser session', () => {
  it('waits for real placement, then predicts and confirms all four paced headings', () => {
    const h = harness(); h.recv(f.Connected, f.AccountCharacterList, f.Logged);
    expect(h.session.ready).toBe(false);
    expect(h.session.walk(Heading.East)).toBe(false);
    h.recv(f.Intervals, f.ChangeMap, { ...f.CharacterCreate, speeding: 1 }, f.UserCharIndexInServer);
    expect(h.session.position).toEqual({ x: 50, y: 60 }); // not account list (50,51)
    for (const [heading, x, y] of [[Heading.East, 51, 60], [Heading.South, 51, 61], [Heading.West, 50, 61], [Heading.North, 50, 60]] as const) {
      expect(h.session.walk(heading)).toBe(true);
      expect(h.session.walk(heading)).toBe(false);
      h.recv({ id: S.PosUpdate, x, y }); h.advance(330);
    }
    expect(h.session.confirmedWalks).toBe(4);
    const decoder = new FrameDecoder();
    const packets = h.sent.flatMap(bytes => decoder.push(bytes).map(decodeClientPacket));
    expect(packets.filter(p => p.id === C.Walk)).toMatchObject([1, 2, 3, 4].map(counter => ({ counter })));
  });
  it('reconciles rejection, blocks input without replies, and never counts silence as acceptance', () => {
    const h = harness(); h.login(); h.session.walk(Heading.East);
    h.recv({ id: S.PosUpdate, x: 50, y: 60 });
    expect(h.session.position).toEqual({ x: 50, y: 60 });
    expect(h.session.motion).toBeUndefined(); expect(h.session.correctedWalks).toBe(1);
    h.advance(330); expect(h.session.walk(Heading.West)).toBe(true);
    h.advance(5001); expect(() => h.session.tick()).toThrow('stopped responding');
    expect(h.session.confirmedWalks).toBe(0);
  });
  it('clears old map placement and accepts the same self index on a warp', () => {
    const h = harness(); h.login(); h.session.walk(Heading.East);
    h.advance(30_000);
    h.recv({ id: S.ChangeMap, map: 2, resourceMap: 3 });
    expect(() => h.session.tick()).not.toThrow(); // warp deadline starts at the warp
    expect(h.session.ready).toBe(false); expect(h.session.walk(Heading.East)).toBe(false);
    h.recv({ ...f.CharacterCreate, x: 10, y: 20 });
    expect(h.session.position).toEqual({ x: 10, y: 20 }); expect(h.session.resourceMap).toBe(3);
    expect(h.session.ready).toBe(true);
  });
  it('fails empty accounts, malformed data, partial EOF, and login timeout', () => {
    const h = harness(); h.recv(f.Connected);
    expect(() => h.recv({ id: S.AccountCharacterList, characters: [] })).toThrow('no character');
    expect(() => harness().session.receive(Uint8Array.of(1, 0, 0))).toThrow();
    const partial = harness(); partial.session.receive(Uint8Array.of(4, 0, 31));
    expect(() => partial.session.finish()).toThrow();
    const timeout = harness(); timeout.advance(10001); expect(() => timeout.session.tick()).toThrow('Timed out');
  });
  it.each([false, true])('uses the real WS→TCP bridge and stand-in (rejectWalks=%s)', async rejectWalks => {
    const server = await startStandin({ rejectWalks, walkIntervalMs: 20 });
    const bridge = await startBridge({ tcpHost: server.host, tcpPort: server.port });
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`); ws.binaryType = 'arraybuffer';
    const session = new Session({ email: 'standin@local', password: 'testpass' }, bytes => ws.send(bytes.slice().buffer));
    let failure: unknown;
    ws.onmessage = event => { try { session.receive(new Uint8Array(event.data as ArrayBuffer)); } catch (error) { failure = error; } };
    try {
      await expect.poll(() => session.ready || failure).toBe(true);
      expect(session.walk(Heading.East)).toBe(true);
      await expect.poll(() => session.confirmedWalks + session.correctedWalks).toBe(1);
      expect(session.position).toEqual({ x: rejectWalks ? 50 : 51, y: 50 });
      expect(session.confirmedWalks).toBe(rejectWalks ? 0 : 1);
      await delay(10); expect(failure).toBeUndefined();
    } finally { ws.close(); await bridge.close(); await server.close(); }
  });
});
