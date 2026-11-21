/*
 * Decides WHEN the classic client makes a sound: server waves (HandlePlayWave, HandlePlayWaveStep), footsteps (DoPasosFx), combat
 * sounds the client plays itself (HandleCharSwing, HandleCharAtaca), map music and ambient (SwitchMap, PlayCurrentMapMusic),
 * weather (HandleRainToggle, HandleNieveToggle, UpdatePlayerRoof) and the UI click (clsGraphicalButton).
 * Adapted 2026-11-20 from client Protocol.bas, TileEngine.bas, TileEngine_Map.bas and ao20audio.bas.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty. See ../../../LICENSE.
 */
import { AudioServerPacketId as A, CombatServerPacketId as C, CraftingServerPacketId as CF, ServerPacketId as S, SkillsServerPacketId as SK, SpellServerPacketId as SP } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import {
  SND, Terrain, ambientWave, inHearingArea, mapMusicId, musicFile, panAt, panByDistance, stepWave, terrainOf, volumeByDistance, waveFile,
} from './audio-rules.js';
import type { MusicZone } from './audio-rules.js';
import type { AudioEngine } from './audio-engine.js';

/** Everything the director needs to know about the world; the Session and WorldRenderer implement it. */
export interface AudioWorld {
  readonly resourceMap: number | undefined;
  readonly position: { x: number; y: number } | undefined;
  readonly charIndex: number | undefined;
  readonly dead: boolean;
  readonly motion: { started: number; to: { x: number; y: number } } | undefined;
  /** A character of the map, or undefined. */
  char(index: number): { x: number; y: number; body: number; privileges: number; sailing: boolean; speeding: number; npc?: number } | undefined;
  /** ModMetereologia.EsNoche (TimeIndex 0..2): the map ambient takes its first field instead of the second. */
  readonly night: boolean;
  /** The renderer's map is the one the session is on. */
  readonly mapReady: boolean;
  mapAudio(): { music: number; ambient: string; rain: boolean; snow: boolean; fog: boolean } | undefined;
  terrainAt(x: number, y: number): { file: number; overlay: number } | undefined;
  roofAt(x: number, y: number): boolean;
}

/** PlayWave (55) is decoded by the spells codec (one codec per id); the fields are HandlePlayWave's. */
export type PlayWavePacket = Extract<ServerPacket, { id: typeof SP.PlayWave }>;

const privilegeOf = (privileges: number) => privileges > 0 ? Math.round(Math.log2(privileges)) : 0;
/** CASPER_BODY_IDLE and CASPER_BODY_NAVIGATING (Declares.bas): the ghost bodies of a dead character. */
export const isDeadBody = (body: number) => body === 829 || body === 87;

export class AudioDirector {
  zones: MusicZone[] = [];
  language = 'es';
  private raining = false;
  private snowing = false;
  private roof = false;
  private lastMap: number | undefined;
  private lastMusic: number | undefined;
  private lastMotion: number | undefined;
  private readonly feet = new Map<number, boolean>();

  constructor(private readonly engine: AudioEngine, private readonly world: AudioWorld) {}

  /** Back to the login screen: the next map starts from scratch (VB6 stops music and ambient when the session ends). */
  reset() {
    this.raining = false; this.snowing = false; this.roof = false;
    this.lastMap = undefined; this.lastMusic = undefined; this.lastMotion = undefined; this.feet.clear();
    void this.engine.playMusic(undefined); this.engine.stopAmbient();
  }
  private get invert() { return this.engine.settings.invertChannels; }
  private get self() { return this.world.position; }

  /** Server packets that make sound; call after the session and trackers have applied the packet. */
  receive(packet: ServerPacket): void {
    switch (packet.id) {
      case SP.PlayWave: this.playWave(packet); break;
      case A.PlayWaveStep: this.invisibleStep(packet); break;
      // HandlePelearConPezEspecial: ao20audio.PlayWav(55), not localised, not positional.
      case CF.PelearConPezEspecial: this.playWave({ id: SP.PlayWave, wave: 55, x: 0, y: 0, cancelLast: 0, localize: 0 } as PlayWavePacket); break;
      case A.RainToggle: this.weather('rain', packet.raining); break;
      case A.NieveToggle: this.weather('snow', packet.snowing); break;
      case A.PlayMIDI: break; // HandlePlayMIDI reads File and Loop and does nothing.
      case SK.MeditateToggle: this.meditation(packet.charIndex, packet.fx); break;
      case S.CharacterMove: {
        if (packet.charIndex !== this.world.charIndex) this.step(packet.charIndex, packet.x, packet.y);
        break;
      }
      case C.CharSwing: {
        // HandleCharSwing: the swing wave for any character in the player's area.
        const char = this.world.char(packet.charIndex);
        if (char) this.at(2, char.x, char.y);
        break;
      }
      case C.CharAtaca: {
        // HandleCharAtaca: 2 for a miss (damage -1), 10 for a hit, at the attacker, unless the player is dead.
        const char = this.world.char(packet.charIndex);
        if (char && !this.world.dead) this.at(packet.damage === -1 ? 2 : 10, char.x, char.y);
        break;
      }
    }
  }

