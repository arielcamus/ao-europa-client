/*
 * Browser session sequencing adapted from classic Protocol/Modulo_UsUaRiOs.
 * Copyright (C) 2023-2026 Noland Studios. AGPL-3.0-or-later; no warranty.
 * See ../../../LICENSE and ../../../NOTICE.
 */
import { ClientPacketId as C, CombatClientPacketId as CC, ServerPacketId as S, Heading, FrameDecoder, decodeServerPacket, encodeClientFrame } from '@ao/protocol';
import { StatusClientPacketId } from '@ao/protocol';
import { DoorClientPacketId, DoorServerPacketId as DoorServer, KeysServerPacketId as KS } from '@ao/protocol';
import type { CharacterCreate, ClientPacket, ServerPacket } from '@ao/protocol';
import { ClassicState } from './ui-state.js';
import { MapObjects } from './map-objects.js';
import { PacketCounters, SEQUENCED_CLIENT_PACKETS } from './packet-counters.js';
import type { PacketFamily } from './packet-counters.js';
import { CharacterTracker, characterChange } from './characters.js';
import { NpcsServerPacketId as NS } from '@ao/protocol';
import { CombatState } from './combat.js';
import { SpellState } from './spells.js';
import { CraftingController, CraftingState } from './crafting.js';
import { SkillsState } from './skills.js';
import { SkillsClientPacketId as SC } from '@ao/protocol';
import { StatusState, STATUS_TEXT, STATUS_FONT } from './status.js';
import { ItemsState } from './items-state.js';
import { ItemsController } from './items.js';
import type { ObjectCatalog } from './object-catalog.js';
import { BankTradeState } from './bank-trade-state.js';
import { BankTradeController } from './bank-trade.js';
import { WorldFx } from './fx-world.js';
import { QuestsState } from './quests.js';
import { QuestClientPacketId as QC, QuestServerPacketId as QS } from '@ao/protocol';

