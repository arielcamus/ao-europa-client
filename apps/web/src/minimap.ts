/*
 * frmMain.MiniMap, classic client. Two modes, as ModMinimap.bas / frmMain.SetMinimapPosition:
 *  - CenteredMinimap = 1 (the VB6 default): the DirectX minimap, a 100 px crop of the world picture centred on the player and zoomed
 *    with the two zoom buttons (CenteredMinimapZoom -50..50); the player and the party allies are 6 px squares.
 *  - CenteredMinimap = 0 (the default here, see options-settings.ts): one precomputed 100x100 picture per map (General.LoadMinimap) shown
 *    whole in the 100x100 px control; the player dot is frmMain.personaje(0) placed by SetMinimapPosition / ConvertToMinimapPosition: the
 *    picture shows only the playable area, with the viewport-sized border tiles cut, so tile -> pixel is a stretch, not 1:1.
 *    The picture and the quest markers are painted into one canvas at a whole multiple of the device pixels, nearest neighbour, so the
 *    pixel art stays sharp under the classic window scale and devicePixelRatio.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 */
import type { Session } from './session.js';
import { DOT_COLORS, DOT_SQUARE, MINIMAP_SIZE, cellDraws, centeredDot, centeredView, findMap } from './world-map.js';
import type { World } from './world-map.js';
import { assetUrl } from './assets.js';

/** TileEngine: HalfWindowTileWidth/Height = (736/32)\2 and (608/32)\2. */
const HALF_W = 11, HALF_H = 9;
/** frmMain.personaje(0): a 75-twip (5px) circle, white border, dark red RGB(192,0,0) (frmMain.frm:401-412). */
export const PLAYER_DOT = 5;
/** frmMain.personaje(1..5), the party allies: 150 x 60 twips (10 x 4 px) boxes with Shape = 3 (Circle), so a 4 px circle centred in the box. */
export const ALLY_BOX = { width: 10, height: 4 } as const;

/**
 * Top-left of a dot inside the 100x100 minimap, in pixels (SetMinimapPosition, mode 0), the Single VB6 computes:
 * `(x - HalfWindowTileWidth - 2) * (100 / (100 - 2 * HalfWindowTileWidth - 4)) - Width \ 2 - 1`, and the same for y with the height.
 */
export function minimapDotPosition(tileX: number, tileY: number, width = PLAYER_DOT, height = width): { left: number; top: number } {
  return {
    left: (tileX - HALF_W - 2) * (100 / (100 - 2 * HALF_W - 4)) - Math.floor(width / 2) - 1,
    top: (tileY - HALF_H - 1) * (100 / (100 - 2 * HALF_H - 2)) - Math.floor(height / 2) - 1,
  };
}
/**
 * The whole minimap pixel the dot box starts at: the picture box is ScaleMode = 3 (pixels) and a Shape paints on whole pixels, so the
 * Single above lands on its nearest pixel (VB6 keeps it in twips; at an exact .5 the rounding direction is within 1 twip).
 */
export function minimapDotPixel(tileX: number, tileY: number, width = PLAYER_DOT, height = width): { left: number; top: number } {
  const { left, top } = minimapDotPosition(tileX, tileY, width, height);
  return { left: Math.round(left), top: Math.round(top) };
}

/** frmMain.MiniMap_MouseDown -> GetMinimapPosition: minimap pixel to map tile (used by the big map and /TELEP). Used by BOTH modes in VB6. */
export function minimapTile(px: number, py: number): { x: number; y: number } {
  return { x: px * (100 - 2 * HALF_W - 4) / 100 + HALF_W + 2, y: py * (100 - 2 * HALF_H - 4) / 100 + HALF_H + 2 };
}
/** VB6 CByte: round half to even. */
export const cByte = (v: number) => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };

export const minimapUrl = (resourceMap: number) => assetUrl(`Minimapas/mapa${resourceMap}.bmp`);

