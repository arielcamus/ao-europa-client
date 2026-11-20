/*
 * Browser session sequencing adapted from classic Protocol/Modulo_UsUaRiOs.
 * Copyright (C) 2023-2026 Noland Studios. AGPL-3.0-or-later; no warranty.
 * See ../../../LICENSE and ../../../NOTICE.
 */
import { ClientPacketId as C, ServerPacketId as S, Heading, FrameDecoder, decodeServerPacket, encodeClientFrame } from '@ao/protocol';
import type { CharacterCreate, ClientPacket } from '@ao/protocol';
import { ClassicState } from './ui-state.js';

export interface Position { x: number; y: number }
export interface Motion { from: Position; to: Position; started: number; duration: number }
export type Phase = 'connecting' | 'account' | 'login' | 'playing' | 'closed';

/** Transport-independent state. Only one position query/walk may be outstanding. */
export class Session {
  readonly ui = new ClassicState();
  characterLevel: number | undefined;
  phase: Phase = 'connecting';
  map: number | undefined;
  resourceMap: number | undefined;
  charIndex: number | undefined;
  position: Position | undefined;
  motion: Motion | undefined;
  characters = new Map<number, CharacterCreate>();
  walksSent = 0;
  confirmedWalks = 0;
  correctedWalks = 0;
  unknownFrames = 0;
  walkInterval: number | undefined;
  connectedAt: number;
  loggedAt: number | undefined;
  error = '';
  private decoder = new FrameDecoder();
  private pending: { expected?: Position; since: number } | undefined;
  private lastWalk = -Infinity;
  private lastQuery = 0;
  private talkCounter = 0;
  private lastTalk = -Infinity;
  private talkInterval = 500;
  private placementDeadline: number;
  private credentials: { email: string; password: string } | undefined;

  constructor(
    credentials: { email: string; password: string },
    private readonly write: (bytes: Uint8Array) => void,
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.credentials = { ...credentials };
    this.connectedAt = clock();
    this.placementDeadline = this.connectedAt + 10_000;
  }
  get self() { return this.charIndex === undefined ? undefined : this.characters.get(this.charIndex); }
  get ready() {
    return this.phase === 'playing' && this.position !== undefined && this.self !== undefined && this.resourceMap !== undefined && this.walkInterval !== undefined;
  }
  get stepMs() { return Math.max(50, Math.ceil((this.walkInterval ?? 300) / (this.self?.speeding || 1))) + 30; }

