/*
 * Sign (cartel) drawn by HandleShowSignal -> InitCartel, 2026-11-21, from client Carteles.bas and TileEngine_RenderScreen.bas
 * (Draw_Grh at clicX, clicY with the text at clicX - 100, clicY - 130, white at alpha 220). The server sends the object whose Texto to
 * read and the sign's secondary Grh. One sign at a time; a click on the map or a step removes it. Copyright (C) 2022-2026 Noland Studios.
 * AGPL-3.0-or-later; see NOTICE. Art is read only from the local mount.
 */
import { grhCanvas } from './grh-canvas.js';
import type { Session } from './session.js';
import type { WorldRenderer } from './renderer.js';

export class SignOverlay {
  private readonly root: HTMLElement;
  private shown: { text: string; grh: number } | undefined;
  private generation = 0;
  constructor(parent: HTMLElement, private readonly renderer: WorldRenderer) {
    this.root = document.createElement('div');
    this.root.id = 'sign-cartel'; this.root.hidden = true; this.root.setAttribute('role', 'note');
    parent.append(this.root);
  }
  get visible() { return !this.root.hidden; }
  /** frmMain MouseUp: clicX / clicY in viewport pixels. */
  anchor(session: Session, clientX: number, clientY: number, rect: DOMRect) {
    const sx = this.renderer.app.screen.width / (rect.width || 1), sy = this.renderer.app.screen.height / (rect.height || 1);
    session.signAnchor = { x: Math.round((clientX - rect.left) * sx), y: Math.round((clientY - rect.top) * sy) };
  }
  update(session: Session | undefined) {
    const sign = session?.sign;
    if (!session || !sign) { if (this.shown) this.hide(); return; }
    if (this.shown === sign) return;
    this.shown = sign;
    const generation = ++this.generation;
    const { x, y } = session.signAnchor;
    void grhCanvas(this.renderer, sign.grh).catch(() => undefined).then(canvas => {
      if (generation !== this.generation) return;
      const text = document.createElement('div'); text.className = 'sign-text'; text.textContent = sign.text;
      text.style.left = `${x - 100}px`; text.style.top = `${y - 130}px`;
      const art = canvas ?? document.createElement('canvas'); art.className = 'sign-art';
      art.style.left = `${x}px`; art.style.top = `${y}px`;
      this.root.replaceChildren(art, text); this.root.hidden = false;
    });
  }
  hide() { this.generation++; this.shown = undefined; this.root.hidden = true; this.root.replaceChildren(); }
}