  /** Per frame: own footsteps, map music and ambient, the roof flip of rain. */
  tick(): void {
    const world = this.world, here = this.self;
    if (!world.mapReady || !here || world.resourceMap === undefined) return;
    const map = world.resourceMap;
    const audio = world.mapAudio();
    if (!audio) return;
    if (map !== this.lastMap) { this.lastMap = map; this.lastMusic = undefined; this.roof = world.roofAt(here.x, here.y); this.switchMap(audio); }
    const music = mapMusicId(this.zones, map, here.x, here.y, audio.music);
    if (music !== this.lastMusic) { this.lastMusic = music; void this.engine.playMusic(music > 0 ? musicFile(music) : undefined); }
    const roof = world.roofAt(here.x, here.y);
    if (roof !== this.roof) {
      this.roof = roof;
      if (this.raining && audio.rain) void this.engine.playAmbient(roof ? SND.rainInLoop : SND.rainOutLoop);
      else if (this.snowing && audio.snow) void this.engine.playAmbient(roof ? SND.snowIn : SND.snowOut);
    }
    // The own step: Char_Move_by_Pos runs when a walk starts; one step per new motion.
    const motion = world.motion;
    if (motion && motion.started !== this.lastMotion && world.charIndex !== undefined) {
      this.lastMotion = motion.started;
      this.step(world.charIndex, motion.to.x, motion.to.y);
    }
  }

  /** TileEngine_Map.SwitchMap: weather ambient wins over the map's own ambient. */
  private switchMap(audio: NonNullable<ReturnType<AudioWorld['mapAudio']>>) {
    if (this.raining && audio.rain) { void this.engine.playAmbient(this.roof ? SND.rainInLoop : SND.rainOutLoop); return; }
    if (this.snowing && audio.snow) { void this.engine.playAmbient(this.roof ? SND.snowIn : SND.snowOut); return; }
    this.ambient(audio.ambient);
  }
  private ambient(ambient: string) {
    // PlayAmbientAudio: EsNoche picks field 1, otherwise field 2. It runs at SwitchMap and when the rain ends only, so a day/night flip while
    // standing on the map does not restart the ambient (the VB6 client does not either).
    const wave = ambientWave(ambient, this.world.night);
    if (wave) void this.engine.playAmbient(wave); else this.engine.stopAmbient();
  }
  /** HandleRainToggle / HandleNieveToggle. */
  private weather(kind: 'rain' | 'snow', on: boolean) {
    if (kind === 'rain') this.raining = on; else this.snowing = on;
    const audio = this.world.mapAudio();
    if (!this.self || !audio) return;
    if (kind === 'rain' ? !audio.rain : !audio.snow) return;
    if (on) { void this.engine.playAmbient(kind === 'rain' ? (this.roof ? SND.rainInLoop : SND.rainOutLoop) : (this.roof ? SND.snowIn : SND.snowOut)); return; }
    this.ambient(audio.ambient);
    void this.engine.playWave(this.roof ? SND.rainInEnd : SND.rainOutEnd, { category: 'ambient' });
  }

  /** ao20audio.ComputeCharFxVolume + ComputeCharFxPan: a sound at a tile, only when it is in the player's area. */
  at(wave: number | string, x: number, y: number, options: { loop?: boolean; label?: string } = {}) {
    const here = this.self;
    if (!here || !inHearingArea(x, y, here.x, here.y)) return;
    const d = Math.abs(x - here.x) + Math.abs(y - here.y);
    void this.engine.playWave(wave, {
      ...options, volume: volumeByDistance(this.engine.settings.volFx, d), pan: panAt(x, y, here.x, here.y, this.invert),
    });
  }