  private send(packet: ClientPacket) { this.write(encodeClientFrame(packet)); }
  receive(bytes: Uint8Array): void {
    if (this.phase === 'closed') return;
    for (const body of this.decoder.push(bytes)) {
      const packet = decodeServerPacket(body);
      if ('unknown' in packet) { this.unknownFrames++; continue; }
      this.ui.receive(packet);
      switch (packet.id) {
        case S.Connected:
          if (this.phase !== 'connecting' || !this.credentials) throw new Error('Unexpected Connected');
          this.phase = 'account';
          this.send({ id: C.LoginAccount, ...this.credentials });
          this.credentials = undefined;
          break;
        case S.AccountCharacterList: {
          if (this.phase !== 'account') throw new Error('Unexpected character list');
          const first = packet.characters[0];
          if (!first || first.id <= 0 || !first.name) throw new Error('This account has no character');
          this.phase = 'login';
          this.characterLevel = first.level;
          this.send({ id: C.LoginExistingChar, charId: first.id, name: first.name });
          break;
        }
        case S.ChangeMap:
          this.map = packet.map; this.resourceMap = packet.resourceMap;
          this.position = undefined; this.motion = undefined; this.pending = undefined;
          this.placementDeadline = this.clock() + 10_000;
          this.characters.clear();
          // Retain self index across warps; require a fresh CharacterCreate for placement.
          break;
        case S.CharacterCreate:
          if (!Number.isFinite(packet.speeding) || packet.speeding < 0 || packet.speeding > 100) throw new Error('Invalid character speed');
          if (packet.heading < 1 || packet.heading > 4) throw new Error('Invalid character heading');
          this.validPosition(packet);
          this.characters.set(packet.charIndex, packet);
          if (this.charIndex === packet.charIndex) this.place(packet.x, packet.y);
          break;
        case S.UserCharIndexInServer:
          this.charIndex = packet.charIndex;
          if (this.self) this.place(this.self.x, this.self.y);
          break;
        case S.Logged:
          if (this.phase !== 'login') throw new Error('Unexpected Logged');
          this.phase = 'playing'; this.loggedAt = this.clock(); this.lastQuery = this.clock();
          break;
        case S.Intervals:
          if (packet.walk < 0 || packet.walk > 60_000) throw new Error('Invalid walk interval');
          this.walkInterval = packet.walk;
          this.talkInterval = Math.max(500, packet.talk);
          break;
        case S.PosUpdate: this.place(packet.x, packet.y); break;
        case S.PosUpdateUserChar:
        case S.PosUpdateChar:
        case S.CharacterMove: {
          this.validPosition(packet);
          const character = this.characters.get(packet.charIndex);
          if (character) this.characters.set(packet.charIndex, { ...character, x: packet.x, y: packet.y });
          if (packet.charIndex === this.charIndex) this.place(packet.x, packet.y);
          break;
        }
        case S.ErrorMsg: throw new Error(`Server: ${packet.message}`);
        case S.Disconnect: throw new Error('The server disconnected this character');
      }
    }
  }
  private validPosition(position: Position) {
    if (position.x < 1 || position.y < 1 || position.x > 100 || position.y > 100) throw new Error('Server position outside map');
  }
  private place(x: number, y: number) {
    this.validPosition({ x, y });
    const expected = this.pending?.expected;
    if (expected) {
      if (x === expected.x && y === expected.y) this.confirmedWalks++;
      else this.correctedWalks++;
    }
    if (this.position && (x !== this.position.x || y !== this.position.y)) this.motion = undefined;
    this.pending = undefined;
    this.position = { x, y };
    if (this.self) this.characters.set(this.self.charIndex, { ...this.self, x, y });
  }
  walk(heading: Heading): boolean {
    const now = this.clock();
    if (!this.ready || this.pending || now - this.lastWalk < this.stepMs || !this.position || !this.self) return false;
    if (![Heading.North, Heading.East, Heading.South, Heading.West].includes(heading)) return false;
    const to = {
      x: this.position.x + (heading === Heading.East ? 1 : heading === Heading.West ? -1 : 0),
      y: this.position.y + (heading === Heading.South ? 1 : heading === Heading.North ? -1 : 0),
    };
    if (to.x < 1 || to.y < 1 || to.x > 100 || to.y > 100) return false;
    this.motion = { from: this.position, to, started: now, duration: this.stepMs - 30 };
    this.position = to;
    this.characters.set(this.self.charIndex, { ...this.self, ...to, heading });
    this.pending = { expected: to, since: now };
    this.lastWalk = now;
    this.lastQuery = now;
    this.send({ id: C.Walk, heading, counter: ++this.walksSent });
    // TCP order ensures the position probe follows this walk. Silence never counts as success.
    this.send({ id: C.RequestPositionUpdate });
    return true;
  }
  tick(): void {
    const now = this.clock();
    if (this.phase === 'closed') return;
    if (!this.ready && now > this.placementDeadline) throw new Error('Timed out waiting for login, placement and intervals');
    if (this.pending && now - this.pending.since > 5000) throw new Error('Server stopped responding to position requests');
    if (this.ready && !this.pending && now - this.lastQuery > 5000) {
      this.pending = { since: now }; this.lastQuery = now;
      this.send({ id: C.RequestPositionUpdate });
    }
  }
  talk(message: string): boolean {
    if (!this.ready || this.clock() - this.lastTalk < this.talkInterval) return false;
    if (!message.trim() || message.length > 160 || new TextEncoder().encode(message).length > 255) return false;
    this.send({ id: C.Talk, message, counter: ++this.talkCounter });
    this.lastTalk = this.clock();
    return true;
  }
  finish(message = 'Disconnected'): void {
    this.phase = 'closed'; this.error = message; this.credentials = undefined;
    this.pending = undefined; this.motion = undefined;
    this.decoder.finish();
  }
  visualPosition(now: number): Position | undefined {
    if (!this.motion) return this.position;
    const t = Math.min(1, Math.max(0, (now - this.motion.started) / this.motion.duration));
    return { x: this.motion.from.x + (this.motion.to.x - this.motion.from.x) * t, y: this.motion.from.y + (this.motion.to.y - this.motion.from.y) * t };
  }
}
