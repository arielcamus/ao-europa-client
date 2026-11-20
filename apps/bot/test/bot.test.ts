import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClientPacketId as C, ServerPacketId as S, FrameDecoder,
  decodeClientPacket, encodeFrame, encodeServerFrame,
} from '@ao/protocol';
import type { ClientPacket, ServerPacket } from '@ao/protocol';
import { runBot } from '../src/index.js';
import { startStandin } from '../../../tools/standin-server/src/index.js';
import { serverFixtures as fixtures } from '../../../packages/protocol/test/fixtures.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
// Allow a real loopback reply to arrive while browser tests share the machine.
// Only the explicit late-correction test needs a shorter response window.
const timing = { observationMs: 180, responseWaitMs: 100, stepMarginMs: 2, loginTimeoutMs: 1000 };
const credentials = { email: 'standin@local', password: 'testpass' };

async function scripted(options: {
  omitLogged?: boolean;
  omitPlacement?: boolean;
  emptyAccount?: boolean;
  silence?: boolean;
  afterWalk?: (socket: Socket, counter: number) => void;
} = {}) {
  const sockets = new Set<Socket>();
  const received: ClientPacket[] = [];
  const server = createServer(socket => {
    sockets.add(socket);
    socket.setNoDelay(true);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    const decoder = new FrameDecoder();
    const send = (packet: ServerPacket) => socket.write(encodeServerFrame(packet));
    // An unknown frame can contain ID-like bytes; only its envelope gives boundaries.
    socket.write(encodeFrame(Uint8Array.of(0x30, 0x75, 1, 0, 2, 0)));
    send(fixtures.Connected);
    let x = fixtures.CharacterCreate.x;
    let y = fixtures.CharacterCreate.y;
    socket.on('data', chunk => {
      for (const body of decoder.push(chunk)) {
        const packet = decodeClientPacket(body);
        if ('unknown' in packet) throw new Error('Unexpected test packet');
        received.push(packet);
        if (packet.id === C.LoginAccount) {
          send(options.emptyAccount ? { id: S.AccountCharacterList, characters: [] } : fixtures.AccountCharacterList);
        } else if (packet.id === C.LoginExistingChar) {
          send({ ...fixtures.Intervals, walk: 0 });
          send(fixtures.ChangeMap);
          if (!options.omitPlacement) send(fixtures.CharacterCreate);
          send(fixtures.UserCharIndexInServer);
          if (!options.omitLogged) send(fixtures.Logged);
        } else if (packet.id === C.Walk) {
          x += packet.heading === 2 ? 1 : packet.heading === 4 ? -1 : 0;
          y += packet.heading === 3 ? 1 : packet.heading === 1 ? -1 : 0;
          options.afterWalk?.(socket, packet.counter);
        } else if (packet.id === C.RequestPositionUpdate && !options.silence) {
          send({ id: S.PosUpdate, x, y });
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  return { host: '127.0.0.1', port: address.port, received };
}

describe('headless bot over real loopback TCP', () => {
  it.each([false, true])('logs in, places and confirms five walks, DEBUGGING=%s', async debugging => {
    const standin = await startStandin({ debugging, walkIntervalMs: 1 });
    cleanups.push(standin.close);
    const logs: string[] = [];
    const result = await runBot({ ...standin, ...credentials, ...timing, log: message => logs.push(message) });
    expect(result).toMatchObject({ walksSent: 5, confirmedWalks: 5, inferredWalks: 0, correctedWalks: 0, map: 1, position: { x: 51, y: 50 } });
    expect(result.observedMs).toBeGreaterThanOrEqual(timing.observationMs);
    expect(result.connectedMs).toBeGreaterThanOrEqual(result.observedMs);
    expect(logs.join('\n')).toContain(`debugging=${debugging}`);
    expect(logs.join('\n')).not.toContain(credentials.password);
    expect(logs.join('\n')).not.toContain(credentials.email);
  });

  it('fails when all walks are corrected', async () => {
    const standin = await startStandin({ rejectWalks: true, walkIntervalMs: 0 });
    cleanups.push(standin.close);
    await expect(runBot({ ...standin, ...credentials, ...timing })).rejects.toThrow('No walk accepted');
  });

  it('reports authentication failure without exposing credentials', async () => {
    const standin = await startStandin();
    cleanups.push(standin.close);
    const logs: string[] = [];
    await expect(runBot({ ...standin, ...credentials, ...timing, password: 'private-wrong-password', log: message => logs.push(message) }))
      .rejects.toThrow('Server ErrorMsg: Invalid stand-in credentials');
    expect(logs.join('\n')).not.toContain('private-wrong-password');
  });

  it('skips unknown frames, selects the first character and uses source packet ordering', async () => {
    const peer = await scripted();
    const logs: string[] = [];
    const result = await runBot({ ...peer, ...credentials, ...timing, log: message => logs.push(message) });
    expect(result.confirmedWalks).toBe(5);
    expect(result.map).toBe(257);
    expect(peer.received[1]).toEqual({ id: C.LoginExistingChar, charId: 300, name: 'Añ' });
    expect(peer.received.filter(packet => packet.id === C.Walk).map(packet => packet.counter)).toEqual([1, 2, 3, 4, 5]);
    expect(logs.join('\n')).toContain('skip unknown server id=30000 payloadBytes=4');
  });

  it.each(['omitLogged', 'omitPlacement'] as const)('does not walk without %s', async missing => {
    const peer = await scripted({ [missing]: true });
    await expect(runBot({ ...peer, ...credentials, ...timing, loginTimeoutMs: 50 })).rejects.toThrow(/Timed out/);
    expect(peer.received.some(packet => packet.id === C.Walk)).toBe(false);
  });

  it('fails on an empty character list', async () => {
    const peer = await scripted({ emptyAccount: true });
    await expect(runBot({ ...peer, ...credentials, ...timing })).rejects.toThrow(/no selectable character/);
  });

  it('fails on early disconnect even after a walk was sent', async () => {
    const peer = await scripted({ afterWalk: socket => socket.end() });
    await expect(runBot({ ...peer, ...credentials, ...timing })).rejects.toThrow(/TCP (ended|closed)/);
  });

  it('reports a malformed known packet ID and stops', async () => {
    const peer = await scripted({ afterWalk: socket => socket.write(encodeFrame(Uint8Array.of(31, 0, 50))) });
    await expect(runBot({ ...peer, ...credentials, ...timing })).rejects.toThrow(/Packet id=31.*Truncated/);
  });

  it('reports an unknown unsized packet ID on premature EOF', async () => {
    const peer = await scripted({ afterWalk: socket => socket.end(Uint8Array.of(12, 0, 0x30, 0x75, 1)) });
    await expect(runBot({ ...peer, ...credentials, ...timing })).rejects.toThrow(/Truncated frame.*id=30000/);
  });

  it('labels no-correction acceptance as an inference', async () => {
    const peer = await scripted({ silence: true });
    const result = await runBot({ ...peer, ...credentials, ...timing });
    expect(result).toMatchObject({ confirmedWalks: 0, inferredWalks: 5 });
  });

  it('revokes silence-based acceptance when a late correction arrives', async () => {
    const peer = await scripted({
      silence: true,
      afterWalk: (socket, counter) => {
        if (counter === 5) setTimeout(() => {
          if (!socket.destroyed) socket.write(encodeServerFrame({ id: S.PosUpdate, x: 50, y: 60 }));
        }, 40).unref();
      },
    });
    await expect(runBot({ ...peer, ...credentials, ...timing, responseWaitMs: 10, observationMs: 250 })).rejects.toThrow('No walk accepted');
  });
});
