/*
 * The world grid behind the minimap and the large world map (frmMapaGrande): Recursos.Cargarmapsworlddata (init/mapsworlddata.dat),
 * ModMinimap.RenderMinimapCentered (the DirectX centred / zoomed minimap, CenteredMinimap = 1, the VB6 default), frmMain.SetMinimapPosition
 * and ModUtils MINIMAP_* constants. Pure logic, no DOM. Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty.
 * See ../../../LICENSE and ../../../NOTICE.
 */
import type { Ini } from './assets.js';

export interface World { ancho: number; alto: number; /** MapIndice(1..ancho*alto): the map number of each grid cell, 0 = empty. */ indice: number[] }

/** Recursos.Cargarmapsworlddata: [INIT] TotalWorlds, then [WORLDMAPn] Alto, Ancho and one key per cell (1-based, left to right, top to bottom). */
export function parseWorlds(ini: Ini): World[] {
  const total = Number(ini.get('init')?.get('totalworlds') ?? 0);
  const worlds: World[] = [];
  for (let n = 1; n <= total; n++) {
    const section = ini.get(`worldmap${n}`);
    const alto = Number(section?.get('alto') ?? 0), ancho = Number(section?.get('ancho') ?? 0);
    const indice: number[] = [];
    for (let i = 1; i <= alto * ancho; i++) indice.push(Number(section?.get(String(i)) ?? 0) || 0);
    worlds.push({ ancho, alto, indice });
  }
  return worlds;
}

/** frmMapaGrande.SearchMap / ObtenerIdMapaDeLlamadaDeClan: the first world and 1-based grid cell holding a map. */
export function findMap(worlds: readonly World[], map: number): { world: number; cell: number } | undefined {
  if (map <= 0) return undefined;
  for (const [w, world] of worlds.entries()) {
    const at = world.indice.indexOf(map);
    if (at >= 0) return { world: w + 1, cell: at + 1 };
  }
  return undefined;
}

/** ModUtils MINIMAP_*: the usable tiles of a map in its minimap cell. */
export const MINIMAP_MIN_X = 14, MINIMAP_MAX_X = 87, MINIMAP_MIN_Y = 11, MINIMAP_MAX_Y = 90;
export const MINIMAP_TILES_X = 74, MINIMAP_TILES_Y = 80;
/** The minimap control (frmMain.MiniMap ScaleWidth/Height). */
export const MINIMAP_SIZE = 100;
/**
 * Pixels of one map cell in the world picture. The VB6 file is `mapa1_200x200.bmp`, which this resource set does not ship: the client
 * composes the same picture from the 100 x 100 per-map minimaps (Recursos/Minimapas), each scaled 2x into a 200 x 200 cell.
 */
export const CELL_PX = 200;

export interface CenteredView {
  /** Crop of the world picture, in world-picture pixels. */
  srcX: number; srcY: number; srcW: number; srcH: number;
  destW: number; destH: number;
  /** The player's map cell (0-based column and row) and the pixel size of a cell (MinimapVP_*). */
  gridX: number; gridY: number; cellW: number; cellH: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** VB6 `CLng`: round half to even. */
const clng = (v: number) => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };

/** ModMinimap.RenderMinimapCentered: which part of the world picture the control shows, with the player in the middle. */
export function centeredView(world: World, cell: number, tileX: number, tileY: number, zoom: number, cellPx = CELL_PX): CenteredView {
  const bmpW = world.ancho * cellPx, bmpH = world.alto * cellPx;
  const cellW = bmpW / world.ancho, cellH = bmpH / world.alto;
  const gridX = (cell - 1) % world.ancho, gridY = Math.floor((cell - 1) / world.ancho);
  const tx = clamp(tileX, MINIMAP_MIN_X, MINIMAP_MAX_X), ty = clamp(tileY, MINIMAP_MIN_Y, MINIMAP_MAX_Y);
  const centerX = clng((gridX + (tx - MINIMAP_MIN_X + 0.5) / MINIMAP_TILES_X) * cellW);
  const centerY = clng((gridY + (ty - MINIMAP_MIN_Y + 0.5) / MINIMAP_TILES_Y) * cellH);
  const delta = clamp(zoom, -50, 50);
  let srcW = MINIMAP_SIZE + delta, srcH = MINIMAP_SIZE + delta;
  srcW = Math.min(bmpW, Math.max(16, srcW)); srcH = Math.min(bmpH, Math.max(16, srcH));
  // `\` is integer division.
  let srcX = centerX - Math.trunc(srcW / 2), srcY = centerY - Math.trunc(srcH / 2);
  srcX = clamp(srcX, 0, bmpW - srcW); srcY = clamp(srcY, 0, bmpH - srcH);
  return { srcX, srcY, srcW, srcH, destW: MINIMAP_SIZE, destH: MINIMAP_SIZE, gridX, gridY, cellW, cellH };
}

