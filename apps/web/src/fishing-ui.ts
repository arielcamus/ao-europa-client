/*
 * Draws the special-fish bar over the game area (RenderScreen: bar graphic at 239,550, marker at 271 + position, 558, one circle per try at
 * 394 + 10 * n, 573). The fight itself lives in fishing.ts. AGPL-3.0-or-later; see NOTICE. Art is read only from the local mount.
 */
import { FISH_GRH, FISH_LAYOUT } from './fishing.js';
import { grhCanvas } from './grh-canvas.js';
import type { WorldRenderer } from './renderer.js';
import type { Session } from './session.js';

export class FishingUI {
  private readonly layer = document.createElement('div');
  private readonly marker = document.createElement('div');
  private readonly circles: HTMLElement[] = [];
  private readonly art = new Map<number, Promise<HTMLCanvasElement>>();
  private last = 0;

  constructor(host: HTMLElement, private readonly renderer: WorldRenderer) {
    this.layer.id = 'fishing-bar'; this.layer.hidden = true;
    Object.assign(this.layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '5' });
    this.marker.id = 'fishing-marker';
    this.place(this.marker, FISH_LAYOUT.cursorX, FISH_LAYOUT.cursorY, FISH_GRH.cursor);
    const bar = document.createElement('div'); bar.id = 'fishing-track'; this.place(bar, FISH_LAYOUT.barX, FISH_LAYOUT.barY, FISH_GRH.bar);
    this.layer.append(bar, this.marker);
    for (let i = 1; i <= 5; i++) {
      const circle = document.createElement('div'); circle.className = 'fishing-circle'; circle.hidden = true;
      Object.assign(circle.style, { position: 'absolute', left: `${FISH_LAYOUT.circleX + i * FISH_LAYOUT.circleStep}px`, top: `${FISH_LAYOUT.circleY}px` });
      this.circles.push(circle); this.layer.append(circle);
    }
    host.append(this.layer);
  }
  private place(node: HTMLElement, x: number, y: number, grh: number) {
    Object.assign(node.style, { position: 'absolute', left: `${x}px`, top: `${y}px` });
    void this.canvas(grh).then(canvas => { const copy = canvas.cloneNode() as HTMLCanvasElement; copy.getContext('2d')!.drawImage(canvas, 0, 0); node.replaceChildren(copy); }).catch(() => { /* no art, no bar */ });
  }
  private canvas(grh: number) {
    let pending = this.art.get(grh);
    if (!pending) { pending = grhCanvas(this.renderer, grh); this.art.set(grh, pending); }
    return pending;
  }

  /** Runs the fight one frame and shows it; call once per UI frame. */
  update(session: Session | undefined, now: number) {
    const fishing = session?.craftingState.fishing;
    const elapsed = this.last ? Math.min(100, now - this.last) : 0; this.last = now;
    this.layer.hidden = !session || !fishing?.active;
    if (!session || !fishing?.active) return;
    session.crafting.tickFishing(elapsed);
    if (!fishing.active) { this.layer.hidden = true; return; }
    this.marker.style.left = `${FISH_LAYOUT.cursorX + Math.round(fishing.position)}px`;
    this.circles.forEach((circle, i) => {
      const result = fishing.attempts[i + 1];
      circle.hidden = result === 0;
      if (result && circle.dataset.result !== String(result)) {
        circle.dataset.result = String(result);
        void this.canvas(result === 1 ? FISH_GRH.hit : FISH_GRH.miss).then(canvas => { const copy = canvas.cloneNode() as HTMLCanvasElement; copy.getContext('2d')!.drawImage(canvas, 0, 0); circle.replaceChildren(copy); }).catch(() => {});
      }
    });
  }
}
