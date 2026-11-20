/*
 * Headless protocol probe, AGPL-3.0-or-later. Sequencing adapted 2026-11-20 from
 * Argentum 20 client/server Protocol and Modulo_UsUaRiOs.
 * Copyright (C) 2023-2026 Noland Studios LTD; based on Argentum Online 0.11.6,
 * Copyright (C) 2002 Márquez Pablo Ignacio, and Baronsoft's VB6 Online RPG.
 * WITHOUT ANY WARRANTY. See ../../../LICENSE and ../../../NOTICE.
 */
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ClientPacketId as C, ServerPacketId as S, Heading, FrameDecoder,
  decodeServerPacket, encodeClientFrame,
} from '@ao/protocol';
import type { CharacterCreate, ClientPacket, Intervals } from '@ao/protocol';

export interface BotOptions {
  host: string;
  port: number;
  email: string;
  password: string;
  log?: (message: string) => void;
  /** Library-only timing overrides for tests. CLI always observes at least 30s. */
  observationMs?: number;
  loginTimeoutMs?: number;
  responseWaitMs?: number;
  stepMarginMs?: number;
}

export interface BotResult {
  connectedMs: number;
  observedMs: number;
  walksSent: number;
  confirmedWalks: number;
  inferredWalks: number;
  correctedWalks: number;
  map: number;
  position: { x: number; y: number };
}

interface Step {
  expected: { x: number; y: number };
  confirmed: boolean;
  corrected: boolean;
}