/** frmMain.SetMinimapPosition, centred mode: slot 0 is always the middle of the control; an ally is projected onto the current crop. */
export function centeredDot(view: CenteredView, slot: number, tileX: number, tileY: number): { x: number; y: number } {
  if (slot === 0) return { x: Math.trunc(view.destW / 2), y: Math.trunc(view.destH / 2) };
  const px = clng((view.gridX + (tileX - MINIMAP_MIN_X + 0.5) / MINIMAP_TILES_X) * view.cellW);
  const py = clng((view.gridY + (tileY - MINIMAP_MIN_Y + 0.5) / MINIMAP_TILES_Y) * view.cellH);
  return { x: clng(((px - view.srcX) * view.destW) / view.srcW), y: clng(((py - view.srcY) * view.destH) / view.srcH) };
}

/** ModMinimap.InitMinimapDotColors: player white, then allies yellow, green, orange, magenta, blue. */
export const DOT_COLORS = ['#ffffff', '#ffff00', '#00c000', '#ff8000', '#ff00ff', '#0000ff'] as const;
/** RenderMinimapDots: a 6 px square centred on the dot. */
export const DOT_SQUARE = 6;

/**
 * The world-picture rectangles to paint for a crop: for every map cell the crop touches, the part of that cell's 100 x 100 minimap and
 * where it lands in the control. `cell` is the 1-based grid cell of the picture.
 */
export function cellDraws(world: World, view: CenteredView, cellPx = CELL_PX): { cell: number; map: number; sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }[] {
  const draws = [];
  const scaleX = view.destW / view.srcW, scaleY = view.destH / view.srcH;
  const firstX = Math.floor(view.srcX / cellPx), lastX = Math.floor((view.srcX + view.srcW - 1) / cellPx);
  const firstY = Math.floor(view.srcY / cellPx), lastY = Math.floor((view.srcY + view.srcH - 1) / cellPx);
  const ratio = MINIMAP_SIZE / cellPx; // the 100 px picture of a map fills its 200 px cell
  for (let cy = firstY; cy <= lastY; cy++) for (let cx = firstX; cx <= lastX; cx++) {
    if (cx < 0 || cy < 0 || cx >= world.ancho || cy >= world.alto) continue;
    const cell = cy * world.ancho + cx + 1, map = world.indice[cell - 1] ?? 0;
    const x0 = Math.max(view.srcX, cx * cellPx), x1 = Math.min(view.srcX + view.srcW, (cx + 1) * cellPx);
    const y0 = Math.max(view.srcY, cy * cellPx), y1 = Math.min(view.srcY + view.srcH, (cy + 1) * cellPx);
    if (x1 <= x0 || y1 <= y0) continue;
    draws.push({
      cell, map, sx: (x0 - cx * cellPx) * ratio, sy: (y0 - cy * cellPx) * ratio, sw: (x1 - x0) * ratio, sh: (y1 - y0) * ratio,
      dx: (x0 - view.srcX) * scaleX, dy: (y0 - view.srcY) * scaleY, dw: (x1 - x0) * scaleX, dh: (y1 - y0) * scaleY,
    });
  }
  return draws;
}

/** frmMapaGrande constants. */
export const BIG_TILE = 27, BIG_COLUMNS = 19, BIG_ROWS = 22;

/** frmMapaGrande.picMap_MouseDown: the grid cell (1-based) under a pixel of the world picture, and its top-left corner. */
export function bigMapCell(x: number, y: number): { cell: number; left: number; top: number } {
  const col = Math.floor(x / BIG_TILE), row = Math.floor(y / BIG_TILE);
  return { cell: col + row * BIG_COLUMNS + 1, left: col * BIG_TILE, top: row * BIG_TILE };
}
/** ActualizarPosicion: the player marker (Shape1, 5 px) inside the big map, centred on the tile (the picture covers 100 tiles per 27 px). */
export function bigMapPlayer(cell: number, tileX: number, tileY: number, size = 5): { left: number; top: number } {
  const col = (cell - 1) % BIG_COLUMNS, row = Math.floor((cell - 1) / BIG_COLUMNS);
  return { left: col * BIG_TILE + (tileX * BIG_TILE) / 100 - Math.trunc(size / 2), top: row * BIG_TILE + (tileY * BIG_TILE) / 100 - Math.trunc(size / 2) };
}
/** ShowClanCall: the clan call marker (llamadadeclan, 5 px) and the highlight square (Shape2) of its cell. */
export function clanCallMarker(cell: number, x: number, y: number): { left: number; top: number; squareLeft: number; squareTop: number } {
  const col = (cell - 1) % BIG_COLUMNS, row = Math.floor((cell - 1) / BIG_COLUMNS);
  return { left: col * BIG_TILE + x / 4.5, top: row * BIG_TILE + y / 4.5, squareLeft: col * BIG_TILE, squareTop: row * BIG_TILE };
}
