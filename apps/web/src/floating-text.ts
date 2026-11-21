/*
 * TextOverTile / TextCharDrop: floating texts drawn over the viewport, adapted 2026-11-21 from client Protocol.bas HandleTextOverTile,
 * HandleTextCharDrop (AddStackedDialogEffect / SetCharacterDialogFx). Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 */
import type { Session } from './session.js';
import type { WorldRenderer } from './renderer.js';

type Entry = Session['floatingTexts'][number];
/** VB6 colours are BGR Int32 (vbColor). */
export const vbColor = (value: number) => `rgb(${value & 255},${(value >> 8) & 255},${(value >> 16) & 255})`;

export class FloatingTexts {
  private readonly live = new Map<Entry, HTMLDivElement>();
  constructor(private readonly host: HTMLElement) {}
  update(session: Session, renderer: WorldRenderer, now: number) {
    for (const entry of session.floatingTexts) {
      if (this.live.has(entry) || now - entry.at > entry.duration) continue;
      const el = document.createElement('div'); el.className = 'chat-bubble floating-text'; el.textContent = entry.text; el.style.color = vbColor(entry.color);
      this.host.append(el); this.live.set(entry, el);
    }
    for (const [entry, el] of this.live) {
      const age = now - entry.at;
      if (age > entry.duration || !session.floatingTexts.includes(entry)) { el.remove(); this.live.delete(entry); continue; }
      let tile: { x: number; y: number } | undefined;
      if (entry.charIndex !== undefined) {
        const char = session.tracker.chars.get(entry.charIndex);
        tile = char ? session.tracker.visualPosition(char, now) : entry.charIndex === session.charIndex ? session.visualPosition(now) : undefined;
      } else if (entry.x !== undefined && entry.y !== undefined) tile = { x: entry.x, y: entry.y };
      if (!tile) { el.style.display = 'none'; continue; }
      const rise = entry.animated ? (age / entry.duration) * 30 : 0;
      el.style.display = '';
      el.style.transform = `translate(${Math.round(tile.x * 32 + 16 - renderer.camera.x - el.offsetWidth / 2)}px, ${Math.round(tile.y * 32 - renderer.camera.y - 20 - (entry.offsetY || 0) - rise)}px)`;
      el.style.opacity = String(entry.animated ? Math.max(0, 1 - Math.max(0, age / entry.duration - 0.6) / 0.4) : 1);
    }
  }
}
