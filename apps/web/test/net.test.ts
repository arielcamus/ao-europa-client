import { describe, expect, it } from 'vitest';
import { Heading } from '@ao/protocol';
import { startStandin } from '../../../tools/standin-server/src/index.js';
import { startBridge } from '../../../packages/bridge/src/index.js';
import { GameClient } from '../src/net.js';

describe('browser session over binary WebSocket → TCP', () => {
  for (const rejectWalks of [false, true]) {
    it(`predicts on send and ${rejectWalks ? 'corrects on packet 31' : 'keeps an accepted step without a self acknowledgement'}`, async () => {
      const standin = await startStandin({ walkIntervalMs: 20, debugging: true, rejectWalks });
      const bridge = await startBridge({ tcpHost: standin.host, tcpPort: standin.port });
      const client = new GameClient(() => {});
      try {
        client.connect(`ws://${bridge.host}:${bridge.port}`, 'standin@local', 'testpass');
        await expect.poll(() => client.snapshot.player?.x).toBe(50);
        expect(client.snapshot.status).toBe('loading');
        expect(client.walk(Heading.East)).toBe(false); // No input before map resources are ready.
        client.setMapReady(99);
        expect(client.snapshot.status).toBe('loading');
        client.setMapReady(1);
        expect(client.snapshot.status).toBe('ready');
        expect(client.walk(Heading.East)).toBe(true);
        expect(client.snapshot.player?.x).toBe(51); // Synchronous prediction, before any reply.
        expect(client.walk(Heading.East)).toBe(false); // Respect server interval and speed.
        if (rejectWalks) {
          await expect.poll(() => client.snapshot.player?.x).toBe(50);
          expect(client.snapshot.corrections).toBe(1);
        } else {
          await new Promise(resolve => setTimeout(resolve, 60));
          expect(client.snapshot.player?.x).toBe(51);
          expect(client.snapshot.corrections).toBe(0);
        }
        client.disconnect();
        expect(client.snapshot.status).toBe('offline');
        expect(client.walk(Heading.North)).toBe(false);
        client.connect(`ws://${bridge.host}:${bridge.port}`, 'standin@local', 'testpass');
        await expect.poll(() => client.snapshot.player?.x).toBe(50);
        expect(client.snapshot.walks).toBe(0);
      } finally { client.disconnect(); await bridge.close(); await standin.close(); }
    });
  }
  it('exposes authentication errors and disables walking after upstream closes', async () => {
    const standin = await startStandin();
    const bridge = await startBridge({ tcpHost: standin.host, tcpPort: standin.port });
    const client = new GameClient(() => {});
    try {
      client.connect(`ws://${bridge.host}:${bridge.port}`, 'standin@local', 'wrong');
      await expect.poll(() => client.snapshot.status).toBe('error');
      expect(client.snapshot.message).toContain('Invalid stand-in credentials');
      expect(client.walk(Heading.South)).toBe(false);
      client.connect(`ws://${bridge.host}:${bridge.port}`, 'standin@local', 'testpass');
      await expect.poll(() => client.snapshot.player?.x).toBe(50);
      client.setMapReady(1);
      await standin.close();
      await expect.poll(() => client.snapshot.status).toBe('error');
      expect(client.walk(Heading.South)).toBe(false);
    } finally { client.disconnect(); await bridge.close(); if (standin.server.listening) await standin.close(); }
  });
});
