/*
 * Pure audio rules of the classic client: volume and pan by distance, footstep terrains, ambient and music selection.
 * Adapted 2026-11-20 from client ao20audio.bas (ComputeVolumeByDistance, ComputeCharFxPan, PlayAmbientAudio, PlayMapMusic),
 * clsAudioEngine.cls (ConvertFxVolumeToBass, OGG-first sample lookup), TileEngine.bas (DoPasosFx, GetTerrenoDePaso),
 * TileEngine_Map.bas (PlayCurrentMapMusic), Recursos.bas (CargarPasos, CargarZonas) and ao20config.bas.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty. See ../../../LICENSE.
 *
 * VB6 volumes are DirectSound attenuations in hundredths of a decibel: 0 is full volume, -4000 the quietest the options window
 * offers, -10000 silence. Pan is -10000 (left) .. 10000 (right).
 */

/** ao20audio.bas Const SND_*. */
export const SND = {
  exclamation: 451, click: 500, clickOver: 501, sailing: 50, dice: 188, fire: 116, rainInLoop: 191, rainOutLoop: 194,
  rainInEnd: 192, rainOutEnd: 195, snowIn: 191, snowOut: 194, resurrect: 104, heal: 101, meditate: 158, characterSelect: 192,
} as const;

export type FxCategory = 'general' | 'steps' | 'ambient';
export const MIN_VOLUME = -4000;

/** Declares.bas TipoPaso. */
export enum Terrain { Forest = 1, Snow = 2, Horse = 3, Dungeon = 4, Floor = 5, Desert = 6, Water = 7 }
/** Recursos.bas CargarPasos: [left foot, right foot] wave ids per terrain (index 1 = Pie true). */
export const STEP_SOUNDS: Readonly<Record<Terrain, readonly [number, number]>> = {
  [Terrain.Forest]: [201, 69], [Terrain.Snow]: [199, 200], [Terrain.Horse]: [70, 71], [Terrain.Dungeon]: [23, 24],
  [Terrain.Desert]: [197, 198], [Terrain.Floor]: [23, 24], [Terrain.Water]: [SND.sailing, SND.sailing],
};

/** TileEngine.GetTerrenoDePaso: the terrain from the file number of layer 1 and the layer-2/3 graphic over it. */
export function terrainOf(file: number, overlay: number): Terrain {
  if ((file >= 6000 && file <= 6004) || (file >= 550 && file <= 552) || (file >= 6018 && file <= 6020)) return Terrain.Forest;
  if ((file >= 7501 && file <= 7507) || file === 7500 || file === 7508 || file === 1533 || file === 2508) return Terrain.Dungeon;
  if (file >= 5000 && file <= 5004) return Terrain.Snow;
  if ((file >= 6018 && file <= 6021) || file === 186 || file === 8007) return Terrain.Desert;
  if (file === 20 && overlay === 0) return Terrain.Water;
  return Terrain.Floor;
}

/** clsAudioEngine.ConvertFxVolumeToBass (also used for music): 10^(volume / 2000), 1 at 0 or above, 0 at -10000 or below. */
export function gainOf(volume: number): number {
  if (volume >= 0) return 1;
  if (volume <= -10_000) return 0;
  return Math.min(1, Math.max(0, 10 ** (volume / 2000)));
}
/** clsAudioEngine.ConvertFxPanToBass, already in Web Audio's -1..1. */
export const panOf = (pan: number) => Math.max(-1, Math.min(1, pan / 10_000));

/** ModUtils.General_Distance_Get: Manhattan distance. */
export const distance = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) + Math.abs(ay - by);

/** ao20audio.ComputeVolumeByDistance: base volume minus 120 per tile, floor -4000, beyond 19 tiles -4000. */
export function volumeByDistance(base: number, tiles: number): number {
  const d = Math.abs(tiles);
  return d < 20 ? Math.max(MIN_VOLUME, base - d * 120) : MIN_VOLUME;
}
/** ao20audio.ComputeCharFxPanByDistance; `sign` is -1 left of the player, 1 right, 0 same column. */
export function panByDistance(tiles: number, sign: number, invert: boolean): number {
  const s = invert ? -sign : sign;
  if (tiles === 0 || s === 0) return 0;
  return tiles < 19 ? s * tiles * 500 : s * 9000;
}
/** ao20audio.ComputeCharFxPan for a source at (x, y) heard from (ux, uy). */
export function panAt(x: number, y: number, ux: number, uy: number, invert: boolean): number {
  const tiles = distance(x, y, ux, uy);
  if (tiles === 0 || x === ux) return 0;
  const sign = invert ? (x > ux ? -1 : 1) : (x < ux ? -1 : 1);
  return tiles < 19 ? sign * tiles * 500 : sign * 9000;
}
/**
 * TileEngine_Chars.EstaEnArea with the classic 736x608 viewport: MinXBorder = 1 + 736 \ 64 = 12, MinYBorder = 1 + 608 \ 64 = 10.
 */
