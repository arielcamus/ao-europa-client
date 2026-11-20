/*
 * TEST STAND-IN so client development is unblocked. NOT a game server.
 * The real target is the ao-org VB6 server; this fixture cannot prove live compatibility.
 * Protocol sequencing adapted 2026-11-20 from Argentum 20 classic server sources.
 * Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later.
 * Based on Argentum Online 0.11.6, Copyright (C) 2002 Márquez Pablo Ignacio,
 * and Baronsoft's VB6 Online RPG (aaron@baronsoft.com).
 * WITHOUT ANY WARRANTY, including MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See ../../../LICENSE and ../../../NOTICE.
 */
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import {
  ClientPacketId as C, ServerPacketId as S, Heading, FrameDecoder,
  decodeClientPacket, encodeServerFrame,
} from '@ao/protocol';
import type { AccountCharacter, CharacterCreate, Intervals, ServerPacket } from '@ao/protocol';

export interface StandinOptions {
  host?: string;
  port?: number;
  debugging?: boolean;
  email?: string;
  password?: string;
  walkIntervalMs?: number;
  /** Test failure path: every walk is corrected to the unchanged position. */
  rejectWalks?: boolean;
  /** Synthetic classic UI data, only for explicit browser fixture launches. */
  classicUi?: boolean;
  log?: (message: string) => void;
}

const character: AccountCharacter = {
  id: 1, name: 'STANDIN', body: 1, head: 1, characterClass: 1, map: 1,
  x: 50, y: 50, level: 1, status: 1, helmet: 0, shield: 0, weapon: 0, backpack: 0,
};

function placement(): CharacterCreate {
  return {
    charIndex: 1, body: 1, head: 1, heading: Heading.South, x: character.x, y: character.y,
    weapon: 0, shield: 0, helmet: 0, cart: 0, backpack: 0, fx: 0, fxLoops: 0,
    name: character.name, status: 1, privileges: 0, particleFx: 0, headAura: '',
    weaponAura: '', bodyAura: '', damageAura: '', resistanceAura: '', otherAura: '', shieldAura: '',
    speeding: 1, npc: 0, appear: 1, groupIndex: 0, clanIndex: 0, clanLevel: 0,
    minHp: 100, maxHp: 100, minMana: 0, maxMana: 0, symbol: 0, flags: 1,
    userType: 0, team: 0, flag: 0, npcNumber: 0, clanAlignment: 0,
  };
}

function intervals(walk: number): Intervals {
  return {
    hit: 1000, bow: 1000, magic: 1000, extractWork: 1000, buildWork: 1000,
    walk, dropItem: 500, useItemKey: 500, useItemClick: 500, hitMagic: 1000,
    magicHit: 1000, hitUseItem: 500, hide: 1000, talk: 500, leftClick: 500, meditate: 1000,
  };
}

