import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canEnter, tileIndex } from '@ao/formats';
import { FrameDecoder, encodeClientFrame, decodeServerPacket, Heading, ClientPacketId as C, ServerPacketId as S } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { startStandin, loadWorld } from '../src/index.js';

const root = process.env.AO_ASSETS ?? '';
describe.skipIf(!root || !existsSync(join(root, 'Mapas/mapa1.csm')) )('real map stand-in', () => {
  it('advertises the real map, rejects a wall, and accepts an open tile with the same walk counter stream', async () => {
    const world = await loadWorld(root);
    // Find a free tile immediately west of a wall, with free space to the south.
    const spawn = world.map.layers[0]!.find(({ x, y }) => x < 99 && y < 99 &&
      (world.map.blocked[tileIndex(x, y)]! & 15) === 0 &&
      !canEnter(world.map, x + 1, y, Heading.East) && canEnter(world.map, x, y + 1, Heading.South));
    expect(spawn).toBeDefined();
    world.spawn = spawn!;
    const server = await startStandin({ world, walkIntervalMs: 0 });
    const socket = createConnection({ host: server.host, port: server.port });
    const decoder = new FrameDecoder();
    const packets: ServerPacket[] = [];
    socket.on('data', chunk => {
      for (const body of decoder.push(chunk)) {
        const packet = decodeServerPacket(body);
        if (!('unknown' in packet)) packets.push(packet);
      }
    });
    const next = async (id: S) => {
      await expect.poll(() => packets.some(packet => packet.id === id)).toBe(true);
      return packets.splice(packets.findIndex(packet => packet.id === id), 1)[0]!;
    };
    const send = (packet: Parameters<typeof encodeClientFrame>[0]) => socket.write(encodeClientFrame(packet));
    try {
      await next(S.Connected);
      send({ id: C.LoginAccount, email: 'standin@local', password: 'testpass' });
      await next(S.AccountCharacterList);
      send({ id: C.LoginExistingChar, charId: 1, name: 'STANDIN' });
      await next(S.Logged);
      expect(await next(S.ChangeMap)).toEqual({ id: S.ChangeMap, map: 1, resourceMap: 1 });
      send({ id: C.Walk, heading: Heading.East, counter: 1 });
      expect(await next(S.PosUpdate)).toEqual({ id: S.PosUpdate, x: spawn!.x, y: spawn!.y });
      send({ id: C.Walk, heading: Heading.South, counter: 2 });
      send({ id: C.RequestPositionUpdate });
      expect(await next(S.PosUpdate)).toEqual({ id: S.PosUpdate, x: spawn!.x, y: spawn!.y + 1 });
    } finally { socket.destroy(); await server.close(); }
  });
});
