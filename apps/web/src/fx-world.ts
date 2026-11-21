/*
 * World FX state: time of day, light, weather, particles, projectiles. Adapted 2026-11-20 from the classic client's Protocol.bas
 * handlers (HandleHora, HandleLightToFloor, HandleRainToggle, HandleNieveToggle, HandleNieblaToggle, HandleParticleFX*,
 * HandleCreateProjectile, HandleAreaChanged, HandleAuraToChar, HandlePauseToggle), TileEngine_Map.SwitchMap, ModAreas.CambioDeArea,
 * frmMain.TimerNiebla, TileEngine_Map.Engine_Weather_UpdateFog, engine.Effect_Begin/Effect_Render_Slot and
 * TileEngine_RenderScreen.InitializeProjectile/UpdateProjectile. Copyright (C) 2022-2026 Noland Studios.
 * AGPL-3.0-or-later; no warranty. See ../../../LICENSE and ../../../NOTICE.
 *
 * Pure logic with an injected clock and random source, so the behaviour is testable without a browser. Drawing is fx-render.ts.
 */
import { ServerPacketId as S, SessionServerPacketId as SES, SpellServerPacketId as SS, WorldServerPacketId as W, NpcsServerPacketId as NS, AudioServerPacketId as AU } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import type { MapInfo, MapLight, MapParticle, Ini } from './assets.js';
import { ENGINE_BASE_SPEED, ParticleGroup } from './fx-particles.js';
import type { Random, Stream } from './fx-particles.js';
import { DAY_LIGHT, DEATH_COLOR, BLIND_COLOR, DUNGEON_COLOR, LightGrid, NIGHT_LIGHT, WHITE, WorldClock } from './fx-lights.js';
import type { LightMode, Rgb } from './fx-lights.js';

/** Declares.bas Particula_Lluvia / Particula_Nieve: the stream ids of the weather. */
export const RAIN_STREAM = 58;
export const SNOW_STREAM = 57;
/** The weather particles are drawn at a hard-coded screen point (RenderScreen: "Screen positions were hardcoded by now"). */
export const METEO_SCREEN = { x: 250, y: 0 };
/** frmMain.TimerNiebla.Interval. */
const FOG_STEP_MS = 100;
/** TileEngine_Map: WeatherFogCount and the 512 px wrap of the two cloud layers. */
export const FOG_LAYER_1_GRH = 32015;
export const FOG_LAYER_2_GRH = 32014;

/** Data tables read once from the local resource mount (init/particles.ind, init/ProjectileDef.dat), shared by every session like spellTables. */
export const fxTables: { streams: Stream[]; projectiles: ProjectileDef[] } = { streams: [], projectiles: [] };

export interface Projectile { grh: number; x: number; y: number; targetX: number; targetY: number; speed: number; rotationSpeed: number; rotation: number }
export interface ProjectileDef { grh: number; rightGrh: number; speed: number; offsetRotation: number; rotationSpeed: number }

/** engine.Effect_Type: a spell particle travelling from the caster to a character or a tile. */
export interface Traveler {
  /** Emitting character; the start pixel is resolved on the first frame (its tile when the packet arrived if it is gone by then). */
  sender: number;
  x: number; y: number;
  /** Effect_Begin reads the emitter's position once, when the packet arrives: the fallback start when it is erased before the first frame. */
  start?: { x: number; y: number };
  /** Destination: a character, or (charIndex 0) a tile. */
  destChar: number; destX: number; destY: number;
  /** The destination character's last known tile (charlist().Pos): EraseChar turns the effect into a tile effect there. */
  lastTile?: { x: number; y: number };
  viaje: { x: number; y: number };
  speed: number;
  /** Explosion: a particle stream (End_Effect) or an FXs.ini fx (FxEnd_Effect), lasting `loops` (particle steps or fx loops). */
  endStream: number; endFx: number; endLoops: number;
  wave: number;
}

