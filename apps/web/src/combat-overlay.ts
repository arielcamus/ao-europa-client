/*
 * Floating combat text, adapted from engine.bas Char_TextRender
 * (DialogEffects: 1300 ms life, rises 0.025 px/ms, fades after 900 ms). Hit FX (blood) are drawn by the
 * spells FX renderer in the canvas (renderer.drawEffects). Copyright (C) 2022-2026 Noland Studios.
 * AGPL-3.0-or-later; no warranty. Artwork is read only from the local mount.
 */
import { TEXT_LIFE_MS } from './combat.js';
import type { FloatingText } from './combat.js';
import type { WorldRenderer } from './renderer.js';
import type { Session } from './session.js';

export class CombatOverlay {
  private layer = document.createElement('div');
  private texts = new Map<FloatingText, HTMLDivElement>();

  constructor(host: HTMLElement, private readonly renderer: WorldRenderer) {
    Object.assign(this.layer.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '5' });
    this.layer.id = 'combat-layer';
    host.append(this.layer);
  }
  private tile(session: Session, charIndex: number, now: number) {
    if (charIndex === session.charIndex) return session.visualPosition(now);
    const character = session.characters.get(charIndex);
    return character ? { x: character.x, y: character.y } : undefined;
  }
  update(session: Session | undefined, now: number) {
    if (!session || session.phase !== 'playing') { this.layer.replaceChildren(); this.texts.clear(); return; }
    const combat = session.combat, camera = this.renderer.camera;
    combat.prune(now);
    for (const item of combat.floating) this.drawText(session, item, now, camera);
    for (const [item, node] of this.texts) if (!combat.floating.includes(item)) { node.remove(); this.texts.delete(item); }
  }
  private drawText(session: Session, item: FloatingText, now: number, camera: { x: number; y: number }) {
    const tile = this.tile(session, item.charIndex, now);
    let node = this.texts.get(item);
    if (!node) {
      node = document.createElement('div'); node.className = 'combat-text'; node.textContent = item.text;
      Object.assign(node.style, {
        position: 'absolute', transform: 'translateX(-50%)', whiteSpace: 'nowrap', font: 'bold 13px Verdana, Arial, sans-serif',
        color: item.color, textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000',
      });
      this.layer.append(node); this.texts.set(item, node);
    }
    if (!tile) { node.style.display = 'none'; return; }
    const age = now - item.start;
    node.style.display = '';
    node.style.opacity = String(age > 900 ? Math.max(0, (TEXT_LIFE_MS - age) * 0.0025) : 1);
    node.style.left = `${tile.x * 32 + 16 - camera.x}px`;
    node.style.top = `${tile.y * 32 - 28 - age * 0.025 + item.slide - camera.y}px`;
  }
}
