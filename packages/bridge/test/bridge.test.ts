import { once } from 'node:events';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Socket as NetSocket } from 'node:net';
import WebSocket from 'ws';
import type { RawData } from 'ws';
import { startBridge, TCP_KEEPALIVE_MS } from '../src/index.js';
import { startStandin } from '../../../tools/standin-server/src/index.js';
import {
  ClientPacketId as C, ServerPacketId as S, FrameDecoder, encodeClientFrame, decodeServerPacket,
} from '@ao/protocol';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
function buffer(data: RawData): Buffer {
  return Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data;
}

async function peer(handler: (socket: Socket) => void) {
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    handler(socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return address.port;
}

async function connection(tcpPort: number) {
  const bridge = await startBridge({ tcpHost: '127.0.0.1', tcpPort });
  cleanups.push(bridge.close);
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`, { perMessageDeflate: false });
  cleanups.push(async () => { ws.terminate(); });
  return ws;
}

describe('binary WebSocket to TCP bridge', () => {
  it('drops a browser that stops answering pings (half-open) and closes its server socket; a live one stays', async () => {
    let serverSocketClosed = false;
    const tcpPort = await peer(socket => { socket.on('close', () => { serverSocketClosed = true; }); });
    const bridge = await startBridge({ tcpHost: '127.0.0.1', tcpPort, heartbeatMs: 50 });
    cleanups.push(bridge.close);
    const live = new WebSocket(`ws://127.0.0.1:${bridge.port}`, { perMessageDeflate: false });
    const dead = new WebSocket(`ws://127.0.0.1:${bridge.port}`, { perMessageDeflate: false, autoPong: false });
    cleanups.push(async () => { live.terminate(); dead.terminate(); });
    await Promise.all([once(live, 'open'), once(dead, 'open')]);
    const [code] = await once(dead, 'close') as [number];
    expect(code).toBe(1006); // terminated, no close handshake
    await new Promise(resolve => setTimeout(resolve, 300)); // six more periods
    expect(serverSocketClosed).toBe(true);
    expect(live.readyState).toBe(WebSocket.OPEN);
  });
  it('turns on TCP keepalive on the browser socket and on the server socket', async () => {
    const spy = vi.spyOn(NetSocket.prototype, 'setKeepAlive');
    try {
      const tcpPort = await peer(() => {});
      const ws = await connection(tcpPort);
      await once(ws, 'open');
      await new Promise(resolve => setTimeout(resolve, 50));
      const calls = spy.mock.calls.filter(([enable, delay]) => enable === true && delay === TCP_KEEPALIVE_MS);
      expect(calls.length).toBeGreaterThanOrEqual(2);
    } finally { spy.mockRestore(); }
  });
  it('passes bytes unchanged across fragmented/coalesced boundaries with backpressure', async () => {
    const expected = Buffer.alloc(2 * 1024 * 1024);
    for (let index = 0; index < expected.length; index++) expected[index] = index % 256;
    const tcpReceived: Buffer[] = [];
    const tcpPort = await peer(socket => {
      socket.pause();
      setTimeout(() => socket.resume(), 20).unref();
      socket.on('data', chunk => {
        tcpReceived.push(chunk);
        if (!socket.write(chunk)) socket.pause();
      });
      socket.on('drain', () => socket.resume());
    });
    const ws = await connection(tcpPort);
    const received: Buffer[] = [];
    let size = 0;
    const echoed = new Promise<void>((resolve, reject) => {
      ws.on('error', reject);
      ws.on('message', (data, isBinary) => {
        try {
          expect(isBinary).toBe(true);
          received.push(buffer(data));
          size += buffer(data).length;
          if (size === expected.length) resolve();
        } catch (error) { reject(error); }
      });
    });
    await once(ws, 'open');
    // Include a one-byte message and payloads that split AO headers arbitrarily.
    ws.send(expected.subarray(0, 1), { binary: true });
    for (let offset = 1; offset < expected.length; offset += 65537) {
      ws.send(expected.subarray(offset, offset + 65537), { binary: true });
    }
    await echoed;
    expect(Buffer.concat(tcpReceived).equals(expected)).toBe(true);
    expect(Buffer.concat(received).equals(expected)).toBe(true);
  });

  it('rejects text without forwarding it to TCP', async () => {
    let received = 0;
    const tcpPort = await peer(socket => socket.on('data', bytes => { received += bytes.length; }));
    const ws = await connection(tcpPort);
    const closed = once(ws, 'close');
    await once(ws, 'open');
    ws.send('not binary');
    expect((await closed)[0]).toBe(1003);
    expect(received).toBe(0);
  });

  it('propagates TCP EOF to WebSocket closure', async () => {
    const tcpPort = await peer(socket => socket.end());
    const ws = await connection(tcpPort);
    expect((await once(ws, 'close'))[0]).toBe(1000);
  });

  it('reports failed TCP connects instead of leaving a WebSocket open', async () => {
    // Reserve and release a port; no daemon or fixed external port is assumed.
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test address');
    await new Promise<void>(resolve => server.close(() => resolve()));
    const ws = await connection(address.port);
    expect((await once(ws, 'close'))[0]).toBe(1011);
  });

  it('carries the classic login and walk protocol through the stand-in', async () => {
    const standin = await startStandin({ debugging: true, walkIntervalMs: 0 });
    cleanups.push(standin.close);
    const ws = await connection(standin.port);
    const decoder = new FrameDecoder();
    const ids: number[] = [];
    const done = new Promise<void>((resolve, reject) => {
      ws.on('error', reject);
      ws.on('message', data => {
        try {
          for (const body of decoder.push(buffer(data))) {
            const packet = decodeServerPacket(body);
            ids.push(packet.id);
            if ('unknown' in packet) throw new Error('Unexpected unknown test packet');
            if (packet.id === S.Connected) {
              expect(packet.debugging).toBe(true);
              const frame = encodeClientFrame({ id: C.LoginAccount, email: 'standin@local', password: 'testpass' });
              ws.send(frame.slice(0, 1));
              ws.send(frame.slice(1));
            } else if (packet.id === S.AccountCharacterList) {
              const character = packet.characters[0]!;
              ws.send(encodeClientFrame({ id: C.LoginExistingChar, charId: character.id, name: character.name }));
            } else if (packet.id === S.Logged) {
              ws.send(Buffer.concat([
                encodeClientFrame({ id: C.Walk, heading: 2, counter: 1 }),
                encodeClientFrame({ id: C.RequestPositionUpdate }),
              ]));
            } else if (packet.id === S.PosUpdate) {
              expect(packet).toEqual({ id: S.PosUpdate, x: 51, y: 50 });
              decoder.finish();
              resolve();
            }
          }
        } catch (error) { reject(error); }
      });
    });
    await done;
    expect(ids).toEqual([1, 199, 158, 30, 42, 47, 2, 31]);
  });
});