/** Everything the per-frame update needs from the world renderer and the character tracker. */
export interface FrameInfo {
  /** Milliseconds since the previous frame (VB6 timerElapsedTime). */
  dt: number;
  /** Buffered visible tile range (the VB6 MinBufferedX..MaxBufferedY of RenderScreen). */
  view: { minX: number; maxX: number; minY: number; maxY: number };
  /** World pixel of a character's tile top-left (sliding position), undefined when it is not on this map. */
  charPixel: (charIndex: number) => { x: number; y: number } | undefined;
  selfDead: boolean;
}
/** The side effects the world cannot do itself. */
export interface WorldHooks {
  /** CambioDeArea: erase every character (except self) and non-fixed object outside the new area. */
  areaChanged?: (bounds: AreaBounds) => void;
  /** Effect_Render_Slot arrival: an FXs.ini effect on a character or tile (SetCharacterFx / SetMapFx). */
  addFx?: (fx: { fx: number; charIndex: number | undefined; x: number; y: number; loops: number }) => void;
  /** A projectile or particle travelled to a character and has a sound (ParticleFXWithDestino wav); the audio feature subscribes. */
  playWave?: (wave: number, x: number, y: number) => void;
  /** The player's map number (UserMap): HandleUbicacion only draws an ally that is on it. */
  currentMap?: () => number | undefined;
  /** ModMetereologia.RevisarHoraMundo: the wolf (124) at the first night index and the rooster (137) at the first morning index, played with no position. */
  playGlobalWave?: (wave: number) => void;
  /** HandleSpeedToChar. */
  speedToChar?: (charIndex: number, speeding: number) => void;
  /** MapData(x, y).charindex: ParticleFXToFloor on a tile that already has a particle group attaches the effect to the character standing there. */
  charAt?: (x: number, y: number) => number | undefined;
  /** charlist(charIndex).Pos: a character's tile (not its sliding position), undefined when it is not on the map. */
  charTile?: (charIndex: number) => { x: number; y: number } | undefined;
}
export interface AreaBounds { minX: number; maxX: number; minY: number; maxY: number }

/** ModAreas.CambioDeArea with the classic (PYMMO = 0) constants: AREA_DIM 12, radius 1x1 areas, 36 x 36 tiles. */
export function areaBounds(x: number, y: number): AreaBounds {
  const dim = 12, radiusX = 1, radiusY = 1, width = dim * (radiusX * 2 + 1), height = dim * (radiusY * 2 + 1);
  let minX = (Math.trunc(x / dim) - radiusX) * dim, minY = (Math.trunc(y / dim) - radiusY) * dim;
  let maxX = minX + width - 1, maxY = minY + height - 1;
  if (minX < 1) minX = 1; if (minY < 1) minY = 1;
  if (maxX > 100) maxX = 100; if (maxY > 100) maxY = 100;
  return { minX, maxX, minY, maxY };
}

/** Recursos.LoadProjectiles: [PROJECTILEn] GRH, GRHRigth, SPEED (per second, /1000 here), OFFSETROTATION, ROTATIONSPEED. */
export function parseProjectiles(ini: Ini): ProjectileDef[] {
  const count = Number(ini.get('init')?.get('numprojectile') ?? 0);
  const defs: ProjectileDef[] = [];
  for (let i = 1; i <= count; i++) {
    const s = ini.get(`projectile${i}`);
    defs.push({
      grh: Number(s?.get('grh') ?? 0), rightGrh: Number(s?.get('grhrigth') ?? 0), speed: Number(s?.get('speed') ?? 0) / 1000,
      offsetRotation: Number(s?.get('offsetrotation') ?? 0), rotationSpeed: Number(s?.get('rotationspeed') ?? 0),
    });
  }
  return defs;
}

/** Math.GetAngle: radians, 0 = east, counter-clockwise on the (x1, y1) -> (x2, y2) plane; the projectile call swaps both y arguments. */
export function getAngle(x1: number, y1: number, x2: number, y2: number): number {
  const yDiff = Math.abs(y2 - y1);
  if (x1 === x2 && y1 === y2) return 0;
  if (yDiff === 0 && x1 < x2) return 0;
  if (yDiff === 0 && x1 > x2) return Math.PI;
  const xDiff = Math.abs(x2 - x1);
  let angle = Math.atan(xDiff / yDiff);
  if (y2 > y1) angle = Math.PI - angle;
  if (x2 < x1) angle = -angle;
  angle = Math.PI / 2 - angle;
  if (angle < 0) angle += 2 * Math.PI;
  return angle;
}
/** Math.FixAngle: `angle Mod 360` on a Single rounds to a whole degree first. */
export function fixAngle(angle: number): number {
  const whole = Math.round(angle) % 360;
  return whole < 0 ? 360 + whole : whole;
}
/** TileEngine_RenderScreen.InitializeProjectile. */
export function makeProjectile(def: ProjectileDef, startX: number, startY: number, endX: number, endY: number): Projectile {
  const right = endX > startX && def.rightGrh > 0;
  return {
    grh: right ? def.rightGrh : def.grh, x: startX * 32, y: startY * 32, targetX: endX * 32, targetY: endY * 32,
    speed: def.speed, rotationSpeed: right ? -def.rotationSpeed : def.rotationSpeed,
    rotation: fixAngle((getAngle(startX, endY, endX, startY) * 180) / Math.PI + def.offsetRotation),
  };
}
/** UpdateProjectile; returns true when the projectile arrived (it is still drawn once at its last position, then released). */
export function stepProjectile(p: Projectile, dt: number): boolean {
  const dx = p.targetX - p.x, dy = p.targetY - p.y, length = Math.hypot(dx, dy);
  if (length < p.speed * dt) return true;
  p.x += (dx / length) * p.speed * dt; p.y += (dy / length) * p.speed * dt;
  p.rotation = fixAngle(p.rotation + p.rotationSpeed * dt);
  return false;
}

