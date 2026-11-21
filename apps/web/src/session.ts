/*
 * Browser session sequencing adapted from classic Protocol/Modulo_UsUaRiOs.
 * Copyright (C) 2023-2026 Noland Studios. AGPL-3.0-or-later; no warranty.
 * See ../../../LICENSE and ../../../NOTICE.
 */
import { ClientPacketId as C, CombatClientPacketId as CC, ServerPacketId as S, Heading, FrameDecoder, decodeServerFrame, encodeClientFrame } from '@ao/protocol';
import { StatusClientPacketId, KeysClientPacketId } from '@ao/protocol';
import { DoorClientPacketId, DoorServerPacketId as DoorServer, KeysServerPacketId as KS } from '@ao/protocol';
import { SessionServerPacketId as SS, SessionClientPacketId as SCP, GmServerPacketId as GmServer } from '@ao/protocol';
import type { AccountCharacter, ClientPacket, ServerPacket } from '@ao/protocol';
import { ClassicState } from './ui-state.js';
import { MapObjects, tileKey } from './map-objects.js';
import { effectiveBlocked, inWalkBorders, isDeadBody, legalPos, type LegalContext, type LegalTile } from './movement.js';
import { privilegeIndex } from './character-data.js';
const HEADING_INTERVAL_MS = 120;
import { PacketCounters, SEQUENCED_CLIENT_PACKETS } from './packet-counters.js';
import type { PacketFamily } from './packet-counters.js';
import { CharacterTracker } from './characters.js';
import { NpcsServerPacketId as NS } from '@ao/protocol';
import { CombatState } from './combat.js';
import { SpellState, spellTables } from './spells.js';
import { meditationArt } from './meditation-fx.js';
import { CraftingController, CraftingState } from './crafting.js';
import { SkillsState } from './skills.js';
import { SkillsClientPacketId as SC } from '@ao/protocol';
import { StatusState, STATUS_TEXT, STATUS_FONT } from './status.js';
import { ItemsState } from './items-state.js';
import { ItemsController } from './items.js';
import { InventoryActions, KeyringState } from './keyring.js';
import type { ObjectCatalog } from './object-catalog.js';
import { BankTradeState } from './bank-trade-state.js';
import { BankTradeController } from './bank-trade.js';
import { WorldFx } from './fx-world.js';
import { QuestsState } from './quests.js';
import { QuestClientPacketId as QC, QuestServerPacketId as QS } from '@ao/protocol';

import { PartyState } from './party.js';
import { TravelState } from './travel.js';
import { ExtrasState } from './extras.js';
import { GuildState } from './guild.js';
import { OptionsController, OptionsState } from './options-state.js';
import { GmState } from './gm-state.js';

export interface Position { x: number; y: number }
const inMap = (p: Position) => p.x >= 1 && p.y >= 1 && p.x <= 100 && p.y <= 100;
const KS_QUIT = KeysClientPacketId.Quit;
/** `translate`: a CharacterTranslate glide, drawn without the walking animation or footsteps. */
export interface Motion { from: Position; to: Position; started: number; duration: number; translate?: boolean }
/** A position probe unanswered this long gets one console line (the character waits for it). */
export const SERVER_SILENT_MS = 5000;
export type Phase = 'connecting' | 'account' | 'login' | 'playing' | 'closed';
/**
 * Something the server wants the player to read outside the console: ShowMessageBox (a locale id the UI resolves, shown by
 * frmMensaje or the login assistant depending on the screen) or ErrorMsg (a VB6 MsgBox, then the server closes the socket).
 */