/** One NPC marker of ListNPCMapData (Recursos.CargarNPCsMapData): the position is already ConvertToMinimapPosition(x, y, 2, 0), a minimap pixel. */
export interface QuestDot { x: number; y: number; state: number }
const clongHalfEven = (v: number) => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };
/**
 * OUTPUT/QuestNPCsMapData.bin: repeated `Integer map` (when > 0: 100 slots of NPCNumber, x, y, state, all Integer), a map <= 0 is a bare 2-byte filler.
 * Slots with NPCNumber = 0 are skipped: the pinned loop paints them too, but their (0, 0) converts to a negative pixel, off the picture.
 */
export function parseQuestNpcDots(bytes: Uint8Array): Map<number, QuestDot[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = new Map<number, QuestDot[]>();
  for (let at = 0; at + 2 <= bytes.length;) {
    const map = view.getInt16(at, true); at += 2;
    if (map <= 0) continue;
    if (at + 800 > bytes.length) break;
    const dots: QuestDot[] = [];
    for (let slot = 0; slot < 100; slot++, at += 8) {
      if (view.getInt16(at, true) <= 0) continue;
      // ConvertToMinimapPosition(x, y, MarkerWidth 2, MarkerHeight 0); the Single goes into an Integer field, then a Long: round half to even.
      dots.push({ x: clongHalfEven((view.getInt16(at + 2, true) - HALF_W - 2) * (100 / (100 - 2 * HALF_W - 4)) - 1 - 1), y: clongHalfEven((view.getInt16(at + 4, true) - HALF_H - 1) * (100 / (100 - 2 * HALF_H - 2)) - 0 - 1), state: view.getInt16(at + 6, true) });
    }
    out.set(map, dots);
  }
  return out;
}
const QUEST_GREY = '#808080', QUEST_CYAN = 'rgb(0,198,254)', QUEST_YELLOW = 'rgb(255,201,14)';
/** ModMinimap.DibujarMiniMapa: a 2x2 square (cyan for state 1, yellow otherwise) with a 8-pixel grey outline, as `[x, y, colour]` pixels. */
export function questDotPixels(dot: QuestDot): [number, number, string][] {
  const colour = dot.state === 1 ? QUEST_CYAN : QUEST_YELLOW, { x, y } = dot;
  return [[x + 1, y, colour], [x, y + 1, colour], [x + 1, y + 1, colour], [x, y, colour],
    [x, y - 1, QUEST_GREY], [x + 1, y - 1, QUEST_GREY], [x + 2, y, QUEST_GREY], [x + 2, y + 1, QUEST_GREY], [x + 1, y + 2, QUEST_GREY], [x, y + 2, QUEST_GREY], [x - 1, y + 1, QUEST_GREY], [x - 1, y, QUEST_GREY]];
}

export interface MinimapOptions { centered: boolean; zoom: number }
export interface MinimapHooks {
  /** Left click (MiniMap_MouseDown): open the big map. */
  openBigMap: () => void;
  /** Right click: `/TELEP YO <map> <x> <y>`. */
  teleport: (map: number, x: number, y: number) => void;
}

export class Minimap {
  private shownMap = -1;
  private readonly dot: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly allyDots: HTMLElement[] = [];
  /** CenteredMinimap = 0: the per-map picture plus the quest NPC markers (DibujarMiniMapa paints them straight onto MiniMap.Picture). */
  private readonly sheet: HTMLCanvasElement;
  /** ListNPCMapData; filled by main once OUTPUT/QuestNPCsMapData.bin is read (optional data). */
  questDots: ReadonlyMap<number, QuestDot[]> = new Map();
  private sheetDrawn = '';
  /** Per-map pictures for the centred composite; `undefined` while loading or missing. */
  private readonly pictures = new Map<number, HTMLImageElement | 'missing'>();
  private drawn = '';
  worlds: readonly World[] = [];
  options: MinimapOptions = { centered: false, zoom: 0 };
  hooks: MinimapHooks | undefined;
  /** Test hook: the last frame's decisions. */
  last: { mode: 'centered' | 'map'; dot: { x: number; y: number } | undefined; allies: ({ x: number; y: number } | undefined)[]; map: number } | undefined;