const MAX_PROJECTILES = 64;
/** ModMetereologia.NightIndex / MorningIndex (the last assignments in IniciarMeteorologia) and ModUtils FXSound Lobo_Sound / Gallo_Sound. */
export const NIGHT_INDEX = 0, MORNING_INDEX = 3, WOLF_WAVE = 124, ROOSTER_WAVE = 137;

export class WorldFx {
  readonly clock = new WorldClock();
  readonly lights = new LightGrid();
  /** HandlePauseToggle: `pausa` blocks walking, clicks and casting. */
  paused = false;
  /** bRain / bNieve: what the server last said; kept across maps and applied again by every map that has the flag (SwitchMap). */
  raining = false;
  snowing = false;
  /** bNiebla, MaxAlphaNiebla and AlphaNiebla (0..255 vertex alpha of the cloud layers). */
  fogOn = false;
  fogMax = 0;
  fogAlpha = 0;
  /** Cloud scroll offsets (WeatherFogX1/Y1/X2/Y2), each kept in -512..0. */
  fog = { x1: 0, y1: 0, x2: 0, y2: 0 };
  info: MapInfo = { zone: '', baseLight: 0, rain: false, snow: false, fog: false };
  blind = false;
  lightMode: LightMode = 'hour';
  disableDungeonLighting = false;
  /** Bumped by every ChangeMap: the renderer re-applies the parsed map (lights, particles, weather flags) when it differs from `appliedGeneration`. */
  generation = 0;
  appliedGeneration = -1;
  /** Map and floor particle groups by tile index (MapData.particle_group), character groups by character index. */
  readonly tileGroups = new Map<number, ParticleGroup>();
  readonly charGroups = new Map<number, ParticleGroup[]>();
  meteo: ParticleGroup | undefined;
  /** engine.spell_particle: ONE group shared by every travelling spell particle (Engine_spell_Particle_Set). */
  spellGroup: ParticleGroup | undefined;
  /** frmMain.MinimapDots(1..5) / personaje(1..5): the party allies' tiles from HandleUbicacion; absent = hidden (HideMinimapDot). */
  readonly allies = new Map<number, { x: number; y: number }>();
  /** HandleShowFrmMapa: ExpMult / OroMult and a counter the UI watches to open frmMapaGrande. */
  mapForm = { opened: 0, expMult: 1, goldMult: 1 };
  readonly travelers: Traveler[] = [];
  readonly projectiles: Projectile[] = [];
  /** HandleAuraToChar: type 1..6 and 7 (RM) -> aura string "grh:color:giro:lado" per character. */
  readonly auras = new Map<number, Map<number, string>>();
  /** The ambient colour used by the last light computation, and the in-game clock label. */
  ambient: Rgb = { r: 255, g: 255, b: 255 };
  private fogAccumulator = 0;
  private lastDead = false;
  private lastBlind = false;
  private lastDungeon = false;
  private lastAmbientAt = -Infinity;
  /** ModMetereologia.TimeIndex: hour \ 2 of the last RevisarHoraMundo, -1 until the first one (EsNoche reads it). */
  timeIndex = -1;
  /** The VB6 `global_light`; `ambient` is what the lightmap last took from it (RenderScreen: `If UpdateLights Then RestaurarLuz`). */
  private globalLight: Rgb = WHITE;
  /** `UpdateLights`: set by RevisarHoraMundo (500 ms) and by every map load, consumed by the next render. */
  private updateLights = true;
  /** frmMain.Efecto timer (FlashScreen): the instant EfectoEnPantalla's colour is meant to end, or undefined. */
  private efectoEndsAt: number | undefined;
  private lastSelfDead = false;

