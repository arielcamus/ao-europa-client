/*
 * Browser session sequencing adapted from classic Protocol/Modulo_UsUaRiOs.
 * Copyright (C) 2023-2026 Noland Studios. AGPL-3.0-or-later; no warranty.
 * See ../../../LICENSE and ../../../NOTICE.
 */
import { ClientPacketId as C, CombatClientPacketId as CC, ServerPacketId as S, Heading, FrameDecoder, decodeServerPacket, encodeClientFrame } from '@ao/protocol';
import { DoorClientPacketId, DoorServerPacketId as DoorServer } from '@ao/protocol';
import type { CharacterCreate, ClientPacket } from '@ao/protocol';
import { ClassicState } from './ui-state.js';
import { MapObjects } from './map-objects.js';
import { PacketCounters, SEQUENCED_CLIENT_PACKETS } from './packet-counters.js';
import type { PacketFamily } from './packet-counters.js';
import { CharacterTracker } from './characters.js';
import { NpcsServerPacketId as NS } from '@ao/protocol';
import { CombatState } from './combat.js';
import { SpellState } from './spells.js';

export interface Position { x: number; y: number }
const inMap = (p: Position) => p.x >= 1 && p.y >= 1 && p.x <= 100 && p.y <= 100;
export interface Motion { from: Position; to: Position; started: number; duration: number }
export type Phase = 'connecting' | 'account' | 'login' | 'playing' | 'closed';

/** Transport-independent state. Only one position query/walk may be outstanding. */
export class Session {
  readonly ui = new ClassicState();
  /** Ground objects (doors included) and server block overrides for the current map. */
  readonly mapObjects = new MapObjects();
  /** Everybody on the map, with names, equipment, slides and overhead text (feat/npcs). */
  readonly tracker = new CharacterTracker();
  readonly combat = new CombatState();
  readonly spells: SpellState;
  characterLevel: number | undefined;
  phase: Phase = 'connecting';
  map: number | undefined;
  resourceMap: number | undefined;
  charIndex: number | undefined;
  position: Position | undefined;
  motion: Motion | undefined;
  characters = new Map<number, CharacterCreate>();
  /** Shared per-connection packet counters (never reset on ChangeMap). */
  readonly counters = new PacketCounters();
  next(family: PacketFamily): number { return this.counters.next(family); }
  get walksSent() { return this.counters.current('walk'); }
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
  private lastTalk = -Infinity;
  private talkInterval = 500;
  private hitInterval = 0;
  private placementDeadline: number;
  private credentials: { email: string; password: string } | undefined;

  constructor(
    credentials: { email: string; password: string },
    private readonly write: (bytes: Uint8Array) => void,
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.credentials = { ...credentials };
    this.ui.chat.clock = clock; this.ui.chat.characters = index => this.characters.get(index);
    this.connectedAt = clock();
    this.spells = new SpellState(packet => this.send(packet), clock, (text, font) => this.ui.message(text, font), family => this.next(family));
    this.placementDeadline = this.connectedAt + 10_000;
  }
  get self() { return this.charIndex === undefined ? undefined : this.characters.get(this.charIndex); }
  get ready() {
    return this.phase === 'playing' && this.position !== undefined && this.self !== undefined && this.resourceMap !== undefined && this.walkInterval !== undefined;
  }
  get stepMs() { return Math.max(50, Math.ceil((this.walkInterval ?? 300) / (this.self?.speeding || 1))) + 30; }