import { PartyState } from './party.js';
import { GuildState } from './guild.js';
import { OptionsController, OptionsState } from './options-state.js';

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
  /** Party frames and the member window (wp07). */
  readonly party = new PartyState();
  /** Guild forms and their data (wp07). */
  readonly guild = new GuildState();
  readonly spells: SpellState;
  /** Blind, dumb, paralysis, stun, invisibility, safes, bars, traps (feat/combat-spells-2). */
  readonly status: StatusState;
  /** Random source of the dumb effect (General.MoveTo RandomNumber); tests replace it. */
  random: () => number = Math.random;
  readonly items = new ItemsState();
  /** Time of day, light, weather, particles and projectiles (feat/world-fx). */
  readonly world: WorldFx;
  readonly craftingState = new CraftingState();
  /** Smith, carpenter, alchemy and tailor windows, the crafting station and the work macro (feat/crafting). */
  readonly crafting = new CraftingController({
    send: packet => this.send(packet), ready: () => this.ready, now: () => this.clock(), stamina: () => this.ui.stats.stamina,
    message: (text, font) => this.ui.message(text, font),
  }, this.craftingState);
  /** Skills, attributes, statistics, trainer list, rest and meditation (feat/skills). */
  readonly skills = new SkillsState();
  /** Set by the UI once Dat/Obj.dat is loaded; item actions that need object types wait for it. */
  catalog: ObjectCatalog | undefined;
  readonly itemActions = new ItemsController({
    send: packet => this.send(packet), now: () => this.clock(), ready: () => this.ready, position: () => this.position,
    ui: this.ui, state: this.items, catalog: () => this.catalog, next: family => this.next(family),
  });
  /** Observer called with every decoded server packet once the session state has applied it (audio). */
  onPacket: ((packet: ServerPacket) => void) | undefined;
  /** Bank vault, Goliath and player-to-player trade (feat/bank-trade). */
  readonly bankTrade = new BankTradeState();
  readonly bankTradeActions = new BankTradeController({ send: packet => this.send(packet), ready: () => this.ready }, this.bankTrade);
  /** Quest list, quest details and NPC quest offers (feat/quests). */
  readonly quests = new QuestsState();
  /** Server toggles, hotkeys, Goliath transfer (feat/options-extras). */
  readonly options = new OptionsState();
  readonly optionsActions = new OptionsController({
    send: packet => this.send(packet), ready: () => this.ready, dead: () => this.dead,
    message: text => this.ui.message(text), cancelTargeting: () => this.spells.cancel(),
  }, this.options);
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
    this.status = new StatusState((text, font) => this.ui.message(text, font), clock);
    this.world = new WorldFx(clock, {
      // CambioDeArea: characters and non-fixed objects outside the new area go (self stays).
      areaChanged: bounds => this.leaveArea(bounds),
      // Effect_Render_Slot arrival: the end effect is an FXs.ini FX on a character or tile.
      addFx: fx => this.spells.addFx({ ...fx, startedAt: this.clock() }),
      speedToChar: (charIndex, speeding) => this.setSpeeding(charIndex, speeding),
      charAt: (x, y) => this.tracker.at(x, y)?.charIndex,
    });
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
      this.quests.receive(packet);
      this.spells.receive(packet);
      this.party.selfCharIndex = this.charIndex;
      this.party.receive(packet);
      this.guild.receive(packet);
      this.status.receive(packet, blind => { this.world.blind = blind; });
      this.items.receive(packet);
      this.bankTrade.receive(packet);
      this.world.receive(packet);
      this.crafting.receive(packet);
      this.skills.receive(packet, {
        charIndex: this.charIndex, message: (text, font) => this.ui.message(text, font), infoChannel: () => this.ui.chatCombate,
        // HandleMeditateToggle: StartFx(..., Fx, -1) loops until the toggle comes back with Fx = 0.
        meditationFx: (charIndex, fx) => {
          this.spells.effects = this.spells.effects.filter(effect => !(effect.charIndex === charIndex && effect.loops < 0));
          if (fx !== 0) this.spells.addFx({ fx, charIndex, x: 0, y: 0, loops: -1, startedAt: this.clock() });
        },
      });
      this.options.receive(packet);
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
        case NS.CharacterChange: { // death (ghost), revival, equipping: the tracker's rule, applied to this copy too
          const character = this.characters.get(packet.charIndex);
          if (character) this.characters.set(packet.charIndex, { ...character, ...characterChange(character, packet), cart: packet.cart, backpack: packet.backpack, fx: packet.fx, fxLoops: packet.fxLoops });
          break;
        }
        case S.UserCharIndexInServer:
          this.charIndex = packet.charIndex;
          if (this.self) this.place(this.self.x, this.self.y);
          break;
        case S.Logged:
          if (this.phase !== 'login') throw new Error('Unexpected Logged');
          this.phase = 'playing'; this.loggedAt = this.clock(); this.lastQuery = this.clock();
          this.skills.resting = false; // HandleLogged: UserDescansar = False
          break;
        case S.Intervals:
          if (packet.walk < 0 || packet.walk > 60_000) throw new Error('Invalid walk interval');
          this.walkInterval = packet.walk;
          this.talkInterval = Math.max(500, packet.talk);
          this.clickInterval = Math.max(100, packet.leftClick);
          this.hitInterval = packet.hit;
          break;
        // HandleQuestListSend asks for the details of the first quest at once.
        case QS.QuestListSend: if (packet.quests.length) this.requestQuestDetails(1); break;
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
        case NS.CharacterRemove: if (packet.charIndex !== this.charIndex) { this.characters.delete(packet.charIndex); this.status.forget(packet.charIndex); } break;
        // LocaleMsg (141) reaches the console through ui.receive -> ChatState (one print, chat's pipeline).
        case KS.SafeModeOn: this.safeMode = true; break;
        case KS.SafeModeOff: this.safeMode = false; break;
        case S.ErrorMsg: throw new Error(`Server: ${packet.message}`);
        case S.Disconnect: throw new Error('The server disconnected this character');
      }
      this.onPacket?.(packet);
    }
  }
  /** ModAreas.CambioDeArea: erase every character (not self) and server-sent object outside the new area; fixed map objects stay (renderer). */
  private leaveArea(bounds: { minX: number; maxX: number; minY: number; maxY: number }) {
    const outside = (x: number, y: number) => x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY;
    for (const [index, char] of [...this.tracker.chars]) if (index !== this.charIndex && outside(char.x, char.y)) this.tracker.chars.delete(index);
    for (const [index, char] of [...this.characters]) if (index !== this.charIndex && outside(char.x, char.y)) this.characters.delete(index);
    for (const key of [...this.mapObjects.objects.keys()]) {
      const x = (key % 100) + 1, y = Math.floor(key / 100) + 1;
      if (outside(x, y)) this.mapObjects.objects.delete(key);
    }
    this.tracker.revision++;
  }
  /** HandleSpeedToChar: the character's walk speed factor (Speeding); a zero factor reads as 1 like CharacterCreate. */
  private setSpeeding(charIndex: number, speeding: number) {
    if (!Number.isFinite(speeding) || speeding < 0 || speeding > 100) return;
    const tracked = this.tracker.chars.get(charIndex);
    if (tracked) tracked.speeding = speeding > 0 ? speeding : 1;
    const copy = this.characters.get(charIndex);
    if (copy) this.characters.set(charIndex, { ...copy, speeding });
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
    // pausa (HandlePauseToggle) stops keyboard movement, map clicks and item use.
    if (!this.ready || this.world.paused || this.pending || now - this.lastWalk < this.stepMs || !this.position || !this.self) return false;
    // MoveTo: a resting character does not walk; the first try only asks the server to stand up (UserAvisado).
    if (this.skills.resting) { if (!this.skills.standUpSent) { this.skills.standUpSent = true; this.send({ id: SC.Rest }); } return false; }
    if (![Heading.North, Heading.East, Heading.South, Heading.West].includes(heading)) return false;
    // General.MoveTo: Dumb sends a different heading half of the time; CanMove (paralysis, immobilisation, stun, stopped) blocks the step.
    if (this.status.dumb && Math.floor(this.random() * 100) + 1 < 50) {
      const others = [Heading.North, Heading.East, Heading.South, Heading.West].filter(h => h !== heading);
      heading = others[Math.min(2, Math.floor(this.random() * 3))]!;
    }
    if (!this.status.canMove(now)) return false;
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
    // MoveTo: a legal step ends the work macro first (ResetearUserMacro: FlagTrabajar + "Has dejado de trabajar...").
    if (this.crafting.macro.active) this.crafting.reset();
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
    // While an NPC shop is open (frmComerciar is modal in VB6) the map takes no clicks.
    if (!this.ready || this.world.paused || this.items.shopOpen || now - this.lastClick < this.clickInterval || x < 1 || y < 1 || x > 100 || y > 100) return false;
    this.lastClick = now; return true;
  }
  clickInterval = 200;
  /** UserStats.estado = 1: HandleUpdateHP / HandleUpdateUserStats set it when HP reaches 0. */
  get dead() { return this.ui.stats.hp === 0; }
  /** Control key / attack action: WriteAttack (id 80, counter from the shared PacketCounters) paced by Intervals.hit. */
  attack(): boolean {
    if (!this.ready || this.world.paused || this.skills.resting) return false; // ModGameplayUI: If UserDescansar Then Exit Sub
    return this.combat.attack(this.clock(), this.hitInterval, this.dead, this.ui, () => this.send({ id: CC.Attack, counter: this.next('attack') }));
  }
  /** frmMain EstadisticasBoton (the skills arrow) -> RequestSkills; the form opens when SendSkills arrives. */
  requestSkills(): boolean { if (!this.ready) return false; this.skills.expectSkills(); this.send({ id: SC.RequestSkills }); return true; }
  /** frmMain ImgEstadisticas (Estadísticas in the info panel): RequestAtributes + RequestMiniStats; the form opens when both arrive. */
  requestStats(): boolean {
    if (!this.ready) return false;
    this.skills.expectStats(); this.send({ id: SC.RequestAtributes }); this.send({ id: SC.RequestMiniStats }); return true;
  }
  /** /EST: the server prints the character's statistics in the console. */
  requestStatsText(): boolean { if (!this.ready) return false; this.send({ id: SC.RequestStats }); return true; }
  /** FrmEstadisticas: the points ADDED to each of the 24 skills. All-zero is legal but pointless, so it is refused. */
  modifySkills(points: readonly number[]): boolean {
    if (!this.ready || points.length !== 24 || points.every(p => p === 0)) return false;
    if (points.some(p => !Number.isInteger(p) || p < 0 || p > 100)) return false;
    this.send({ id: SC.ModifySkills, points: [...points] }); return true;
  }
  /** /ENTRENAR: the server answers with the creature list of the selected trainer. */
  requestTrainerList(): boolean { if (!this.ready) return false; this.send({ id: SC.TrainList }); return true; }
  /** frmEntrenador Luchar: `creature` is the 1-based position in that list. */
  train(creature: number): boolean {
    if (!this.ready || !Number.isInteger(creature) || creature < 1 || creature > 255) return false;
    this.send({ id: SC.Train, creature }); return true;
  }
  /** /DESCANSAR. */
  rest(): boolean { if (!this.ready) return false; this.send({ id: SC.Rest }); return true; }
  /** Quests button / WriteQuestListRequest: the server answers with QuestListSend. */
  requestQuestList(): boolean { if (!this.ready) return false; this.send({ id: QC.QuestListRequest }); return true; }
  /** WriteQuestDetailsRequest: `slot` is the 1-based position in the quest list. */
  requestQuestDetails(slot: number): boolean {
    if (!this.ready || !Number.isInteger(slot) || slot < 1 || slot > 255) return false;
    this.quests.requestedSlot = slot; this.send({ id: QC.QuestDetailsRequest, slot }); return true;
  }
  /** WriteQuestAccept: `slot` is the 1-based row of the offered-quest list; the server answers with a console line and an NPC symbol. */
  acceptQuest(slot: number): boolean {
    if (!this.ready || !Number.isInteger(slot) || slot < 1 || slot > 255) return false;
    this.send({ id: QC.QuestAccept, slot }); return true;
  }
  /** WriteQuestAbandon; the server answers with a fresh QuestListSend. */
  abandonQuest(slot: number): boolean {
    if (!this.ready || !Number.isInteger(slot) || slot < 1 || slot > 255) return false;
    this.send({ id: QC.QuestAbandon, slot }); return true;
  }
  /** ImgSegClan / ImgSegResu click: WriteSeguroClan, WriteSeguroResu. ImgLegionarySecure only prints that it is disabled (frmMain). */
  toggleSafe(which: 'clan' | 'resu' | 'legion'): boolean {
    if (!this.ready) return false;
    if (which === 'legion') { this.ui.message(STATUS_TEXT.legionDisabled, STATUS_FONT.INFO); return true; }
    this.send({ id: which === 'clan' ? StatusClientPacketId.SeguroClan : StatusClientPacketId.SeguroResu });
    return true;
  }
  talk(message: string): boolean {
    if (!this.ready || this.clock() - this.lastTalk < this.talkInterval) return false;
    if (!message.trim() || message.length > 160 || new TextEncoder().encode(message).length > 255) return false;
    this.send({ id: C.Talk, message, counter: this.next('talk') });
    this.lastTalk = this.clock();
    return true;
  }
  /** SafeModeOn/SafeModeOff (HandleSafeModeOn/Off: SeguroGame); undefined until the server says. */
  safeMode: boolean | undefined;
  /** A game-key packet (keymap.ts): same door as chat, counters filled from PacketCounters for sequenced ids (Work). */
  sendAction(packet: ClientPacket): boolean { return this.sendChat(packet); }
  /** The RefreshPosition key (WriteRequestPositionUpdate): one outstanding position probe at a time, like tick(). */
  refreshPosition(): boolean {
    if (!this.ready || this.pending) return false;
    this.pending = { since: this.clock() }; this.lastQuery = this.clock();
    this.send({ id: C.RequestPositionUpdate });
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
  /** Counterless party and guild requests (RequestGrupo, GuildRequestDetails ...); `send` still refuses a sequenced id without a shared counter. */
  sendPacket(packet: ClientPacket): boolean {
    if (!this.ready) return false;
    this.send(packet); return true;
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