  constructor(private readonly clockNow: () => number, private readonly hooks: WorldHooks = {}, private readonly rnd: Random = Math.random) {}
  setHooks(hooks: WorldHooks) { Object.assign(this.hooks, hooks); }
  /** The session clock (performance.now in the browser). */
  now() { return this.clockNow(); }

  /** Particles that still need a map to anchor to (and lights): the renderer calls this once the CSM is parsed. */
  setMap(info: MapInfo, lights: readonly MapLight[], particles: readonly MapParticle[]) {
    this.info = info; this.appliedGeneration = this.generation;
    for (const light of lights) this.lights.addMapLight({ x: light.x, y: light.y, color: { r: light.r, g: light.g, b: light.b }, range: light.range });
    for (const particle of particles) this.createTileGroup(particle.stream, particle.x, particle.y, 0, false);
    // SwitchMap: rain, then snow, replace the weather particle when the new map has the flag and the toggle is on.
    if (this.raining && info.rain) this.setMeteo(RAIN_STREAM, true);
    if (this.snowing && info.snow) this.setMeteo(SNOW_STREAM, true);
    this.lights.dirty = true;
  }

  /** The state that ChangeMap discards: Recursos.CargarMapa clears every light and particle group of the old map. */
  private resetMap() {
    this.lights.clear(); this.tileGroups.clear(); this.charGroups.clear(); this.meteo = undefined; this.spellGroup = undefined;
    this.travelers.length = 0; this.projectiles.length = 0; this.auras.clear();
    this.generation++; this.info = { zone: '', baseLight: 0, rain: false, snow: false, fog: false };
  }
  /** Protocol.bas logout cleanup (bRain, bNiebla, bNieve, pausa); the browser session starts a fresh WorldFx per connection. */

  receive(packet: ServerPacket): void {
    const now = this.clockNow();
    switch (packet.id) {
      case S.ChangeMap: this.resetMap(); break;
      case W.Hora: this.clock.onHora(packet.elapsedMs, packet.dayLenMs, now); this.lights.dirty = true; break;
      case W.PauseToggle: this.paused = !this.paused; break;
      case W.ShowFrmMapa: this.mapForm = { opened: this.mapForm.opened + 1, expMult: packet.expMult, goldMult: packet.goldMult }; break;
      case W.Ubicacion:
        // HandleUbicacion: x = 0 hides the slot; otherwise the dot moves only when the member is on the player's map.
        if (packet.x === 0) this.allies.delete(packet.member);
        else if (packet.member >= 1 && packet.member <= 5 && this.hooks.currentMap?.() === packet.map) this.allies.set(packet.member, { x: packet.x, y: packet.y });
        break;
      case SES.FlashScreen: this.flashScreen(packet.color, packet.duration, packet.ignore); break;
      case W.AreaChanged: this.hooks.areaChanged?.(areaBounds(packet.x, packet.y)); break;
      case AU.RainToggle:
        this.raining = packet.raining;
        if (this.info.rain) { if (packet.raining) this.setMeteo(RAIN_STREAM, false); else this.removeMeteo(); }
        break;
      case AU.NieveToggle:
        this.snowing = packet.snowing;
        if (this.info.snow) { if (packet.snowing) this.setMeteo(SNOW_STREAM, false); else this.removeMeteo(); }
        break;
      case W.NieblaToggle: this.fogMax = packet.maxAlpha; this.fogOn = !this.fogOn; break;
      case W.LightToFloor: this.lights.lightToFloor(packet.x, packet.y, packet.color, packet.range); break;
      case W.SpeedToChar: this.hooks.speedToChar?.(packet.charIndex, packet.speeding); break;
      case W.AuraToChar: this.setAura(packet.charIndex, packet.type, packet.aura, packet.remove); break;
      case SS.ParticleFX: this.particleFx(packet); break;
      case SS.ParticleFXToFloor: this.particleToFloor(packet.x, packet.y, packet.particle, packet.time); break;
      case SS.ParticleFXWithDestino: this.travelToChar(packet); break;
      case SS.ParticleFXWithDestinoXY: this.travelToTile(packet); break;
      case SS.CreateProjectile: {
        const def = fxTables.projectiles[packet.projectileType - 1];
        if (def && this.projectiles.length < MAX_PROJECTILES) this.projectiles.push(makeProjectile(def, packet.startX, packet.startY, packet.targetX, packet.targetY));
        break;
      }
      case S.CharacterCreate:
        // MakeChar: a character born with a particle effect keeps it for ever; auras ride in the same packet.
        if (packet.particleFx > 0) this.charParticle(packet.charIndex, packet.particleFx, -1, 0);
        for (const [type, aura] of [[4, packet.headAura], [1, packet.weaponAura], [2, packet.bodyAura], [6, packet.damageAura], [7, packet.resistanceAura], [5, packet.otherAura], [3, packet.shieldAura]] as const) {
          this.setAura(packet.charIndex, type, aura, false);
        }
        break;
      case NS.CharacterRemove: this.charGroups.delete(packet.charIndex); this.auras.delete(packet.charIndex); break;
      default: break;
    }
  }

