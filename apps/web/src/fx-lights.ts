/*
 * Day/night colour and per-tile light, adapted 2026-11-20 from the classic client's ModMetereologia.bas (DayColors,
 * RevisarHoraMundo, RestaurarLuz), modWorldTime.bas, TileEngine_Map.MapUpdateGlobalLightRender, ClsRoundLight.cls
 * (LucesRedondas) and clsLucesCuadradas.cls (LucesCuadradas). Copyright (C) 2022-2026 Noland Studios.
 * AGPL-3.0-or-later; no warranty. See ../../../LICENSE and ../../../NOTICE.
 *
 * Pure logic. VB6 stores four vertex colours per tile (light_value(0..3): bottom-left, top-left, bottom-right, top-right of the
 * 32 px tile) and multiplies every sprite on the tile by them; LightGrid keeps those arrays.
 */
export interface Rgb { r: number; g: number; b: number }
const rgb = (r: number, g: number, b: number): Rgb => ({ r, g, b });

/** ModMetereologia.IniciarMeteorologia: DayColors(0..23), indexed by the in-game hour (the VB6 comments are off by one hour; the indices are what counts). */
export const DAY_COLORS: readonly Rgb[] = [
  rgb(120, 120, 120), rgb(120, 120, 120), rgb(120, 120, 120), rgb(120, 120, 120), rgb(138, 138, 138), rgb(156, 156, 145),
  rgb(170, 170, 155), rgb(185, 185, 185), rgb(200, 200, 200), rgb(220, 220, 220), rgb(235, 235, 235), rgb(245, 245, 245),
  rgb(255, 255, 255), rgb(255, 255, 255), rgb(255, 255, 255), rgb(245, 245, 245), rgb(230, 230, 230), rgb(220, 220, 220),
  rgb(200, 200, 180), rgb(180, 160, 160), rgb(160, 160, 160), rgb(140, 140, 140), rgb(120, 120, 140), rgb(120, 120, 120),
];
/** UserStats.estado = 1 (dead), UserCiego (blind) and MapDat.zone = "DUNGEON" (RestaurarLuz). */
export const DEATH_COLOR = rgb(120, 120, 120);
export const BLIND_COLOR = rgb(4, 4, 4);
export const DUNGEON_COLOR = rgb(190, 190, 190);
export const WHITE = rgb(255, 255, 255);

/** e_selectedlight: hourLight follows the clock, dayLight / nightLight pin it (options, VIDEO/LuzGlobal). */
export type LightMode = 'hour' | 'day' | 'night';
export const DAY_LIGHT = rgb(255, 255, 255);
export const NIGHT_LIGHT = rgb(120, 120, 120);

const lerp = (a: Rgb, b: Rgb, f: number): Rgb => ({
  r: Math.round(a.r * (1 - f) + b.r * f), g: Math.round(a.g * (1 - f) + b.g * f), b: Math.round(a.b * (1 - f) + b.b * f),
});

/** modWorldTime: the server's Hora packet anchors the day; the client counts on from its own clock. */
export class WorldClock {
  private base = 0;
  private dayLen = 1;
  /** WT_Inited: until the first Hora the VB6 client sits at hour 0 of a one-millisecond day. */
  inited = false;
  /** WorldTime_HandleHora. */
  onHora(elapsedMs: number, dayLenMs: number, now: number) {
    this.dayLen = dayLenMs <= 0 ? 1 : dayLenMs;
    const elapsed = ((elapsedMs % this.dayLen) + this.dayLen) % this.dayLen;
    this.base = now - elapsed; this.inited = true;
  }
  /** WorldTime_Ms: milliseconds into the in-game day. */
  ms(now: number): number {
    if (!this.inited) return 0;
    return (((now - this.base) % this.dayLen) + this.dayLen) % this.dayLen;
  }
  /** RevisarHoraMundo: hour 0..23, the minutes label and the fraction into the hour. */
  time(now: number) {
    const elapsed24 = (this.ms(now) / this.dayLen) * 24;
    const hour = Math.floor(elapsed24), fraction = elapsed24 - hour;
    return { hour, minutes: Math.floor(fraction * 60), fraction, label: `${String(hour).padStart(2, '0')}:${String(Math.floor(fraction * 60)).padStart(2, '0')}` };
  }
  /** global_light for hourLight: LerpRGB between the previous hour's colour and this hour's by the fraction into the hour. */
  hourLight(now: number): Rgb {
    const { hour, fraction } = this.time(now);
    return lerp(DAY_COLORS[(hour + 23) % 24]!, DAY_COLORS[hour]!, fraction);
  }
}