export type SessionNotice = { kind: 'box'; messageId: number; extra: string } | { kind: 'error'; text: string };
/** What the player entered on frmCrearPersonaje; the head must come from the race/gender head list (ModCabezas.DameOpciones). */
export interface NewCharacter { name: string; race: number; gender: number; characterClass: number; head: number; home: number }

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
  /** FrmViajes: the Transporter NPC's destinations (wp05). */
  readonly travel = new TravelState();
  readonly extras = new ExtrasState(() => this.clock(), text => this.ui.message(text));
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
    colored: (text, color, bold, italic) => this.ui.messageRgb(text, color, bold, italic),
    overhead: (text, color) => { if (this.charIndex !== undefined) this.ui.chat.showOwnDialog(this.charIndex, text, color); },
  }, this.craftingState);
  /** Skills, attributes, statistics, trainer list, rest and meditation (feat/skills). */
  readonly skills = new SkillsState();
  /** Set by the UI once Dat/Obj.dat is loaded; item actions that need object types wait for it. */
  catalog: ObjectCatalog | undefined;
  readonly itemActions = new ItemsController({
    send: packet => this.send(packet), now: () => this.clock(), ready: () => this.ready, position: () => this.position,
    ui: this.ui, state: this.items, catalog: () => this.catalog, next: family => this.next(family),
  });
  /** Key ring contents and the papyrus form (wp04), and the inventory move/delete packets. */
  readonly keyring = new KeyringState();
  readonly inventoryActions = new InventoryActions({ send: packet => this.send(packet), ready: () => this.ready, now: () => this.clock(), ui: this.ui, items: this.items });
  /** Observer called with every decoded server packet once the session state has applied it (audio). */
  onPacket: ((packet: ServerPacket) => void) | undefined;
  /** Bank vault, Goliath and player-to-player trade (feat/bank-trade). */
  readonly bankTrade = new BankTradeState();
  readonly bankTradeActions = new BankTradeController({ send: packet => this.send(packet), ready: () => this.ready }, this.bankTrade);
  /** Quest list, quest details and NPC quest offers (feat/quests). */
  readonly quests = new QuestsState();
  /** GM privileges, panel, SOS list, spawn and MOTD forms (wp12). */
  readonly gm = new GmState();
  /** Server toggles, hotkeys, Goliath transfer (feat/options-extras). */
  readonly options = new OptionsState();
  readonly optionsActions = new OptionsController({
    send: packet => this.send(packet), ready: () => this.ready, dead: () => this.dead,
    message: text => this.ui.message(text), cancelTargeting: () => this.spells.cancel(),
  }, this.options);
  characterLevel: number | undefined;
  /**
   * Interactive connect flow (the VB6 account screen). False keeps the historic behaviour that the bot, the stand-in tests and the
   * recorders rely on: the first character is entered automatically and a server error closes the session with a thrown error.
   */
  interactive = false;
  /** The account's characters from AccountCharacterList (HandleAccountCharacterList fills Pjs). */
  accountCharacters: AccountCharacter[] = [];
  /** Bumped every time the list arrives, so the account screen redraws. */
  accountRevision = 0;
  /** Queue of messages for the player (ShowMessageBox, ErrorMsg); the UI shifts them off. */
  readonly notices: SessionNotice[] = [];
  /**
   * The LoginNewChar / LoginExistingChar in flight, and whether the server has said anything about it (ShowMessageBox, ErrorMsg).
   * The server refuses several things by closing the socket with no message (TCP.ConnectNewUser: race, gender, home, head, ValidarNombre),
   * and the live server can drop the request entirely (char-create, 21 Nov): `silentLoginFailure` lets the UI explain instead of a bare login screen.
   */
  private loginAttempt: { kind: 'create' | 'enter'; answered: boolean } | undefined;
  noticeRevision = 0;
  /** Set by the UI: HandleDisconnect (back to the login screen), HandleCerrarleCliente (CloseClient) and HandleMostrarCuenta (account screen). */
  onDisconnect: (() => void) | undefined;
  onCloseClient: (() => void) | undefined;
  onShowAccount: (() => void) | undefined;
  /** UserNavegando, UserMontado, UserNadando, UserNadandoTrajeCaucho (the toggle packets). */
  readonly movement = { sailing: false, riding: false, swimming: false, rubberSuit: false };
  /** InviCounter and DrogaCounter (Contadores) in seconds; 0 when off. */
  timers = { invisibility: 0, effect: 0 };
  /** UserSaliendo: /SALIR or the exit button was sent (WriteQuit) and the countdown may be running; Escape then sends CancelarExit. */
  leaving = false;
  /** The open sign (InitCartel: cartel, Leyenda, GrhCartel); only one at a time, a ShowSignal meanwhile is ignored. The UI draws it at `signAnchor` (clicX, clicY). */
  sign: { text: string; grh: number } | undefined;
  /** frmMain's last click in viewport pixels (clicX, clicY), set by the UI. */
  signAnchor = { x: 0, y: 0 };
  /** Last FlashScreen the server sent (EfectoEnPantalla): the UI tints the viewport until it has passed. */
  flash: { color: number; duration: number; ignore: boolean; at: number } | undefined;
  /** Floating texts (TextOverTile / TextCharDrop) waiting to be drawn by the bubbles layer. */
  readonly floatingTexts: { text: string; x?: number; y?: number; charIndex?: number; color: number; duration: number; offsetY: number; animated: boolean; at: number }[] = [];
  phase: Phase = 'connecting';
  map: number | undefined;
  resourceMap: number | undefined;
  charIndex: number | undefined;
  position: Position | undefined;
  motion: Motion | undefined;
  /** Shared per-connection packet counters (never reset on ChangeMap). */
  readonly counters = new PacketCounters();
  next(family: PacketFamily): number { return this.counters.next(family); }
  get walksSent() { return this.counters.current('walk'); }
  confirmedWalks = 0;
  correctedWalks = 0;
  unknownFrames = 0;
  /** Frames whose packet left bytes unread, and frames a codec could not read: logged and survived, never a disconnect (see receive). */
  readonly decodeProblems: { id: number; problem: string }[] = [];
  /** Where a decode problem is reported (the pinned client's RegistrarError writes it to its error log). */
  logDecodeProblem: (message: string) => void = message => { console.warn(message); };
  walkInterval: number | undefined;
  connectedAt: number;
  loggedAt: number | undefined;
  error = '';
  private decoder = new FrameDecoder();
  private pending: { expected?: Position; since: number } | undefined;
  /** When the unanswered position probe was sent, once it has waited SERVER_SILENT_MS; cleared by the reply. Never a disconnect. */
  serverSilentSince: number | undefined;
  private lastWalk = -Infinity;
  private lastQuery = 0;
  private lastTalk = -Infinity;
  private talkInterval = 500;
  private hitInterval = 0;
  private placementDeadline: number;
  private credentials: { email: string; password: string; create?: boolean } | undefined;

  constructor(
    credentials: { email: string; password: string; create?: boolean },
    private readonly write: (bytes: Uint8Array) => void,
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.credentials = { ...credentials };
    this.ui.chat.clock = clock; this.ui.chat.characters = index => { const c = this.tracker.chars.get(index); return c && { name: c.tag, npc: c.npc, status: c.status, privileges: c.privileges }; };
    this.connectedAt = clock();
    this.spells = new SpellState(packet => this.send(packet), clock, (text, font) => this.ui.message(text, font), family => this.next(family));
    this.status = new StatusState((text, font) => this.ui.message(text, font), clock);
    this.world = new WorldFx(clock, {
      // CambioDeArea: characters and non-fixed objects outside the new area go (self stays).
      areaChanged: bounds => this.leaveArea(bounds),
      currentMap: () => this.map,
      // Effect_Render_Slot arrival: the end effect is an FXs.ini FX on a character or tile.
      addFx: fx => this.spells.addFx({ ...fx, startedAt: this.clock() }),
      speedToChar: (charIndex, speeding) => this.setSpeeding(charIndex, speeding),
      charAt: (x, y) => this.tracker.at(x, y)?.charIndex,
      charTile: charIndex => { const c = this.tracker.chars.get(charIndex); return c && { x: c.x, y: c.y }; },
    });
    this.placementDeadline = this.connectedAt + 10_000;
  }
  get self() { return this.charIndex === undefined ? undefined : this.tracker.chars.get(this.charIndex); }
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
    if (packet.id === KS_QUIT) this.leaving = true; // WriteQuit: UserSaliendo = True
    this.write(encodeClientFrame(packet));
  }
  /** Esc while UserSaliendo (ModGameplayUI.HandleKeyUp): WriteCancelarExit clears the flag; the server answers LocaleMsg 578 if a countdown was running. */
  cancelExit(): boolean {
    if (!this.leaving || !this.ready) return false;
    this.leaving = false;
    this.send({ id: SCP.CancelarExit });
    return true;
  }
  private readonly issued = new Map<string, number>();
  private decodeProblem(body: Uint8Array, problem: string, trailing?: Uint8Array): void {
    const id = body.length >= 2 ? body[0]! | (body[1]! << 8) : -1;
    if (this.decodeProblems.length < 50) this.decodeProblems.push({ id, problem });
    const hex = (bytes: Uint8Array) => Array.from(bytes.subarray(0, 64), b => b.toString(16).padStart(2, '0')).join('');
    this.logDecodeProblem(`[protocol] ${problem}${trailing ? ` (extra ${hex(trailing)})` : ''}; frame ${hex(body)}`);
  }
  receive(bytes: Uint8Array): void {
    if (this.phase === 'closed') return;
    for (const body of this.decoder.push(bytes)) {
      // client-classic 619e69d HandleIncomingData: a handler that reads too few bytes, or a packet with no handler, is logged
      // ("Server message ID: N unhandled or too many bytes; K extra bytes found") and the rest of the message is drained; a read past the end
      // raises inside the handler, whose error handler logs it. Neither closes the connection, so one wrong codec never kicks the player.
      let frame: ReturnType<typeof decodeServerFrame>;
      try { frame = decodeServerFrame(body); } catch (error) { this.decodeProblem(body, error instanceof Error ? error.message : String(error)); continue; }
      const { packet, trailing } = frame;
      if ('unknown' in packet) { this.unknownFrames++; continue; }
      if (trailing.length) this.decodeProblem(body, `Server message ID: ${packet.id} too many bytes; ${trailing.length} extra bytes found`, trailing);
      this.ui.receive(packet);
      this.tracker.receive(packet, this.clock());
      this.combat.receive(packet, {
        ui: this.ui, characters: this.tracker.chars, charIndex: this.charIndex, clock: this.clock,
        // CharAtaca blood goes into the one spell FX list; VB6 skips it when the victim is sailing.
        bleed: (charIndex, fx) => { if (!this.tracker.chars.get(charIndex)?.sailing) this.spells.addFx({ fx, charIndex, x: 0, y: 0, loops: 0, startedAt: this.clock() }); },
      });
      this.quests.receive(packet);
      this.spells.receive(packet);
      this.party.selfCharIndex = this.charIndex;
      this.party.receive(packet);
      this.travel.receive(packet);
      this.extras.receive(packet);
      this.guild.receive(packet);
      this.status.receive(packet, blind => { this.world.blind = blind; });
      this.items.receive(packet);
      this.keyring.receive(packet);
      this.bankTrade.receive(packet);
      this.world.receive(packet);
      this.crafting.receive(packet);
      this.skills.receive(packet, {
        charIndex: this.charIndex, message: (text, font) => this.ui.message(text, font), infoChannel: () => this.ui.chatCombate,
        // HandleMeditateToggle: StartFx(..., Fx, -1) loops until the toggle comes back with Fx = 0.
        meditationFx: (charIndex, fx) => {
          this.spells.effects = this.spells.effects.filter(effect => !(effect.charIndex === charIndex && effect.loops < 0));
          // The meditation animation (Recursos.LoadComposedFx maps FX 115-120 to it): an id FXs.ini lacks (the server's 153-172) is drawn as its classic step.
          if (fx !== 0) this.spells.addFx({ fx: meditationArt(fx, id => spellTables.fx.has(`fx${id}`)), charIndex, x: 0, y: 0, loops: -1, startedAt: this.clock(), meditation: true });
        },
      });
      this.options.receive(packet);
      this.gm.receive(packet);
      switch (packet.id) {
        case S.Connected:
          if (this.phase !== 'connecting' || !this.credentials) throw new Error('Unexpected Connected');
          this.phase = 'account';
          // WriteCreateAccount and WriteLoginAccount carry the same two strings; the server answers both with AccountCharacterList.
          if (this.credentials.create) this.send({ id: SCP.CreateAccount, email: this.credentials.email, password: this.credentials.password });
          else this.send({ id: C.LoginAccount, email: this.credentials.email, password: this.credentials.password });
          this.credentials = undefined;
          this.placementDeadline = this.clock() + 10_000;
          break;
        case S.AccountCharacterList: {
          if (this.phase !== 'account') throw new Error('Unexpected character list');
          this.accountCharacters = packet.characters; this.accountRevision++;
          if (this.interactive) break; // the account screen picks (frmConnect state e_state_account_screen)
          const first = packet.characters[0];
          if (!first || first.id <= 0 || !first.name) throw new Error('This account has no character');
          this.phase = 'login';
          this.characterLevel = first.level;
          this.send({ id: C.LoginExistingChar, charId: first.id, name: first.name });
          break;
        }
        case S.ChangeMap:
          this.map = packet.map; this.resourceMap = packet.resourceMap;
          this.position = undefined; this.motion = undefined; this.pending = undefined; this.serverSilentSince = undefined; // the probe it waited on is void
          this.placementDeadline = this.clock() + 10_000;
          this.mapObjects.clear(); // the tracker drops every character on ChangeMap itself
          // Retain self index across warps; require a fresh CharacterCreate for placement.
          break;
        case S.CharacterCreate:
          if (!Number.isFinite(packet.speeding) || packet.speeding < 0 || packet.speeding > 100) throw new Error('Invalid character speed');
          if (packet.heading < 1 || packet.heading > 4) throw new Error('Invalid character heading');
          this.validPosition(packet);
          if (this.charIndex === packet.charIndex) this.place(packet.x, packet.y);
          break;
        case S.UserCharIndexInServer:
          this.charIndex = packet.charIndex;
          if (this.self) this.place(this.self.x, this.self.y);
          break;
        case S.Logged:
          if (this.phase !== 'login') throw new Error('Unexpected Logged');
          this.leaving = false;
          this.phase = 'playing'; this.loggedAt = this.clock(); this.lastQuery = this.clock(); this.loginAttempt = undefined;
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
          if (packet.charIndex === this.charIndex) this.place(packet.x, packet.y);
          break;
        }
        // Off-map coordinates are ignored (the VB6 client would index outside MapData); ObjIndex <= 0 clears the tile.
        case DoorServer.ObjectCreate:
          if (inMap(packet)) { if (packet.objIndex > 0) this.mapObjects.create(packet.x, packet.y, packet); else this.mapObjects.delete(packet.x, packet.y); }
          break;
        case DoorServer.ObjectDelete: if (inMap(packet)) this.mapObjects.delete(packet.x, packet.y); break;
        case DoorServer.BlockPosition: if (inMap(packet)) this.mapObjects.block(packet.x, packet.y, packet.sides); break;
        // The tracker drops the character (self too, as EraseChar does; a warp's CharacterCreate follows); status forgets others.
        case NS.CharacterRemove: if (packet.charIndex !== this.charIndex) this.status.forget(packet.charIndex); break;
        // LocaleMsg (141) reaches the console through ui.receive -> ChatState (one print, chat's pipeline).
        case KS.SafeModeOn: this.safeMode = true; break;
        case KS.SafeModeOff: this.safeMode = false; break;
        case S.ErrorMsg:
          // HandleErrorMessage: MsgBox(text). The server closes the socket right after, which returns the player to the login screen.
          if (!this.interactive) throw new Error(`Server: ${packet.message}`);
          this.notify({ kind: 'error', text: packet.message });
          break;
        case S.Disconnect:
          // HandleDisconnect (PYMMO=0) ends in General_Set_Connect: the login screen, not an error.
          if (!this.interactive) throw new Error('The server disconnected this character');
          this.leaving = false; // HandleDisconnect resets UserSaliendo, and the skills window state with the other globals
          this.skills.reset();
          this.onDisconnect?.();
          break;
        // HandleUserIndexInServer stores `userIndex` (TileEngine.bas global); nothing reads it (Renderizar_Aura's parameter of that name shadows it).
        case SS.UserIndexInServer: this.userIndex = packet.userIndex; break;
        // HandleShowFrmLogear only shows the account-server login form (FrmLogear) over frmConnect: the web client's own login screen is already up. HandleShowForumForm has an empty body.
        case SS.ShowFrmLogear: case GmServer.ShowForumForm: break;
        case SS.ShowMessageBox: this.notify({ kind: 'box', messageId: packet.messageId, extra: packet.extra }); break;
        case SS.CerrarleCliente: this.onCloseClient?.(); break;
        case SS.MostrarCuenta: this.phase = 'account'; this.status.resetOnLeave(); this.world.blind = false; this.world.allies.clear(); /* HandleMostrarCuenta: HideMinimapDot 1..5 */ this.accountRevision++; this.onShowAccount?.(); break;
        case SS.NavigateToggle: this.movement.sailing = packet.sailing; break;
        case SS.EquiteToggle: this.movement.riding = !this.movement.riding; break; // HandleEquiteToggle flips it
        case SS.NadarToggle: this.movement.swimming = packet.swimming; this.movement.rubberSuit = packet.rubberSuit; break;
        case SS.VelocidadToggle: if (this.charIndex !== undefined) this.setSpeeding(this.charIndex, packet.speeding); break;
        case SS.Contadores: this.timers = { invisibility: packet.invisibility, effect: packet.effect }; break;
        case SS.FlashScreen: this.flash = { color: packet.color, duration: packet.duration, ignore: packet.ignore, at: this.clock() }; break;
        case SS.TextOverTile: this.addFloatingText({ text: packet.text, x: packet.x, y: packet.y, color: packet.color, duration: packet.duration, offsetY: packet.offsetY, animated: packet.animated }); break;
        case SS.TextCharDrop: this.addFloatingText({ text: packet.text, charIndex: packet.charIndex, color: packet.color, duration: packet.duration, offsetY: 0, animated: packet.animated }); break;
        case SS.ForceCharMove: this.forceMove(packet.heading); break;
        case SS.CharacterTranslate: this.translate(packet); break;
        // HandleShowSignal: ObjData(objIndex).Texto in the sign window (InitCartel); the UI shows it.
        case SS.ShowSignal: if (!this.sign) this.sign = { text: this.catalog?.get(packet.objIndex)?.text ?? '', grh: packet.grh }; break;
        case SS.AnswerReset: this.resetRequested = true; break;
      }
      this.onPacket?.(packet);
    }
  }
  /** ModAreas.CambioDeArea: erase every character (not self) and server-sent object outside the new area; fixed map objects stay (renderer). */
  private leaveArea(bounds: { minX: number; maxX: number; minY: number; maxY: number }) {
    const outside = (x: number, y: number) => x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY;
    for (const [index, char] of [...this.tracker.chars]) if (index !== this.charIndex && outside(char.x, char.y)) this.tracker.chars.delete(index);
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
    if (this.serverSilentSince !== undefined) { this.serverSilentSince = undefined; this.ui.message('El servidor volvió a responder.'); }
    this.position = { x, y };
    if (this.self) this.tracker.place(this.self.charIndex, x, y);
  }
  /** CONST_INTERVALO_HEADING gate of IntervaloPermiteHeading. */
  private lastHeading = -Infinity;
  /** Terrain of the current map (main wires the renderer's parsed map): static Blocked byte and trigger of a tile, undefined while it loads. */
  terrain: ((x: number, y: number) => LegalTile | undefined) | undefined;
  private legalContext(x: number, y: number): LegalContext {
    const base = this.terrain?.(x, y), key = tileKey(x, y);
    const occupant = this.tracker.at(x, y);
    const own = this.self?.privileges ?? 0;
    return {
      tile: base && { blocked: effectiveBlocked(base.blocked, this.mapObjects.blocked.get(key)), trigger: base.trigger },
      occupant: occupant && {
        dead: isDeadBody(occupant.body), invisible: this.status.invisible.has(occupant.charIndex),
        privilege: privilegeIndex(occupant.privileges), dontBlockTile: occupant.dontBlockTile,
      },
      ownPrivilege: privilegeIndex(own), sailing: this.movement.sailing, swimming: this.movement.swimming, riding: this.movement.riding, dead: this.dead,
    };
  }
  walk(heading: Heading): boolean {
    const now = this.clock();
    this.sign = undefined; // General.MoveTo: If cartel Then cartel = False, whether or not the step is legal
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
    const to = {
      x: this.position.x + (heading === Heading.East ? 1 : heading === Heading.West ? -1 : 0),
      y: this.position.y + (heading === Heading.South ? 1 : heading === Heading.North ? -1 : 0),
    };
    // General.MoveTo: an illegal step (LegalPos: the MinXBorder..MaxYBorder box first, then occupants and terrain) is never predicted; the character
    // only turns, and WriteChangeHeading goes out when the heading differs. The old 1..100 test sent a Walk the server bounced with a PosUpdate.
    if (!(inWalkBorders(to.x, to.y) && legalPos(heading, this.legalContext(to.x, to.y)) && this.status.canMove(now))) {
      if (this.self.heading !== heading && now - this.lastHeading >= HEADING_INTERVAL_MS) {
        this.lastHeading = now;
        this.tracker.place(this.self.charIndex, this.position.x, this.position.y, heading);
        this.send({ id: SCP.ChangeHeading, heading, counter: this.next('changeHeading') });
      }
      return false;
    }
    this.motion = { from: this.position, to, started: now, duration: this.stepMs - 30 };
    this.position = to;
    this.tracker.place(this.self.charIndex, to.x, to.y, heading);
    this.pending = { expected: to, since: now };
    this.lastWalk = now;
    this.lastQuery = now;
    // MoveTo: a legal step ends the work macro first (ResetearUserMacro: FlagTrabajar + "Has dejado de trabajar...").
    if (this.crafting.macro.active) this.crafting.reset();
    this.crafting.onWalk();
    this.send({ id: C.Walk, heading, counter: this.next('walk') });
    // TCP order ensures the position probe follows this walk. Silence never counts as success.
    this.send({ id: C.RequestPositionUpdate });
    return true;
  }
  tick(): void {
    const now = this.clock();
    if (this.phase === 'closed') return;
    // The account and character screens wait for the player; the placement clock starts when a character is entered.
    // Only the login itself has a deadline. In game (a warp's new placement, a late position reply) the client waits like VB6, whose
    // pinned client (619e69d) has no application-level watchdog: only a socket error ends the session. The VB6 server stalls for
    // seconds when its loop is starved of CPU (14 s measured 21 Nov) and TCP delivers every reply once it resumes.
    if (!this.ready && this.phase === 'login' && now > this.placementDeadline) throw new Error('Timed out waiting for login, placement and intervals');
    if (!this.ready && this.phase === 'connecting' && now > this.placementDeadline) throw new Error('Timed out waiting for the server');
    if (this.pending && now - this.pending.since > SERVER_SILENT_MS && this.serverSilentSince === undefined) {
      this.serverSilentSince = this.pending.since;
      this.ui.message('El servidor no responde. Esperando...');
    }
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
  /** The server's user slot (UserIndexInServer); kept as in VB6, unused. */
  userIndex: number | undefined;
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
  /** HandleAnswerReset asks the player whether to reset the character; the UI answers with ResetearPersonaje. */
  resetRequested = false;
  private notify(notice: SessionNotice) { this.notices.push(notice); this.noticeRevision++; if (this.loginAttempt) this.loginAttempt.answered = true; }
  /** 'create' or 'enter' when a character request is still unanswered: no Logged and no message from the server about it. */
  get silentLoginFailure(): 'create' | 'enter' | undefined {
    return this.phase === 'login' && !this.self && this.loginAttempt && !this.loginAttempt.answered ? this.loginAttempt.kind : undefined;
  }
  private addFloatingText(text: Omit<Session['floatingTexts'][number], 'at'>) {
    // Same cap as a console: an overhead text per call, never an unbounded list.
    this.floatingTexts.push({ ...text, at: this.clock() });
    if (this.floatingTexts.length > 50) this.floatingTexts.shift();
  }
  /** HandleCharacterTranslate for the player's own character: it glides to the tile over `time` ms (the tracker does the same for everybody else). */
  private translate(packet: { charIndex: number; x: number; y: number; time: number }) {
    if (packet.charIndex !== this.charIndex || !this.position || packet.x < 1 || packet.y < 1 || packet.x > 100 || packet.y > 100) return;
    const from = this.position, to = { x: packet.x, y: packet.y };
    this.motion = packet.time > 0 && (from.x !== to.x || from.y !== to.y) ? { from, to, started: this.clock(), duration: packet.time, translate: true } : undefined;
    this.position = to;
    this.tracker.place(packet.charIndex, to.x, to.y);
  }
  /** HandleForceCharMove: the server pushes the player one tile (Char_Move_by_Head + MoveScreen). */
  private forceMove(heading: number) {
    if (!this.position || !this.self || heading < 1 || heading > 4) return;
    const to = {
      x: this.position.x + (heading === Heading.East ? 1 : heading === Heading.West ? -1 : 0),
      y: this.position.y + (heading === Heading.South ? 1 : heading === Heading.North ? -1 : 0),
    };
    if (to.x < 1 || to.y < 1 || to.x > 100 || to.y > 100) return;
    this.motion = { from: this.position, to, started: this.clock(), duration: Math.max(50, this.stepMs - 30) };
    this.position = to;
    this.tracker.place(this.self.charIndex, to.x, to.y, heading as Heading);
    this.lastWalk = this.clock();
  }
  /** frmConnect render_MouseUp / frmConnect Jugar: LoginExistingChar for a character of the account list (LoginCharacter). */
  enterCharacter(character: AccountCharacter): boolean {
    if (this.phase !== 'account' || character.id <= 0 || !character.name || !this.accountCharacters.some(c => c.id === character.id)) return false;
    this.phase = 'login'; this.characterLevel = character.level; this.placementDeadline = this.clock() + 10_000;
    this.loginAttempt = { kind: 'enter', answered: false };
    this.send({ id: C.LoginExistingChar, charId: character.id, name: character.name });
    return true;
  }
  /**
   * frmConnect Crear: WriteLoginNewChar. The server (PYMMO=0) validates and enters the new character directly; a refusal comes back as
   * ShowMessageBox (the session stays on the account screen) or as a closed socket.
   */
  createCharacter(character: NewCharacter): boolean {
    if (this.phase !== 'account') return false;
    this.phase = 'login'; this.placementDeadline = this.clock() + 10_000;
    this.loginAttempt = { kind: 'create', answered: false };
    this.send({ id: SCP.LoginNewChar, name: character.name, race: character.race, gender: character.gender, characterClass: character.characterClass, head: character.head, home: character.home });
    return true;
  }
  /** A ShowMessageBox during character creation or entry leaves the session on the account screen again (the server did not log anybody in). */
  backToAccount() { if (this.phase === 'login' && !this.self) { this.phase = 'account'; this.loginAttempt = undefined; } }
  finish(message = 'Disconnected'): void {
    this.phase = 'closed'; this.error = message; this.credentials = undefined;
    this.pending = undefined; this.motion = undefined; this.serverSilentSince = undefined;
    this.decoder.finish();
  }
  visualPosition(now: number): Position | undefined {
    if (!this.motion) return this.position;
    const t = Math.min(1, Math.max(0, (now - this.motion.started) / this.motion.duration));
    return { x: this.motion.from.x + (this.motion.to.x - this.motion.from.x) * t, y: this.motion.from.y + (this.motion.to.y - this.motion.from.y) * t };
  }
}