  constructor(private readonly host: HTMLElement) {
    this.dot = host.querySelector<HTMLElement>('#minimap-dot')!;
    this.canvas = document.createElement('canvas'); this.canvas.width = MINIMAP_SIZE; this.canvas.height = MINIMAP_SIZE; this.canvas.id = 'minimap-canvas';
    this.canvas.hidden = true; host.prepend(this.canvas);
    this.sheet = document.createElement('canvas'); this.sheet.width = MINIMAP_SIZE; this.sheet.height = MINIMAP_SIZE; this.sheet.id = 'minimap-map';
    this.sheet.hidden = true; host.prepend(this.sheet);
    for (let slot = 1; slot <= 5; slot++) {
      const el = document.createElement('span'); el.className = 'dot ally'; el.hidden = true; el.dataset.slot = String(slot);
      el.style.background = DOT_COLORS[slot]!; host.append(el); this.allyDots.push(el);
    }
    host.addEventListener('pointerdown', event => {
      const rect = host.getBoundingClientRect();
      const px = (event.clientX - rect.left) * (MINIMAP_SIZE / rect.width), py = (event.clientY - rect.top) * (MINIMAP_SIZE / rect.height);
      if (event.button === 2) { event.preventDefault(); this.rightClick(px, py); } else if (event.button === 0) this.hooks?.openBigMap();
    });
    host.addEventListener('contextmenu', event => event.preventDefault());
    globalThis.addEventListener?.('resize', () => { this.densityCache = undefined; });
  }
  private map = 0;
  private rightClick(px: number, py: number) {
    const tile = minimapTile(px, py);
    this.hooks?.teleport(this.map, cByte(tile.x), cByte(tile.y));
  }

  private picture(map: number): HTMLImageElement | undefined {
    const known = this.pictures.get(map);
    if (known === 'missing') return undefined;
    if (known) return known.complete && known.naturalWidth > 0 ? known : undefined;
    const image = new Image();
    image.onload = () => { this.drawn = ''; this.sheetDrawn = ''; }; image.onerror = () => { this.pictures.set(map, 'missing'); };
    image.src = minimapUrl(map); this.pictures.set(map, image);
    return undefined;
  }

  /** `allies`: slot 1..5 -> tile on the player's map (WorldFx.allies). */
  update(session: Session | undefined, playing: boolean, allies: ReadonlyMap<number, { x: number; y: number }> = new Map()) {
    const map = playing && session ? (session.map ?? session.resourceMap ?? 0) : 0;
    this.map = map;
    const position = session?.position;
    const centered = this.options.centered;
    this.canvas.hidden = !(centered && playing); if (centered) this.sheet.hidden = true; this.host.dataset.minimapMode = centered ? 'centered' : 'map';
    if (!centered) { this.updatePicture(session, playing, position, allies); return; }
    // The per-map picture is not shown in the centred mode (DibujarMiniMapa only loads it for CenteredMinimap = 0).
    this.shownMap = -2;
    this.dot.hidden = true; for (const el of this.allyDots) el.hidden = true;
    if (!playing || !position || map <= 0) { this.last = undefined; this.drawn = ''; return; }
    const at = findMap(this.worlds as World[], map);
    if (!at) { this.paintBlank(); this.last = { mode: 'centered', dot: undefined, allies: [], map }; return; } // idmap = 0: RenderMinimapCentered exits, nothing is drawn
    const world = this.worlds[at.world - 1]!;
    const view = centeredView(world, at.cell, position.x, position.y, this.options.zoom);
    const draws = cellDraws(world, view);
    const ready = draws.map(d => d.map > 0 && this.picture(d.map) !== undefined ? d.map : 0).join(',');
    const dots = [centeredDot(view, 0, position.x, position.y), ...[1, 2, 3, 4, 5].map(slot => { const a = allies.get(slot); return a ? centeredDot(view, slot, a.x, a.y) : undefined; })];
    const key = `${map}|${view.srcX},${view.srcY},${view.srcW}|${ready}|${dots.map(d => d ? `${d.x}:${d.y}` : '-').join(';')}`;
    this.last = { mode: 'centered', dot: dots[0], allies: dots.slice(1), map };
    if (key === this.drawn) return;
    this.drawn = key;
    const ctx = this.canvas.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    for (const d of draws) {
      const image = d.map > 0 ? this.picture(d.map) : undefined;
      if (image) ctx.drawImage(image, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
    }
    // RenderMinimapDots: slot 0 (the player) first, then the allies, 6 px squares.
    dots.forEach((dot, slot) => { if (!dot) return; ctx.fillStyle = DOT_COLORS[slot]!; ctx.fillRect(dot.x - Math.trunc(DOT_SQUARE / 2), dot.y - Math.trunc(DOT_SQUARE / 2), DOT_SQUARE, DOT_SQUARE); });
  }
  private paintBlank() {
    const ctx = this.canvas.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE); this.drawn = '';
  }

