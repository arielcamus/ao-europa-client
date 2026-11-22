/*
 * Speech bubbles over characters (ChatOverHead), 2026-11-20, from the classic client
 * engine.bas "Start Dialogs" and TileEngine_Chars.bas. Copyright (C) 2022-2026 Noland Studios.
 * AGPL-3.0-or-later; see NOTICE.
 * Drawn as a DOM layer over the map: the bitmap-font renderer is not ported, and the map
 * renderer only draws the player's own body. Positions use the same camera as WorldRenderer.render.
 */
import { bodyHeadOffset, fetchText, parseIni } from './assets.js';
import type { Ini } from './assets.js';
import type { Session } from './session.js';

/** The viewport is 23 by 19 tiles of 32 px (frmMain renderer, 736 by 608). */
const RISE_PX = 17, RISE_MS = 240;
/** engine.bas draws the text 34 px above the body's HeadOffset. */
const ABOVE_HEAD = 34;

/** Where a bubble's bottom-centre goes, relative to the viewport, for a character on tile `tile` with the camera on `camera`. */
export function bubblePlacement(width: number, height: number, camera: { x: number; y: number }, tile: { x: number; y: number }, headOffsetY: number, ageMs: number) {
  const rise = Math.max(0, 1 - ageMs / RISE_MS) * RISE_PX;
  return {
    left: Math.round(width / 2 + (tile.x - camera.x) * 32 - 16 + 14),
    top: Math.round(height / 2 + (tile.y - camera.y) * 32 - 16 + headOffsetY - ABOVE_HEAD + rise),
  };
}

export class ChatBubbles {
  private bubbles = new Map<number, HTMLDivElement>();
  private bodies: Ini | undefined;

  constructor(private readonly layer: HTMLElement) {}
  async init() { this.bodies = parseIni(await fetchText('init/cuerpos.dat')); }

  /** engine.bas uses .Body.HeadOffset.y: the combined head + body offset (CargarCuerpos), not the raw ini HeadOffsetY. */
  private headOffsetY(body: number) { return this.bodies ? bodyHeadOffset(this.bodies, body).y : 0; }

  update(session: Session | undefined, now: number) {
    const visible = session && session.phase === 'playing' ? session.ui.chat.visibleDialogs() : [];
    if (visible.length === 0 && this.bubbles.size === 0) return;
    const position = session?.visualPosition(now);
    const seen = new Set<number>();
    if (session && position) {
      const width = this.layer.clientWidth, height = this.layer.clientHeight;
      for (const { charIndex, dialog, opacity } of visible) {
        // The tracker is the one character store: a walking NPC's bubble slides with it instead of jumping from tile to tile.
        const character = session.tracker.chars.get(charIndex);
        if (!character) continue;
        seen.add(charIndex);
        let bubble = this.bubbles.get(charIndex);
        if (!bubble) {
          bubble = document.createElement('div'); bubble.className = 'chat-bubble'; this.layer.append(bubble); this.bubbles.set(charIndex, bubble);
        }
        if (bubble.dataset.start !== String(dialog.start)) {
          bubble.dataset.start = String(dialog.start);
          bubble.textContent = dialog.text; // text, never HTML
          bubble.style.color = `rgb(${dialog.color[0]}, ${dialog.color[1]}, ${dialog.color[2]})`;
        }
        const self = charIndex === session.charIndex;
        const { left, top } = bubblePlacement(width, height, position, self ? position : session.tracker.visualPosition(character, now), this.headOffsetY(character.body), now - dialog.start);
        bubble.style.transform = `translate(${left}px, ${top}px) translate(-50%, -100%)`;
        bubble.style.opacity = String(opacity);
      }
    }
    for (const [index, bubble] of this.bubbles) if (!seen.has(index)) { bubble.remove(); this.bubbles.delete(index); }
  }
}