export async function startStandin(options: StandinOptions = {}) {
  const log = options.log ?? (() => {});
  const walkInterval = options.walkIntervalMs ?? 300;
  if (!Number.isInteger(walkInterval) || walkInterval < 0 || walkInterval > 60_000) {
    throw new Error('walkIntervalMs must be an integer in 0..60000');
  }
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.setNoDelay(true);
    const decoder = new FrameDecoder();
    let phase: 'account' | 'character' | 'playing' | 'closed' = 'account';
    let counter = 0;
    let talkCounter = 0;
    let lastWalk = -Infinity;
    let x = character.x;
    let y = character.y;
    const send = (packet: ServerPacket) => socket.write(encodeServerFrame(packet));
    const reject = (message: string) => {
      if (phase === 'closed') return;
      phase = 'closed';
      log(`rejected: ${message}`);
      socket.end(encodeServerFrame({ id: S.ErrorMsg, message }));
    };
    log('TCP connected');
    send({ id: S.Connected, debugging: options.debugging ?? false });
    socket.on('data', chunk => {
      try {
        for (const body of decoder.push(chunk)) {
          if (phase === 'closed') break;
          const packet = decodeClientPacket(body);
          if ('unknown' in packet) throw new Error(`Unsupported client packet id=${packet.id}`);
          log(`recv ${C[packet.id]}(${packet.id})`);
          switch (packet.id) {
            case C.LoginAccount:
              if (phase !== 'account') throw new Error('LoginAccount out of order');
              if (packet.email !== (options.email ?? 'standin@local') || packet.password !== (options.password ?? 'testpass')) {
                reject('Invalid stand-in credentials');
                break;
              }
              phase = 'character';
              send({ id: S.AccountCharacterList, characters: [{ ...character }] });
              break;
            case C.LoginExistingChar:
              if (phase !== 'character' || packet.charId !== character.id || packet.name !== character.name) {
                throw new Error('Invalid or out-of-order character selection');
              }
              phase = 'playing';
              // Real login order, coalesced in one TCP write but still ONE message per frame.
              socket.write(Buffer.concat(([
                { id: S.Intervals, ...intervals(walkInterval) },
                { id: S.ChangeMap, map: 1, resourceMap: 1 },
                { id: S.CharacterCreate, ...placement() },
                { id: S.UserCharIndexInServer, charIndex: 1 },
                { id: S.Logged, newUser: false },
              ] satisfies ServerPacket[]).map(encodeServerFrame)));
              if (options.classicUi) {
                send({ id: S.UpdateUserStats, maxHp: 100, hp: 80, shield: 0, maxMana: 80, mana: 60,
                  maxStamina: 100, stamina: 90, gold: 1200, goldPerLevel: 1000, level: 1, nextLevel: 100, experience: 25, characterClass: 1 });
                send({ id: S.UpdateHungerAndThirst, maxWater: 100, water: 75, maxFood: 100, food: 85 });
                send({ id: S.InventoryUnlockSlots, rows: 0 });
                for (const [slot, object, amount] of [[1, 1, 5], [2, 2, 1]] as const) send({
                  id: S.ChangeInventorySlot, slot, object, amount, equipped: false, value: 0, canUse: 1, elementalTags: 0, bindable: false,
                });
                for (const slot of [1, 2, 3]) send({ id: S.ChangeSpellSlot, slot, spell: slot, index: slot, bindable: false });
                send({ id: S.ConsoleMsg, message: 'Bienvenido a Ullathorpe. Inventario y hechizos de prueba local.', font: 0, channel: 0 });
              }
              break;
            case C.Talk:
              if (phase !== 'playing' || !options.classicUi) throw new Error('Talk unavailable in this fixture');
              if (packet.counter !== ++talkCounter) throw new Error('Non-increasing talk counter');
              // The VB6 server answers Talk with a ChatOverHead to the area (the client copies it to the console).
              send({ id: S.ChatOverHead, chat: packet.message, charIndex: 1, color: 0xffffff, isSpell: false, x, y, minTime: 0, maxTime: 0 });
              break;
            case C.Yell:
              if (phase !== 'playing' || !options.classicUi) throw new Error('Yell unavailable in this fixture');
              send({ id: S.ChatOverHead, chat: packet.message, charIndex: 1, color: 0x0000ff, isSpell: false, x, y, minTime: 0, maxTime: 0 });
              break;
            case C.Whisper:
              if (phase !== 'playing' || !options.classicUi) throw new Error('Whisper unavailable in this fixture');
              send({ id: S.ConsoleCharText, message: packet.message, color: 0x14e29d, sourceName: character.name, sourceStatus: 1, privileges: 0 });
              break;
            case C.GroupMessage:
              if (phase !== 'playing' || !options.classicUi) throw new Error('Group chat unavailable in this fixture');
              send({ id: S.ConsoleMsg, message: `${character.name}> ${packet.message}`, font: 31, channel: 6 });
              break;
            case C.GuildMessage:
              if (phase !== 'playing' || !options.classicUi) throw new Error('Guild chat unavailable in this fixture');
              send({ id: S.GuildChat, status: 1, message: `${character.name}> ${packet.message}` });
              break;
            case C.Walk: {
              if (phase !== 'playing') throw new Error('Walk before login');
              if (packet.counter !== counter + 1) throw new Error('Non-increasing walk counter');
              counter = packet.counter;
              const nextX = x + (packet.heading === Heading.East ? 1 : packet.heading === Heading.West ? -1 : 0);
              const nextY = y + (packet.heading === Heading.South ? 1 : packet.heading === Heading.North ? -1 : 0);
              const now = performance.now();
              if (options.rejectWalks || now - lastWalk < walkInterval || nextX < 1 || nextX > 100 || nextY < 1 || nextY > 100) {
                log(`walk ${counter} corrected to ${x},${y}`);
                send({ id: S.PosUpdate, x, y });
              } else {
                x = nextX; y = nextY; lastWalk = now;
                log(`walk ${counter} accepted at ${x},${y}; no self acknowledgement`);
              }
              break;
            }
            case C.RequestPositionUpdate:
              if (phase !== 'playing') throw new Error('Position request before login');
              send({ id: S.PosUpdate, x, y });
              break;
          }
        }
      } catch (error) { reject(error instanceof Error ? error.message : String(error)); }
    });
    socket.on('end', () => {
      try { decoder.finish(); }
      catch (error) { log(String(error)); }
    });
    socket.on('error', error => log(`socket error: ${error.message}`));
    socket.on('close', () => { sockets.delete(socket); log('TCP closed'); });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing TCP listen address');
  log(`TEST STAND-IN listening ${address.address}:${address.port}; real target: ao-org VB6 server`);
  return {
    server, host: address.address, port: address.port,
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
