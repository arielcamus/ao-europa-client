/*
 * frmMain.MiniMap, classic client (CenteredMinimap = 0 mode: one precomputed 100x100 picture per map).
 * ResourceMap picks Recursos/Minimapas/mapa<N>.bmp (General.LoadMinimap); the player dot is frmMain.personaje(0)
 * placed by SetMinimapPosition / ConvertToMinimapPosition: the 100px picture shows only the playable area, with the
 * viewport-sized border tiles cut, so tile -> pixel is a stretch, not 1:1.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 */
import type { Session } from './session.js';

/** TileEngine: HalfWindowTileWidth/Height = (736/32)\2 and (608/32)\2. */
const HALF_W = 11, HALF_H = 9;
/** frmMain.personaje(0): a 75-twip (5px) circle, white border, dark red RGB(192,0,0) (frmMain.frm:401-412). */
export const PLAYER_DOT = 5;

/** Top-left of the player dot inside the 100x100 minimap, in pixels (SetMinimapPosition, mode 0). */
export function minimapDotPosition(tileX: number, tileY: number, size = PLAYER_DOT): { left: number; top: number } {
  const left = (tileX - HALF_W - 2) * (100 / (100 - 2 * HALF_W - 4)) - Math.floor(size / 2) - 1;
  const top = (tileY - HALF_H - 1) * (100 / (100 - 2 * HALF_H - 2)) - Math.floor(size / 2) - 1;
  return { left: Math.round(left), top: Math.round(top) };
}

/** frmMain.MiniMap_MouseDown -> GetMinimapPosition: minimap pixel to map tile (used by the big map and /TELEP). */
export function minimapTile(px: number, py: number): { x: number; y: number } {
  return { x: px * (100 - 2 * HALF_W - 4) / 100 + HALF_W + 2, y: py * (100 - 2 * HALF_H - 4) / 100 + HALF_H + 2 };
}

export const minimapUrl = (resourceMap: number) => `/ao-assets/Minimapas/mapa${resourceMap}.bmp`;

export class Minimap {
  private shownMap = -1;
  private readonly dot: HTMLElement;
  constructor(private readonly host: HTMLElement) {
    this.dot = host.querySelector<HTMLElement>('#minimap-dot')!;
  }
  update(session: Session | undefined, playing: boolean) {
    const map = playing && session ? (session.resourceMap ?? 0) : 0;
    if (map !== this.shownMap) {
      this.shownMap = map;
      this.host.style.backgroundImage = map > 0 ? `url("${minimapUrl(map)}")` : '';
      this.host.dataset.minimapMap = String(map);
    }
    const position = session?.position;
    this.dot.hidden = !playing || !position;
    if (playing && position) {
      const { left, top } = minimapDotPosition(position.x, position.y);
      this.dot.style.left = `${left}px`; this.dot.style.top = `${top}px`;
    }
  }
}