/** What decides the ambient colour besides the clock (RestaurarLuz order: dead, blind, dungeon, else the hour colour). */
export interface AmbientState { dead: boolean; blind: boolean; dungeon: boolean; mode: LightMode; disableDungeonLighting: boolean }
export function ambientLight(clock: WorldClock, now: number, state: AmbientState): Rgb {
  if (state.dead) return DEATH_COLOR;
  if (state.blind) return BLIND_COLOR;
  if (state.dungeon && !state.disableDungeonLighting) return DUNGEON_COLOR;
  if (state.mode === 'day') return DAY_LIGHT;
  if (state.mode === 'night') return NIGHT_LIGHT;
  return clock.hourLight(now);
}

export interface StaticLight { x: number; y: number; color: Rgb; range: number }

const SIZE = 100;
const inMap = (x: number, y: number) => x >= 1 && y >= 1 && x <= SIZE && y <= SIZE;
/** Vertex order of light_value(): 0 bottom-left, 1 top-left, 2 bottom-right, 3 top-right. */
export const VERTEX_OFFSETS = [[0, 32], [0, 0], [32, 32], [32, 0]] as const;

/**
 * The map's per-tile vertex colours (MapData.light_value). `recompute` is MapUpdateGlobalLightRender: reset to the ambient colour,
 * then the round lights (LucesRedondas.LightRenderAll), then the square lights (LucesCuadradas.Light_Render_All).
 */
export class LightGrid {
  /** [tile (y-1)*100 + x-1][vertex 0..3][r,g,b] */
  readonly data = new Uint8Array(SIZE * SIZE * 12).fill(255);
  private readonly squares: (StaticLight | undefined)[] = [];
  private rounds: StaticLight[] = [];
  /** MapData(x, y).luz.Rango: the range last written for a tile (LightToFloor decides square or round from it). */
  private readonly rangeAt = new Map<number, number>();
  dirty = true;
  /** Bumped by every recompute; the renderer rebuilds its colour buffer when it changes. */
  version = 0;
  private ambient: Rgb = WHITE;

  get lightCount() { return this.rounds.length + this.squares.filter(Boolean).length; }
  clear() { this.squares.length = 0; this.rounds = []; this.rangeAt.clear(); this.dirty = true; }

  /** Recursos.CargarMapa: range < 100 is a square light, otherwise a round light of range - 99; range 0 is no light. */
  addMapLight(light: StaticLight) {
    if (light.range <= 0 || !inMap(light.x, light.y)) return;
    this.rangeAt.set(this.key(light.x, light.y), light.range);
    if (light.range < 100) this.createSquare(light.x, light.y, light.color, light.range);
    else this.rounds.push({ ...light, range: light.range - 99 });
    this.dirty = true;
  }
  /** HandleLightToFloor. A colour of 0 removes the light on the tile (round only when its recorded range is above 100, like the VB6 test). */
  lightToFloor(x: number, y: number, colorLong: number, range: number) {
    if (!inMap(x, y)) return;
    const key = this.key(x, y);
    if (colorLong === 0) {
      if ((this.rangeAt.get(key) ?? 0) > 100) this.rounds.splice(this.rounds.findIndex(l => l.x === x && l.y === y), 1);
      else { const slot = this.squares.findIndex(l => l?.x === x && l.y === y); if (slot >= 0) this.squares[slot] = undefined; }
      this.rangeAt.delete(key); this.dirty = true;
      return;
    }
    // Long_2_RGBA: bytes B, G, R, A in memory = little endian 0xAARRGGBB read as int32 with B lowest.
    const color = { r: (colorLong >> 16) & 255, g: (colorLong >> 8) & 255, b: colorLong & 255 };
    this.rangeAt.set(key, range);
    if (range < 100) this.createSquare(x, y, color, range);
    else this.rounds.push({ x, y, color, range: range - 99 });
    this.dirty = true;
  }
  private key(x: number, y: number) { return (y - 1) * SIZE + x - 1; }
  /** Light_Create: ignored when a square light already sits on the tile; takes the first free slot (Light_Next_Open). */
  private createSquare(x: number, y: number, color: Rgb, range: number) {
    if (this.squares.some(l => l?.x === x && l.y === y)) return;
    const free = this.squares.findIndex(l => l === undefined);
    const light = { x, y, color, range };
    if (free >= 0) this.squares[free] = light; else this.squares.push(light);
  }