  private setAura(charIndex: number, type: number, aura: string, remove: boolean) {
    let kinds = this.auras.get(charIndex);
    if (!kinds) { kinds = new Map(); this.auras.set(charIndex, kinds); }
    // HandleAuraToChar reads Remove and ignores it: the string is stored as sent, and "" or "0" draws nothing.
    void remove; kinds.set(type, aura);
  }

  private stream(id: number): Stream | undefined { return fxTables.streams[id - 1]; }
  private tile(x: number, y: number) { return (y - 1) * 100 + x - 1; }

  /** General_Particle_Create at a tile: only when the tile has no group yet (Particle_Group_Create). */
  private createTileGroup(streamId: number, x: number, y: number, life: number, noBorrar: boolean): ParticleGroup | undefined {
    const stream = this.stream(streamId);
    if (!stream || x < 1 || y < 1 || x > 100 || y > 100 || this.tileGroups.has(this.tile(x, y))) return undefined;
    const group = new ParticleGroup(streamId, stream, { life, noBorrar });
    this.tileGroups.set(this.tile(x, y), group);
    return group;
  }
  /** General_Char_Particle_Create: one group per (character, stream) that is not already draining. */
  private charParticle(charIndex: number, streamId: number, life: number, grh: number) {
    const stream = this.stream(streamId);
    if (!stream) return;
    const groups = this.charGroups.get(charIndex) ?? [];
    this.charGroups.set(charIndex, groups);
    groups.push(new ParticleGroup(streamId, stream, { life, ...(grh > 0 ? { grh } : {}), forChar: true }));
  }

  /** HandleParticleFX. */
  private particleFx(packet: { charIndex: number; particle: number; time: number; remove: boolean; grh: number }) {
    if (packet.remove) {
      // Char_Particle_Group_Remove: the first group of that stream that is not already draining.
      this.charGroups.get(packet.charIndex)?.find(g => g.streamId === packet.particle && !g.destruir)?.remove();
      return;
    }
    // MakeChar skips a stream the character already has; ParticleFX always creates one.
    this.charParticle(packet.charIndex, packet.particle, packet.time, packet.grh);
  }
  /** HandleParticleFXToFloor: Time 1 means for ever, Time 0 removes the tile's group. */
  private particleToFloor(x: number, y: number, particle: number, rawTime: number) {
    const time = rawTime === 1 ? -1 : rawTime;
    if (x < 1 || y < 1 || x > 100 || y > 100) return;
    const existing = this.tileGroups.get(this.tile(x, y));
    if (rawTime === 0) { existing?.remove(); return; }
    if (!existing) { this.createTileGroup(particle, x, y, time, false); return; }
    const charIndex = this.hooks.charAt?.(x, y);
    if (charIndex) this.charParticle(charIndex, particle, time, 0);
  }