  /**
   * The one door to the socket. A sequence-checked packet must carry the counter that session.next(family) just issued; a counter
   * kept anywhere else would drift from the server's per-family counter and get the socket closed, so it is refused here.
   */
  private send(packet: ClientPacket) {
    const family = SEQUENCED_CLIENT_PACKETS[packet.id];
    if (family !== undefined) {
      const counter = (packet as { counter?: unknown }).counter;
      if (counter !== this.counters.current(family) || this.issued.get(family) === counter) {
        throw new Error(`Packet ${packet.id} must take its counter from session.next('${family}')`);
      }
      this.issued.set(family, counter);
    }
    this.write(encodeClientFrame(packet));
  }
  private readonly issued = new Map<string, number>();
  receive(bytes: Uint8Array): void {
    if (this.phase === 'closed') return;
    for (const body of this.decoder.push(bytes)) {
      const packet = decodeServerPacket(body);
      if ('unknown' in packet) { this.unknownFrames++; continue; }
      this.ui.receive(packet);
      this.tracker.receive(packet, this.clock());
      this.combat.receive(packet, {
        ui: this.ui, characters: this.characters, charIndex: this.charIndex, clock: this.clock,
        // CharAtaca blood goes into the one spell FX list; VB6 skips it when the victim is sailing.
        bleed: (charIndex, fx) => { if (!this.tracker.chars.get(charIndex)?.sailing) this.spells.addFx({ fx, charIndex, x: 0, y: 0, loops: 0, startedAt: this.clock() }); },
      });
      this.spells.receive(packet);
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
          this.characters.clear(); this.mapObjects.clear();
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
          this.clickInterval = Math.max(100, packet.leftClick);
          this.hitInterval = packet.hit;
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
        // Off-map coordinates are ignored (the VB6 client would index outside MapData); ObjIndex <= 0 clears the tile.
        case DoorServer.ObjectCreate:
          if (inMap(packet)) { if (packet.objIndex > 0) this.mapObjects.create(packet.x, packet.y, packet); else this.mapObjects.delete(packet.x, packet.y); }
          break;
        case DoorServer.ObjectDelete: if (inMap(packet)) this.mapObjects.delete(packet.x, packet.y); break;
        case DoorServer.BlockPosition: if (inMap(packet)) this.mapObjects.block(packet.x, packet.y, packet.sides); break;
        // The tracker owns appearance; this store (positions for the door rule, chat bubbles) only forgets who left.
        case NS.CharacterRemove: if (packet.charIndex !== this.charIndex) this.characters.delete(packet.charIndex); break;
        // LocaleMsg (141) reaches the console through ui.receive -> ChatState (one print, chat's pipeline).
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
    this.send({ id: C.Walk, heading, counter: this.next('walk') });
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
  /** Classic LeftClick on a map tile; the server opens/closes doors and uses world objects on it (HandleWorldAction). */
  leftClick(x: number, y: number): boolean {
    if (!this.canClick(x, y)) return false;
    this.send({ id: DoorClientPacketId.LeftClick, x, y, counter: this.next('leftClick') }); return true;
  }
  /** Classic DoubleClick; the reference server ignores it, kept for fidelity. */
  doubleClick(x: number, y: number): boolean {
    if (!this.canClick(x, y)) return false;
    this.send({ id: DoorClientPacketId.DoubleClick, x, y }); return true;
  }
  private lastClick = -Infinity;
  private canClick(x: number, y: number): boolean {
    const now = this.clock();
    if (!this.ready || now - this.lastClick < this.clickInterval || x < 1 || y < 1 || x > 100 || y > 100) return false;
    this.lastClick = now; return true;
  }
  clickInterval = 200;
  /** UserStats.estado = 1: HandleUpdateHP / HandleUpdateUserStats set it when HP reaches 0. */
  get dead() { return this.ui.stats.hp === 0; }
  /** Control key / attack action: WriteAttack (id 80, counter from the shared PacketCounters) paced by Intervals.hit. */
  attack(): boolean {
    if (!this.ready) return false;
    return this.combat.attack(this.clock(), this.hitInterval, this.dead, this.ui, () => this.send({ id: CC.Attack, counter: this.next('attack') }));
  }
  talk(message: string): boolean {
    if (!this.ready || this.clock() - this.lastTalk < this.talkInterval) return false;
    if (!message.trim() || message.length > 160 || new TextEncoder().encode(message).length > 255) return false;
    this.send({ id: C.Talk, message, counter: this.next('talk') });
    this.lastTalk = this.clock();
    return true;
  }
  /** Send a chat packet that is not Say (yell, whisper, guild, group, global...). */
  sendChat(packet: ClientPacket): boolean {
    if (!this.ready) return false;
    // A sequence-checked chat packet (GuildMessage) takes the session's shared counter, never one of its own.
    const family = SEQUENCED_CLIENT_PACKETS[packet.id];
    this.send(family ? { ...packet, counter: this.next(family) } as ClientPacket : packet);
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
