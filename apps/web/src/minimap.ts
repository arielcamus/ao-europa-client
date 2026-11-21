/*
 * frmMain.MiniMap, classic client. Two modes, as ModMinimap.bas / frmMain.SetMinimapPosition:
 *  - CenteredMinimap = 1 (the VB6 default): the DirectX minimap, a 100 px crop of the world picture centred on the player and zoomed
 *    with the two zoom buttons (CenteredMinimapZoom -50..50); the player and the party allies are 6 px squares.
 *  - CenteredMinimap = 0: one precomputed 100x100 picture per map (General.LoadMinimap); the player dot is frmMain.personaje(0) placed by
 *    SetMinimapPosition / ConvertToMinimapPosition: the picture shows only the playable area, with the viewport-sized border tiles cut,
 *    so tile -> pixel is a stretch, not 1:1.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 */
import type { Session } from './session.js';
import { DOT_COLORS, DOT_SQUARE, MINIMAP_SIZE, cellDraws, centeredDot, centeredView, findMap } from './world-map.js';
import type { World } from './world-map.js';

/** TileEngine: HalfWindowTileWidth/Height = (736/32)\2 and (608/32)\2. */
const HALF_W = 11, HALF_H = 9;
/** frmMain.personaje(0): a 75-twip (5px) circle, white border, dark red RGB(192,0,0) (frmMain.frm:401-412). */
export const PLAYER_DOT = 5;

/**
 * Top-left of a dot inside the 100x100 minimap, in pixels (SetMinimapPosition, mode 0). VB6 assigns the Single result to Shape.Left/Top
 * as it is, so the value is NOT rounded here: the browser snaps the box to a device pixel when it paints, like the shape control does.
 */
export function minimapDotPosition(tileX: number, tileY: number, size = PLAYER_DOT): { left: number; top: number } {
  return {
    left: (tileX - HALF_W - 2) * (100 / (100 - 2 * HALF_W - 4)) - Math.floor(size / 2) - 1,
    top: (tileY - HALF_H - 1) * (100 / (100 - 2 * HALF_H - 2)) - Math.floor(size / 2) - 1,
  };
}

/** frmMain.MiniMap_MouseDown -> GetMinimapPosition: minimap pixel to map tile (used by the big map and /TELEP). Used by BOTH modes in VB6. */
export function minimapTile(px: number, py: number): { x: number; y: number } {
  return { x: px * (100 - 2 * HALF_W - 4) / 100 + HALF_W + 2, y: py * (100 - 2 * HALF_H - 4) / 100 + HALF_H + 2 };
}
/** VB6 CByte: round half to even. */
export const cByte = (v: number) => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };

export const minimapUrl = (resourceMap: number) => `/ao-assets/Minimapas/mapa${resourceMap}.bmp`;

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
  /** Per-map pictures for the centred composite; `undefined` while loading or missing. */
  private readonly pictures = new Map<number, HTMLImageElement | 'missing'>();
  private drawn = '';
  worlds: readonly World[] = [];
  options: MinimapOptions = { centered: true, zoom: 0 };
  hooks: MinimapHooks | undefined;
  /** Test hook: the last frame's decisions. */
  last: { mode: 'centered' | 'map'; dot: { x: number; y: number } | undefined; allies: ({ x: number; y: number } | undefined)[]; map: number } | undefined;

  constructor(private readonly host: HTMLElement) {
    this.dot = host.querySelector<HTMLElement>('#minimap-dot')!;
    this.canvas = document.createElement('canvas'); this.canvas.width = MINIMAP_SIZE; this.canvas.height = MINIMAP_SIZE; this.canvas.id = 'minimap-canvas';
    this.canvas.hidden = true; host.prepend(this.canvas);
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
    image.onload = () => { this.drawn = ''; }; image.onerror = () => { this.pictures.set(map, 'missing'); };
    image.src = minimapUrl(map); this.pictures.set(map, image);
    return undefined;
  }

  /** `allies`: slot 1..5 -> tile on the player's map (WorldFx.allies). */
  update(session: Session | undefined, playing: boolean, allies: ReadonlyMap<number, { x: number; y: number }> = new Map()) {
    const map = playing && session ? (session.map ?? session.resourceMap ?? 0) : 0;
    this.map = map;
    const position = session?.position;
    const centered = this.options.centered;
    this.canvas.hidden = !(centered && playing); this.host.dataset.minimapMode = centered ? 'centered' : 'map';
    if (!centered) { this.updatePicture(session, playing, position, allies); return; }
    // The per-map picture is not shown in the centred mode (DibujarMiniMapa only loads it for CenteredMinimap = 0).
    if (this.shownMap !== -2) { this.shownMap = -2; this.host.style.backgroundImage = ''; }
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

  private updatePicture(session: Session | undefined, playing: boolean, position: { x: number; y: number } | undefined, allies: ReadonlyMap<number, { x: number; y: number }>) {
    const map = playing && session ? (session.resourceMap ?? 0) : 0;
    if (map !== this.shownMap) {
      this.shownMap = map;
      this.host.style.backgroundImage = map > 0 ? `url("${minimapUrl(map)}")` : '';
      this.host.dataset.minimapMap = String(map);
    }
    this.dot.hidden = !playing || !position;
    let dot: { x: number; y: number } | undefined;
    if (playing && position) {
      const { left, top } = minimapDotPosition(position.x, position.y);
      this.dot.style.left = `${left}px`; this.dot.style.top = `${top}px`; dot = { x: left, y: top };
    }
    const shown: ({ x: number; y: number } | undefined)[] = [];
    this.allyDots.forEach((el, i) => {
      const ally = allies.get(i + 1);
      el.hidden = !playing || !ally;
      if (playing && ally) { const { left, top } = minimapDotPosition(ally.x, ally.y); el.style.left = `${left}px`; el.style.top = `${top}px`; shown.push({ x: left, y: top }); } else shown.push(undefined);
    });
    this.last = { mode: 'map', dot, allies: shown, map };
  }
}