export async function runBot(options: BotOptions): Promise<BotResult> {
  const log = options.log ?? (() => {});
  const observationMs = options.observationMs ?? 30_000;
  const responseWaitMs = options.responseWaitMs ?? 1000;
  const stepMarginMs = options.stepMarginMs ?? 100;
  const loginTimeoutMs = options.loginTimeoutMs ?? 10_000;
  for (const value of [observationMs, responseWaitMs, stepMarginMs, loginTimeoutMs]) {
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid bot timing');
  }
  const abort = new AbortController();
  const ready = Promise.withResolvers<void>();
  const decoder = new FrameDecoder();
  const characters = new Map<number, CharacterCreate>();
  const socket = createConnection({ host: options.host, port: options.port });
  socket.setNoDelay(true);
  let phase: 'connected' | 'account' | 'login' | 'playing' = 'connected';
  let connectedAt: number | undefined;
  let loggedAt: number | undefined;
  let map: number | undefined;
  let charIndex: number | undefined;
  let position: { x: number; y: number } | undefined;
  let intervals: Intervals | undefined;
  let speeding = 1;
  let step: Step | undefined;
  let walksSent = 0;
  let confirmedWalks = 0;
  let correctedWalks = 0;
  let inferredWalks = 0;
  let finished = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const fail = (error: unknown) => {
    if (finished || abort.signal.aborted) return;
    let reason = error instanceof Error ? error : new Error(String(error));
    if (decoder.pendingBytes > 0) {
      try { decoder.finish(); }
      catch (partial) { reason = new Error(`${reason.message}; ${String(partial)}`); }
    }
    log(`STOP ${reason.message}`);
    abort.abort(reason);
    ready.reject(reason);
    socket.destroy();
  };
  const send = (packet: ClientPacket) => {
    if (socket.destroyed || abort.signal.aborted) throw new Error('TCP connection is closed');
    log(`send ${C[packet.id]}(${packet.id})${packet.id === C.Walk ? ` counter=${packet.counter} heading=${packet.heading}` : ''}`);
    socket.write(encodeClientFrame(packet));
  };
  const maybeReady = () => {
    if (phase === 'playing' && map !== undefined && charIndex !== undefined && position && intervals) ready.resolve();
  };
  const observePosition = (x: number, y: number) => {
    log(`position map=${map ?? '?'} x=${x} y=${y}`);
    if (step) {
      if (x === step.expected.x && y === step.expected.y) step.confirmed = true;
      else step.corrected = true;
    } else if (position && (x !== position.x || y !== position.y)) {
      // A late correction cannot leave prior silence-based claims counted as accepted.
      inferredWalks = 0;
    }
    position = { x, y };
  };

  const loginTimer = setTimeout(() => fail(new Error('Timed out waiting for login, placement and intervals')), loginTimeoutMs);
  socket.on('connect', () => { connectedAt = performance.now(); log(`TCP connected ${options.host}:${options.port}`); });
  socket.on('data', chunk => {
    try {
      for (const body of decoder.push(chunk)) {
        const packet = decodeServerPacket(body);
        if ('unknown' in packet) {
          log(`skip unknown server id=${packet.id} payloadBytes=${packet.payload.length} (complete frame)`);
          continue;
        }
        log(`recv ${S[packet.id]}(${packet.id})`);
        switch (packet.id) {
          case S.Connected:
            if (phase !== 'connected') throw new Error('Unexpected duplicate Connected');
            log(`Connected debugging=${packet.debugging}`);
            phase = 'account';
            send({ id: C.LoginAccount, email: options.email, password: options.password });
            break;
          case S.AccountCharacterList: {
            if (phase !== 'account') throw new Error('Unexpected AccountCharacterList');
            const first = packet.characters[0];
            if (!first || first.id <= 0 || first.name.length === 0) throw new Error('Account has no selectable character');
            log(`select first character id=${first.id} name=${JSON.stringify(first.name)}`);
            phase = 'login';
            send({ id: C.LoginExistingChar, charId: first.id, name: first.name });
            break;
          }
          case S.Logged:
            if (phase !== 'login') throw new Error('Unexpected Logged');
            phase = 'playing';
            loggedAt = performance.now();
            break;
          case S.ChangeMap:
            if (step) step.corrected = true;
            map = packet.map;
            position = undefined;
            charIndex = undefined;
            characters.clear();
            inferredWalks = 0;
            log(`map=${packet.map} resourceMap=${packet.resourceMap}`);
            break;
          case S.CharacterCreate:
            characters.set(packet.charIndex, packet);
            if (packet.charIndex === charIndex) {
              observePosition(packet.x, packet.y);
              speeding = packet.speeding;
            }
            break;
          case S.UserCharIndexInServer: {
            charIndex = packet.charIndex;
            const self = characters.get(charIndex);
            if (self) { observePosition(self.x, self.y); speeding = self.speeding; }
            break;
          }
          case S.PosUpdate:
            observePosition(packet.x, packet.y);
            break;
          case S.PosUpdateUserChar:
          case S.PosUpdateChar:
          case S.CharacterMove: {
            const character = characters.get(packet.charIndex);
            if (character) characters.set(packet.charIndex, { ...character, x: packet.x, y: packet.y });
            if (packet.charIndex === charIndex) observePosition(packet.x, packet.y);
            break;
          }
          case S.Intervals:
            if (packet.walk < 0 || packet.walk > 60_000) throw new Error(`Unusable walk interval ${packet.walk}`);
            intervals = packet;
            log(`walk interval=${packet.walk}ms`);
            break;
          case S.ErrorMsg: throw new Error(`Server ErrorMsg: ${packet.message}`);
          case S.Disconnect: throw new Error(`Server Disconnect fullLogout=${packet.fullLogout}`);
        }
        maybeReady();
      }
    } catch (error) { fail(error); }
  });
  socket.on('error', fail);
  socket.on('end', () => {
    try { decoder.finish(); fail(new Error('TCP ended before observation completed')); }
    catch (error) { fail(error); }
  });
  socket.on('close', () => {
    try { decoder.finish(); fail(new Error('TCP closed before observation completed')); }
    catch (error) { fail(error); }
  });

  try {
    await ready.promise;
    clearTimeout(loginTimer);
    log(`Logged and placed; observing for at least ${observationMs}ms`);
    heartbeat = setInterval(() => {
      if (!step) {
        try { send({ id: C.RequestPositionUpdate }); }
        catch (error) { fail(error); }
      }
    }, 5000);
    const pause = (ms: number) => delay(ms, undefined, { signal: abort.signal });
    for (const heading of [Heading.East, Heading.East, Heading.South, Heading.West, Heading.North]) {
      if (!position || !intervals || !Number.isFinite(speeding)) throw new Error('Missing current placement or interval');
      const interval = Math.ceil(intervals.walk / (speeding > 0 ? speeding : 1)) + stepMarginMs;
      await pause(Math.max(1, interval));
      // Placement may have changed during the wait.
      if (!position) throw new Error('Map changed without replacement placement');
      step = {
        expected: {
          x: position.x + (heading === Heading.East ? 1 : heading === Heading.West ? -1 : 0),
          y: position.y + (heading === Heading.South ? 1 : heading === Heading.North ? -1 : 0),
        },
        confirmed: false, corrected: false,
      };
      send({ id: C.Walk, heading, counter: ++walksSent });
      await pause(Math.max(1, interval));
      // RequestPositionUpdate is source-verified; its PosUpdate response is authoritative.
      send({ id: C.RequestPositionUpdate });
      await pause(responseWaitMs);
      if (step.corrected) {
        correctedWalks++;
        log(`walk ${walksSent} corrected/rejected`);
      } else if (step.confirmed) {
        confirmedWalks++;
        log(`walk ${walksSent} accepted: server position changed`);
      } else {
        inferredWalks++;
        position = { ...step.expected };
        log(`walk ${walksSent} provisionally accepted: no correction (inference)`);
      }
      step = undefined;
    }
    while (performance.now() - loggedAt! < observationMs) {
      await pause(Math.ceil(observationMs - (performance.now() - loggedAt!)));
    }
    if (abort.signal.aborted) throw abort.signal.reason;
    decoder.finish();
    if (confirmedWalks + inferredWalks === 0) throw new Error('No walk accepted');
    if (socket.destroyed || !position || map === undefined || connectedAt === undefined) throw new Error('Connection or placement lost');
    const result: BotResult = {
      connectedMs: performance.now() - connectedAt,
      observedMs: performance.now() - loggedAt!, walksSent, confirmedWalks, inferredWalks, correctedWalks,
      map, position,
    };
    finished = true;
    log(`SUCCESS ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    throw abort.signal.aborted ? abort.signal.reason : error;
  } finally {
    finished = true;
    clearTimeout(loginTimer);
    if (heartbeat) clearInterval(heartbeat);
    socket.destroy();
  }
}
