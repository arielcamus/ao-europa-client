// AGPL-3.0-or-later. Browser keyboard + Pointer Events; no runtime dependencies.
import { Heading } from '@ao/protocol';

const keys: Record<string, Heading> = {
  ArrowUp: Heading.North, KeyW: Heading.North,
  ArrowRight: Heading.East, KeyD: Heading.East,
  ArrowDown: Heading.South, KeyS: Heading.South,
  ArrowLeft: Heading.West, KeyA: Heading.West,
};
export class MovementInput {
  private held = new Map<string, Heading>();
  private drag: { id: number; x: number; y: number } | undefined;
  private readonly abort = new AbortController();
  private readonly buttons: HTMLButtonElement[];
  constructor(game: HTMLElement, pad: HTMLElement, private readonly enabled: () => boolean, private readonly walk: (heading: Heading) => void) {
    const options = { signal: this.abort.signal };
    this.buttons = [...pad.querySelectorAll<HTMLButtonElement>('button[data-heading]')];
    window.addEventListener('keydown', event => {
      if (!this.enabled() || event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]'))) return;
      const heading = keys[event.code];
      if (!heading) return;
      event.preventDefault();
      if (!this.held.has(event.code)) { this.held.set(event.code, heading); this.tick(); }
    }, options);
    window.addEventListener('keyup', event => { this.held.delete(event.code); this.paint(); }, options);
    window.addEventListener('blur', () => this.clear(), options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); }, options);
    for (const button of this.buttons) {
      button.addEventListener('pointerdown', event => {
        if (!this.enabled() || event.button !== 0) return;
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        this.held.set(`pointer${event.pointerId}`, Number(button.dataset.heading));
        this.tick();
      }, options);
      const release = (event: PointerEvent) => { this.held.delete(`pointer${event.pointerId}`); this.paint(); };
      button.addEventListener('pointerup', release, options);
      button.addEventListener('pointercancel', release, options);
      button.addEventListener('lostpointercapture', release, options);
    }
    game.addEventListener('pointerdown', event => {
      if (!this.enabled() || !(event.target instanceof HTMLCanvasElement) || event.button !== 0 || this.drag) return;
      event.preventDefault();
      game.setPointerCapture(event.pointerId);
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }, options);
    game.addEventListener('pointermove', event => {
      if (event.pointerId !== this.drag?.id) return;
      const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) this.held.delete('drag');
      else this.held.set('drag', Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? Heading.East : Heading.West) : (dy > 0 ? Heading.South : Heading.North));
      this.tick();
    }, options);
    const endDrag = (event: PointerEvent) => {
      if (event.pointerId !== this.drag?.id) return;
      this.drag = undefined; this.held.delete('drag'); this.paint();
    };
    game.addEventListener('pointerup', endDrag, options);
    game.addEventListener('pointercancel', endDrag, options);
    game.addEventListener('lostpointercapture', endDrag, options);
    game.addEventListener('contextmenu', event => event.preventDefault(), options);
  }
  tick(): void {
    if (!this.enabled()) { this.clear(); return; }
    const heading = [...this.held.values()].at(-1);
    if (heading !== undefined) this.walk(heading);
    this.paint();
  }
  private paint(): void {
    const heading = [...this.held.values()].at(-1);
    for (const button of this.buttons) button.classList.toggle('pressed', Number(button.dataset.heading) === heading);
  }
  clear(): void { this.held.clear(); this.drag = undefined; this.paint(); }
  destroy(): void { this.clear(); this.abort.abort(); }
}