  /** Engine_spell_Particle_Set: the travelling particle shared by every Effect slot. */
  private setSpellParticle(streamId: number) {
    this.spellGroup?.remove();
    const stream = this.stream(streamId);
    this.spellGroup = stream ? new ParticleGroup(streamId, stream) : undefined;
  }
  private travelToChar(p: { sender: number; receiver: number; travelParticle: number; finalParticle: number; time: number; wave: number; fx: number }) {
    this.setSpellParticle(p.travelParticle);
    this.travelers.push(this.makeTraveler(p.sender, p.receiver, 0, 0, p));
  }
  private travelToTile(p: { sender: number; travelParticle: number; finalParticle: number; time: number; wave: number; fx: number; x: number; y: number }) {
    this.setSpellParticle(p.travelParticle);
    this.travelers.push(this.makeTraveler(p.sender, 0, p.x, p.y, p));
  }
  /** Effect_Begin / Effect_BeginXY: the explosion is a particle stream (fx 0) or an FXs.ini effect (fx 1). */
  private makeTraveler(sender: number, receiver: number, x: number, y: number, p: { finalParticle: number; time: number; wave: number; fx: number }): Traveler {
    // The server often sends the cast and the target's CharacterRemove in one batch (a killing spell: the NPC is both emitter and receptor),
    // so the positions are taken now, while the characters still exist, like Effect_Begin does.
    const from = this.hooks.charTile?.(sender), to = receiver ? this.hooks.charTile?.(receiver) : undefined;
    return {
      sender, x: NaN, y: NaN, destChar: receiver, destX: x, destY: y, viaje: { x: 0, y: 0 }, speed: 9,
      endStream: p.fx === 1 ? 0 : p.finalParticle, endFx: p.fx === 1 ? p.finalParticle : 0, endLoops: p.time, wave: p.wave,
      ...(from ? { start: { x: from.x * 32, y: from.y * 32 } } : {}), ...(to ? { lastTile: { ...to } } : {}),
    };
  }

  /** Engine_MeteoParticle_Set. already = true is the map-change call; false (a live toggle) lifts the particles so the weather fades in. */
  private setMeteo(streamId: number, already: boolean) {
    const stream = this.stream(streamId);
    this.meteo?.remove();
    if (!stream) { this.meteo = undefined; return; }
    const group = new ParticleGroup(streamId, stream);
    group.warmUp(this.rnd, this.clockNow());
    if (!already) group.liftForLiveStart();
    this.meteo = group;
  }
  private removeMeteo() { this.meteo?.remove(); }

  /**
   * EsNoche: TimeIndex 0..2 (hours 0..5). The VB6 constants end up NightIndex = 0 and MorningIndex = 3 (IniciarMeteorologia assigns
   * each twice, the same value), so the evening hours 18..23 count as day.
   */
  get isNight() { return this.timeIndex >= NIGHT_INDEX && this.timeIndex < MORNING_INDEX; }

  /**
   * HandleFlashScreen -> EngineEfectoEnPantalla: with the map's fog flag (MapDat.niebla = 1) or the packet's ignore flag, `global_light` takes the
   * colour (alpha 255) and the Efecto timer runs for `durationMs`. NOTE (VB6 behaviour, kept): the lightmap only reads `global_light` when
   * `UpdateLights` is set, and RevisarHoraMundo (every 500 ms) overwrites `global_light` with the hour colour BEFORE it sets that flag, so in the
   * stock client the flash colour is replaced before any frame uses it. It is modelled exactly (state, timer, end rule) so a flash that lands
   * in the same frame as `UpdateLights` would show.
   */
  flashScreen(colorLong: number, durationMs: number, ignore: boolean) {
    if (!this.info.fog && !ignore) return;
    // The packet's Long is BGR (R in the low byte); `color And 255` is R.
    this.globalLight = { r: colorLong & 255, g: (colorLong >> 8) & 255, b: (colorLong >> 16) & 255 };
    this.efectoEndsAt = this.clockNow() + Math.max(1, durationMs);
  }
  /** frmMain.Efecto_Timer: the map's base light wins, else RestaurarLuz. */
  private endEfecto(dead: boolean) {
    this.efectoEndsAt = undefined;
    if (this.info.baseLight > 0) {
      const long = this.info.baseLight;
      this.globalLight = { r: (long >> 16) & 255, g: (long >> 8) & 255, b: long & 255 };
    } else this.globalLight = this.restaurarLuz(dead);
  }
  /** ModMetereologia.RestaurarLuz (before the first RevisarHoraMundo the light is white; afterwards the hour colour is left as it is). */
  private restaurarLuz(dead: boolean): Rgb {
    if (dead) return DEATH_COLOR;
    if (this.blind) return BLIND_COLOR;
    if (this.info.zone === 'DUNGEON' && !this.disableDungeonLighting) return DUNGEON_COLOR;
    return this.timeIndex >= 0 ? this.globalLight : WHITE;
  }
  /**
   * RevisarHoraMundo (UpdateDaytime, every 500 ms). `ActualizarLuz` (last_light / next_light / light_transition) is not ported on purpose:
   * its only reader is frmMain.UpdateLight_Timer and nothing in the client ever sets `UpdateLight.enabled = True` (it is only set to False,
   * Protocol.HandleDisconnect), so the 5 s easing never runs and the colour is the hour lerp alone.
   */
  private revisarHora(now: number) {
    if (!this.clock.inited) return; // WorldTime_DayLenMs <= 0: not initialised yet
    const hour = this.clock.time(now).hour;
    const index = hour >> 1;
    if (index !== this.timeIndex) {
      this.timeIndex = index;
      if (this.info.baseLight === 0) {
        if (index === NIGHT_INDEX) this.hooks.playGlobalWave?.(WOLF_WAVE);
        else if (index === MORNING_INDEX) this.hooks.playGlobalWave?.(ROOSTER_WAVE);
      }
    }
    this.globalLight = this.lightMode === 'day' ? DAY_LIGHT : this.lightMode === 'night' ? NIGHT_LIGHT : this.clock.hourLight(now);
    this.updateLights = true;
  }