  /** Protocol.HandlePlayWave. */
  playWave(packet: PlayWavePacket) {
    const file = waveFile(packet.wave, packet.localize, this.language, Boolean(this.world.mapAudio()?.fog));
    if (file === undefined) return;
    if (packet.cancelLast !== 0) {
      this.engine.stopWave(packet.wave);
      if (packet.cancelLast === 2) return;
    }
    if (packet.x === 0 || packet.y === 0) { void this.engine.playWave(file); return; }
    this.at(file, packet.x, packet.y);
  }

  /** ao20audio.PlayWav(id, False, 0, 0): a wave with no position (RevisarHoraMundo's wolf and rooster, a tile spell's arrival). */
  global(wave: number) { void this.engine.playWave(wave); }

  /** Protocol.HandleMeditateToggle: the meditation loop under the label "meditate<char>" while the character is in the player's area; fx 0 stops it. */
  private meditation(charIndex: number, fx: number) {
    const label = `meditate${charIndex}`;
    if (fx === 0) { this.engine.stopWave(SND.meditate, label); return; }
    const char = this.world.char(charIndex), here = this.self;
    if (!char || !here || !inHearingArea(char.x, char.y, here.x, here.y)) return;
    const d = Math.abs(char.x - here.x) + Math.abs(char.y - here.y);
    void this.engine.playWave(SND.meditate, { loop: true, label, volume: volumeByDistance(this.engine.settings.volFx, d), pan: panAt(char.x, char.y, here.x, here.y, this.invert) });
  }

  /** TileEngine.DoPasosFx for a character that just moved to (x, y). */
  step(charIndex: number, x: number, y: number) {
    const world = this.world, here = this.self;
    if (!here) return;
    const char = world.char(charIndex);
    const me = world.charIndex === undefined ? undefined : world.char(world.charIndex);
    // DoPasosFx: "Mascots don't make noise" (HandleCharacterCreate: EsMascota = FlagNpc = 2).
    if (!char || char.npc === 2 || isDeadBody(char.body) || world.dead) return;
    if (privilegeOf(char.privileges) > privilegeOf(me?.privileges ?? 0)) return;
    if (!inHearingArea(x, y, here.x, here.y)) return;
    const foot = !(this.feet.get(charIndex) ?? false);
    this.feet.set(charIndex, foot);
    const d = Math.abs(x - here.x) + Math.abs(y - here.y);
    const volume = volumeByDistance(this.engine.settings.volSteps, d);
    const pan = panAt(x, y, here.x, here.y, this.invert);
    if (char.sailing) {
      void this.engine.playWave(SND.sailing, { volume, pan, label: `sailing_${charIndex}`, category: 'steps', unique: true });
      return;
    }
    const ground = world.terrainAt(x, y);
    let terrain = ground ? terrainOf(ground.file, ground.overlay) : Terrain.Floor;
    if (char.speeding > 1.2 && terrain === Terrain.Floor) terrain = Terrain.Horse;
    void this.engine.playWave(stepWave(terrain, foot), { volume, pan, label: `pasos${charIndex}_${foot ? 1 : 2}`, category: 'steps' });
  }

  /** HandlePlayWaveStep / DoPasosInvi: the server gives the terrain graphic, distance and side of an invisible walker. */
  private invisibleStep(packet: Extract<ServerPacket, { id: typeof A.PlayWaveStep }>) {
    if (packet.grh <= 0) return;
    // Layer-1 graphic numbers are not file numbers; the terrain falls back to floor without the graphic index.
    const terrain = this.terrainOfGrh?.(packet.grh, packet.grh2) ?? Terrain.Floor;
    const sign = Math.sign(packet.balance);
    void this.engine.playWave(stepWave(terrain, packet.step), {
      volume: volumeByDistance(this.engine.settings.volSteps, packet.distance),
      pan: panByDistance(packet.distance, sign, this.invert), category: 'steps',
    });
  }
  /** Resolves a Grh number to its terrain (renderer's graphic index); optional. */
  terrainOfGrh: ((grh: number, overlay: number) => Terrain) | undefined;

  /** clsGraphicalButton: SND_CLICK on press, SND_CLICK_OVER when the pointer enters. */
  click() { void this.engine.playWave(SND.click); }
  hover() { void this.engine.playWave(SND.clickOver); }
}