  /**
   * Device pixels per minimap pixel: the control is 100 CSS px inside the scaled classic window, so its on-screen width times devicePixelRatio,
   * rounded UP to a whole number; the canvas backing store is that many pixels per picture pixel, filled nearest neighbour.
   */
  private density(): number {
    // Measured once and kept until the window resizes (the classic window's scale and devicePixelRatio only change then): reading the
    // bounding box every frame forced a layout per frame. A measure taken before layout (width 0) is not kept.
    if (this.densityCache !== undefined) return this.densityCache;
    const width = this.host.getBoundingClientRect().width, css = this.host.offsetWidth || MINIMAP_SIZE;
    const ratio = (width > 0 ? width / css : 1) * (globalThis.devicePixelRatio || 1);
    const k = Math.max(1, Math.min(8, Math.ceil(ratio - 1e-6)));
    if (width > 0) this.densityCache = k;
    return k;
  }
  private densityCache: number | undefined;

  /** LoadMinimap(ResourceMap) into MiniMap.Picture, then DibujarMiniMapa's SetPixel markers, at `density()` device pixels per pixel. */
  private paintSheet(map: number) {
    const image = map > 0 ? this.picture(map) : undefined;
    const dots = map > 0 ? this.questDots.get(map) ?? [] : [];
    const k = this.density();
    const key = `${map}|${k}|${image ? 1 : 0}|${dots.length}`;
    if (key === this.sheetDrawn) return;
    this.sheetDrawn = key;
    const size = MINIMAP_SIZE * k;
    if (this.sheet.width !== size) { this.sheet.width = size; this.sheet.height = size; }
    this.sheet.dataset.density = String(k);
    const ctx = this.sheet.getContext('2d'); if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size); // MiniMap.BackColor = &H00000000&
    if (image) ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, 0, 0, size, size);
    for (const dot of dots) for (const [x, y, colour] of questDotPixels(dot)) { ctx.fillStyle = colour; ctx.fillRect(x * k, y * k, k, k); }
  }

  private updatePicture(session: Session | undefined, playing: boolean, position: { x: number; y: number } | undefined, allies: ReadonlyMap<number, { x: number; y: number }>) {
    const map = playing && session ? (session.resourceMap ?? 0) : 0;
    if (map !== this.shownMap) { this.shownMap = map; this.host.dataset.minimapMap = String(map); }
    this.sheet.hidden = !playing || map <= 0;
    if (!this.sheet.hidden) this.paintSheet(map);
    this.dot.hidden = !playing || !position;
    let dot: { x: number; y: number } | undefined;
    if (playing && position) {
      const { left, top } = minimapDotPixel(position.x, position.y);
      this.dot.style.left = `${left}px`; this.dot.style.top = `${top}px`; dot = { x: left, y: top };
    }
    const shown: ({ x: number; y: number } | undefined)[] = [];
    this.allyDots.forEach((el, i) => {
      const ally = allies.get(i + 1);
      el.hidden = !playing || !ally;
      if (playing && ally) {
        // The 4 px circle sits in the middle of its 10 x 4 box: (10 - 4) / 2 = 3 px in from the box's left.
        const { left, top } = minimapDotPixel(ally.x, ally.y, ALLY_BOX.width, ALLY_BOX.height);
        el.style.left = `${left + (ALLY_BOX.width - ALLY_BOX.height) / 2}px`; el.style.top = `${top}px`; shown.push({ x: left, y: top });
      } else shown.push(undefined);
    });
    this.last = { mode: 'map', dot, allies: shown, map };
  }
}