  /**
   * One frame: advance the fog, the light, the travellers and projectiles, and every particle group that is on screen.
   * Groups outside the view are not simulated, like the VB6 loops that render (and so update) only visible tiles.
   */
  update(now: number, frame: FrameInfo): void {
    const dt = Math.min(frame.dt, 1000);
    // frmMain.TimerNiebla (100 ms): fade the clouds in towards MaxAlphaNiebla, or out to 0.
    this.fogAccumulator += dt;
    while (this.fogAccumulator >= FOG_STEP_MS) {
      this.fogAccumulator -= FOG_STEP_MS;
      if (this.fogOn) { if (this.fogAlpha < this.fogMax) this.fogAlpha++; else this.fogAlpha = this.fogMax; }
      else if (this.fogAlpha > 0) this.fogAlpha--; else { this.fogAlpha = 0; this.fogMax = 0; }
    }
    if (this.info.fog && this.fogAlpha) this.scrollFog(dt);

    // RevisarHoraMundo runs every 500 ms and flags UpdateLights; RestaurarLuz then applies death / blind / dungeon when the lightmap is rebuilt.
    const dungeon = this.info.zone === 'DUNGEON';
    if (now - this.lastAmbientAt >= 500) { this.lastAmbientAt = now; this.revisarHora(now); }
    if (frame.selfDead !== this.lastDead || this.blind !== this.lastBlind || dungeon !== this.lastDungeon) {
      this.lastDead = frame.selfDead; this.lastBlind = this.blind; this.lastDungeon = dungeon; this.updateLights = true;
    }
    if (this.efectoEndsAt !== undefined && this.clockNow() >= this.efectoEndsAt) this.endEfecto(frame.selfDead);
    if (this.updateLights) {
      this.updateLights = false;
      this.globalLight = this.restaurarLuz(frame.selfDead);
      this.ambient = this.globalLight;
    }
    if (!this.lights.isCurrent(this.ambient)) this.lights.recompute(this.ambient);

    const ticks = dt * ENGINE_BASE_SPEED;
    // Tile groups: only the visible ones render, so only they advance.
    const v = frame.view;
    for (const [tile, group] of this.tileGroups) {
      const x = (tile % 100) + 1, y = Math.floor(tile / 100) + 1;
      if (x < v.minX || x > v.maxX || y < v.minY || y > v.maxY) continue;
      group.tick(ticks, now, this.rnd);
      if (group.done) this.tileGroups.delete(tile);
    }
    for (const [charIndex, groups] of this.charGroups) {
      const at = frame.charPixel(charIndex);
      for (const group of groups) if (at) group.tick(ticks, now, this.rnd);
      const live = groups.filter(g => !g.done);
      if (live.length) this.charGroups.set(charIndex, live); else this.charGroups.delete(charIndex);
    }
    if (this.meteo && (this.info.rain || this.info.snow)) { this.meteo.tick(ticks, now, this.rnd); if (this.meteo.done) this.meteo = undefined; }
    if (this.spellGroup && this.travelers.length) this.spellGroup.tick(ticks, now, this.rnd);
    this.updateTravelers(frame, ticks);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      // The VB6 loop draws a projectile on the frame it arrives, then releases it: the renderer sees it for one more frame via `arrived`.
      if (stepProjectile(this.projectiles[i]!, dt)) this.projectiles.splice(i, 1);
    }
  }

  private scrollFog(dt: number) {
    const f = this.fog, r = this.rnd;
    f.x1 += dt * (0.018 + r() * 0.01); f.y1 += dt * (0.013 + r() * 0.01);
    f.x2 -= dt * (0.037 + r() * 0.01); f.y2 -= dt * (0.021 + r() * 0.01);
    const wrap = (v: number) => { while (v < -512) v += 512; while (v > 0) v -= 512; return v; };
    f.x1 = wrap(f.x1); f.y1 = wrap(f.y1); f.x2 = wrap(f.x2); f.y2 = wrap(f.y2);
  }

  /** Effect_Render_Slot, in world pixels (the VB6 numbers are player-centred screen pixels of the same tile geometry). */
  private updateTravelers(frame: FrameInfo, ticks: number) {
    for (let i = this.travelers.length - 1; i >= 0; i--) {
      const t = this.travelers[i]!;
      if (Number.isNaN(t.x)) {
        // Effect_Begin: Now = the emitter's tile pixel - (16, 20) (Get_Pixelx_Of_Char is the tile centre; Get_PixelY_Of_Char the tile top).
        const from = frame.charPixel(t.sender) ?? t.start;
        if (!from) { this.travelers.splice(i, 1); continue; }
        t.x = from.x; t.y = from.y - 20;
      }
      let to = t.destChar ? frame.charPixel(t.destChar) : { x: t.destX * 32, y: t.destY * 32 };
      if (t.destChar && to) t.lastTile = this.hooks.charTile?.(t.destChar) ?? { x: Math.round(to.x / 32), y: Math.round(to.y / 32) };
      else if (t.destChar && t.lastTile) {
        // EraseChar: an effect flying to a character that is erased keeps going to that character's last tile (DestinoChar = 0).
        t.destChar = 0; t.destX = t.lastTile.x; t.destY = t.lastTile.y;
        to = { x: t.destX * 32, y: t.destY * 32 };
      }
      if (!to) { this.travelers.splice(i, 1); continue; }
      // The target is the destination's tile centre horizontally and 32 px above its top (Get_Pixelx_Of_Char, Get_PixelY_Of_Char - 32).
      t.viaje = { x: to.x + 16, y: to.y - 32 };
      const dx = t.viaje.x - t.x, dy = t.viaje.y - t.y, length = Math.hypot(dx, dy);
      // The VB6 only snaps within 5 px per axis, so a step longer than the remaining distance can overshoot for ever at a steady
      // frame time; a step that would reach the target lands on it (the only deviation in this movement).
      const step = t.speed * ticks * 9;
      if (length <= step) { t.x = t.viaje.x; t.y = t.viaje.y; }
      else if (length > 0) { t.x += (dx / length) * step; t.y += (dy / length) * step; }
      if (Math.abs(t.viaje.x - t.x) < 5) t.x = t.viaje.x;
      if (Math.abs(t.viaje.y - t.y) < 5) t.y = t.viaje.y;
      if (t.x !== t.viaje.x || t.y !== t.viaje.y) continue;
      // Arrived: the explosion, as a char/tile particle or an FXs.ini effect, and the wave.
      if (t.endStream) {
        if (t.destChar) this.charParticle(t.destChar, t.endStream, t.endLoops, 0);
        else { this.tileGroups.delete(this.tile(t.destX, t.destY)); this.createTileGroup(t.endStream, t.destX, t.destY, t.endLoops, false); }
      } else if (t.endFx > 0) {
        this.hooks.addFx?.({ fx: t.endFx, charIndex: t.destChar || undefined, x: t.destX, y: t.destY, loops: t.destChar ? t.endLoops : 0 });
      }
      // Effect_Render_Slot: a tile explosion also plays its wave with no position (`PlayWav(.wav)`) before the positional one.
      if (t.wave > 0 && t.endStream && !t.destChar) this.hooks.playGlobalWave?.(t.wave);
      // The positional wave is at charlist(DestinoChar).Pos, or at the tile (EstaPCarea / EstaEnArea decide whether it is heard).
      const at = t.destChar ? t.lastTile! : { x: t.destX, y: t.destY };
      if (t.wave > 0) this.hooks.playWave?.(t.wave, at.x, at.y);
      this.travelers.splice(i, 1);
    }
  }
}