  /** MapUpdateGlobalLightRender. */
  recompute(ambient: Rgb) {
    this.ambient = ambient;
    const d = this.data;
    for (let i = 0; i < SIZE * SIZE * 4; i++) { d[i * 3] = ambient.r; d[i * 3 + 1] = ambient.g; d[i * 3 + 2] = ambient.b; }
    for (const light of this.rounds) this.renderRound(light);
    for (const light of this.squares) if (light) this.renderSquare(light);
    this.dirty = false; this.version++;
  }
  isCurrent(ambient: Rgb) { return !this.dirty && ambient.r === this.ambient.r && ambient.g === this.ambient.g && ambient.b === this.ambient.b; }

  private set(x: number, y: number, vertex: number, c: Rgb) {
    if (!inMap(x, y)) return;
    const at = ((y - 1) * SIZE + x - 1) * 12 + vertex * 3;
    this.data[at] = c.r; this.data[at + 1] = c.g; this.data[at + 2] = c.b;
  }
  /** ClsRoundLight.LightRender: every vertex within (range * 32 + 16) px blends from the light colour at the centre to the existing colour at the edge. */
  private renderRound(light: StaticLight) {
    const { x: mx, y: my, range, color } = light;
    const lx = mx * 32 + 16, ly = my * 32 + 16;
    const radius = range * 32 + 16, radius2 = radius * radius;
    for (let ya = my - range; ya <= my + range; ya++) for (let xa = mx - range; xa <= mx + range; xa++) {
      if (!inMap(xa, ya)) continue;
      for (let v = 0; v < 4; v++) {
        const dx = lx - (xa * 32 + VERTEX_OFFSETS[v]![0]), dy = ly - (ya * 32 + VERTEX_OFFSETS[v]![1]);
        const d2 = dx * dx + dy * dy;
        if (d2 > radius2) continue;
        const at = ((ya - 1) * SIZE + xa - 1) * 12 + v * 3, f = d2 / radius2, data = this.data;
        data[at] = Math.round(color.r * (1 - f) + data[at]! * f);
        data[at + 1] = Math.round(color.g * (1 - f) + data[at + 1]! * f);
        data[at + 2] = Math.round(color.b * (1 - f) + data[at + 2]! * f);
      }
    }
  }
  /** clsLucesCuadradas.Light_Render: the box of tiles around the light takes the colour; the outer ring only the vertices facing the light. */
  private renderSquare(light: StaticLight) {
    const { x: mx, y: my, range, color } = light;
    const minX = mx - range, maxX = mx + range, minY = my - range, maxY = my + range;
    for (let v = 0; v < 4; v++) this.set(mx, my, v, color);
    this.set(minX, minY, 2, color); this.set(maxX, minY, 0, color); this.set(maxX, maxY, 1, color); this.set(minX, maxY, 3, color);
    for (let x = minX + 1; x <= maxX - 1; x++) { this.set(x, minY, 0, color); this.set(x, minY, 2, color); }
    for (let x = minX + 1; x <= maxX - 1; x++) { this.set(x, maxY, 1, color); this.set(x, maxY, 3, color); }
    for (let y = minY + 1; y <= maxY - 1; y++) { this.set(minX, y, 2, color); this.set(minX, y, 3, color); }
    for (let y = minY + 1; y <= maxY - 1; y++) { this.set(maxX, y, 0, color); this.set(maxX, y, 1, color); }
    for (let x = minX + 1; x <= maxX - 1; x++) for (let y = minY + 1; y <= maxY - 1; y++) for (let v = 0; v < 4; v++) this.set(x, y, v, color);
  }

  /** The four vertex colours of a tile (light_value(0..3): bottom-left, top-left, bottom-right, top-right, the clsBatch.Draw corner order), for roofs. */
  tileCorners(x: number, y: number): [Rgb, Rgb, Rgb, Rgb] {
    if (!inMap(x, y)) return [WHITE, WHITE, WHITE, WHITE];
    const at = ((y - 1) * SIZE + x - 1) * 12, d = this.data;
    const corner = (v: number): Rgb => ({ r: d[at + v * 3]!, g: d[at + v * 3 + 1]!, b: d[at + v * 3 + 2]! });
    return [corner(0), corner(1), corner(2), corner(3)];
  }
  /** The mean colour of a tile's four vertices: a single tint for sprites the lightmap does not cover (roofs). */
  tileTint(x: number, y: number): Rgb {
    if (!inMap(x, y)) return WHITE;
    const at = ((y - 1) * SIZE + x - 1) * 12, d = this.data;
    return {
      r: Math.round((d[at]! + d[at + 3]! + d[at + 6]! + d[at + 9]!) / 4),
      g: Math.round((d[at + 1]! + d[at + 4]! + d[at + 7]! + d[at + 10]!) / 4),
      b: Math.round((d[at + 2]! + d[at + 5]! + d[at + 8]! + d[at + 11]!) / 4),
    };
  }
}
