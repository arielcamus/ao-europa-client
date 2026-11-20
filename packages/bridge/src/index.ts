// AGPL-3.0-or-later. See ../../../LICENSE.
// Binary WebSocket <-> TCP byte proxy. No packet parsing, framing, or game logic.
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import type { RawData } from 'ws';

export interface BridgeOptions {
  host?: string;
  port?: number;
  tcpHost: string;
  tcpPort: number;
  log?: (message: string) => void;
}

function buffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? Buffer.from(data) : data;
}

export async function startBridge(options: BridgeOptions) {
  const log = options.log ?? (() => {});
  const tcpSockets = new Set<Socket>();
  const server = createServer((_request, response) => {
    response.writeHead(404).end('AO bridge: binary WebSocket required\n');
  });
  server.on('connection', socket => socket.setNoDelay(true));
  const wss = new WebSocketServer({ server, perMessageDeflate: false, maxPayload: 1024 * 1024 });
  wss.on('connection', ws => {
    const tcp = createConnection({ host: options.tcpHost, port: options.tcpPort });
    tcpSockets.add(tcp);
    tcp.setNoDelay(true);
    ws.pause(); // Bound data buffered before TCP is connected.
    const fail = (error: Error) => {
      log(`connection error: ${error.message}`);
      tcp.destroy();
      if (ws.readyState === WebSocket.OPEN) {
        ws.resume(); // Close-handshake replies must still be readable after a failed connect.
        ws.close(1011, 'TCP connection failed');
      }
    };
    tcp.on('connect', () => {
      log(`TCP connected ${options.tcpHost}:${options.tcpPort}`);
      if (ws.readyState === WebSocket.OPEN) ws.resume();
      else tcp.destroy();
    });
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        ws.close(1003, 'Binary messages only');
        tcp.destroy();
        return;
      }
      if (!tcp.destroyed && !tcp.write(buffer(data))) ws.pause();
    });
    tcp.on('drain', () => { if (ws.readyState === WebSocket.OPEN) ws.resume(); });
    tcp.on('data', chunk => {
      if (ws.readyState !== WebSocket.OPEN) { tcp.destroy(); return; }
      tcp.pause();
      ws.send(chunk, { binary: true }, error => {
        if (error) fail(error);
        else if (!tcp.destroyed) tcp.resume();
      });
    });
    tcp.on('end', () => {
      if (ws.readyState === WebSocket.OPEN) { ws.resume(); ws.close(1000, 'TCP ended'); }
    });
    tcp.on('error', fail);
    tcp.on('close', () => {
      tcpSockets.delete(tcp);
      if (ws.readyState === WebSocket.OPEN) { ws.resume(); ws.close(1000, 'TCP closed'); }
    });
    ws.on('error', error => { log(`WebSocket error: ${error.message}`); tcp.destroy(); });
    ws.on('close', () => tcp.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing WebSocket listen address');
  log(`ws://${address.address}:${address.port} -> tcp://${options.tcpHost}:${options.tcpPort}`);
  return {
    server, host: address.address, port: address.port,
    async close(): Promise<void> {
      for (const ws of wss.clients) ws.terminate();
      for (const tcp of tcpSockets) tcp.destroy();
      await Promise.all([
        new Promise<void>((resolve, reject) => wss.close(error => error ? reject(error) : resolve())),
        new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
      ]);
    },
  };
}