export const inHearingArea = (x: number, y: number, ux: number, uy: number) => x > ux - 12 && x < ux + 12 && y > uy - 10 && y < uy + 10;

/** The VB6 effective volume: min(category volume, requested attenuation); a request of 0 means "the category volume". */
export const effectiveVolume = (category: number, requested: number) => Math.min(category, requested);

/**
 * Protocol.HandlePlayWave: which file to play and whether to play at all.
 * Waves 400..404 are fog sounds that play only when the map has fog; `localize` prefixes the language code (Spanish never does).
 */
export function waveFile(wave: number, localize: number, language: string, fog: boolean): string | undefined {
  if (wave >= 400 && wave <= 404 && !fog) return undefined;
  return localize === 1 && language !== 'es' ? `${language}_${wave}` : String(wave);
}

/** Pasos: the foot alternates per character each step (Char.Pie toggles before use, so the first step is index 1). */
export const stepWave = (terrain: Terrain, foot: boolean) => STEP_SOUNDS[terrain][foot ? 0 : 1];

/** Map ambient "night-day" (MapDat.ambient, PlayAmbientAudio): field 1 at night, field 2 by day; 0 or empty is silence. */
export function ambientWave(ambient: string, night: boolean): number {
  const parts = ambient.split('-');
  const value = Number.parseInt((night ? parts[0] : parts[1]) ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Recursos.CargarZonas (Dat/zonas.dat): music zones rectangles per map. */
export interface MusicZone { map: number; music: number; x1: number; x2: number; y1: number; y2: number }
export function parseZones(text: string): MusicZone[] {
  const zones: MusicZone[] = [];
  let section = '';
  let fields = new Map<string, string>();
  const flush = () => {
    if (/^zona\d+$/i.test(section)) {
      const n = (key: string) => Number.parseInt(fields.get(key) ?? '', 10) || 0;
      zones.push({ map: n('mapa'), music: n('musica'), x1: n('x1'), x2: n('x2'), y1: n('y1'), y2: n('y2') });
    }
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) { flush(); section = header[1]!; fields = new Map(); continue; }
    const pair = /^([^=;]+)=(.*)$/.exec(line);
    if (pair) fields.set(pair[1]!.trim().toLowerCase(), pair[2]!.trim());
  }
  flush();
  return zones;
}
/**
 * TileEngine_Map.PlayCurrentMapMusic: the zone under the player wins (later zones overwrite earlier ones, as in the tile loop),
 * else MapDat.music_numberLow. A result of 0 or less stops the music; the file is ost_<id>.ogg (PlayMapMusic).
 */
export function mapMusicId(zones: readonly MusicZone[], map: number, x: number, y: number, headerMusic: number): number {
  let zone = 0;
  for (const z of zones) if (z.map === map && x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) zone = z.music;
  return zone > 0 ? zone : headerMusic;
}
export const musicFile = (id: number) => `ost_${id}`;

/** ao20config.bas defaults (OUTPUT/DefaultSettings.ini [AUDIO]); a positive stored volume means full volume. */
export interface AudioSettings {
  audioEnabled: boolean; musicEnabled: boolean; fxEnabled: boolean; stepsEnabled: boolean; ambientEnabled: boolean; invertChannels: boolean;
  volMusic: number; volFx: number; volSteps: number; volAmbient: number;
}
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  audioEnabled: true, musicEnabled: true, fxEnabled: true, stepsEnabled: true, ambientEnabled: true, invertChannels: true,
  volMusic: 0, volFx: 0, volSteps: 0, volAmbient: 0,
};
const clampVolume = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(MIN_VOLUME, Math.min(0, Math.round(value))) : fallback;
/** Reads a stored settings object defensively: unknown keys are dropped, bad values fall back to the default. */
export function sanitizeSettings(raw: unknown): AudioSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const flag = (key: keyof AudioSettings) => typeof o[key] === 'boolean' ? o[key] as boolean : DEFAULT_AUDIO_SETTINGS[key] as boolean;
  const d = DEFAULT_AUDIO_SETTINGS;
  return {
    audioEnabled: flag('audioEnabled'), musicEnabled: flag('musicEnabled'), fxEnabled: flag('fxEnabled'),
    stepsEnabled: flag('stepsEnabled'), ambientEnabled: flag('ambientEnabled'), invertChannels: flag('invertChannels'),
    volMusic: clampVolume(o.volMusic, d.volMusic), volFx: clampVolume(o.volFx, d.volFx),
    volSteps: clampVolume(o.volSteps, d.volSteps), volAmbient: clampVolume(o.volAmbient, d.volAmbient),
  };
}
