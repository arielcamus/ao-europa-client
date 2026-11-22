// AGPL-3.0-or-later. See ../../../LICENSE.
/*
 * What the bug reporter records while the game runs (docs/BUG-REPORTS.md): the last browser console lines, the page's errors
 * (window error / unhandledrejection, and the client's own error line), and the last protocol events (packet ids and times only).
 * Installed once at page load, before the first session, so a report made right after a crash still has the lead-up.
 */
import { LIMITS, Ring, consoleText } from './bug-report-data.js';
import type { ConsoleEntry, ErrorEntry, ScreenshotInfo, TraceDirection, TraceEvent } from './bug-report-data.js';

export class Diagnostics {
  readonly console = new Ring<ConsoleEntry>(LIMITS.console);
  readonly errors = new Ring<ErrorEntry>(LIMITS.errors);
  readonly protocol = new Ring<TraceEvent>(LIMITS.protocol);
  private installed = false;
  constructor(private readonly clock: () => number = () => performance.now()) {}

  /** One protocol event (Session.onTrace): no payload, ever. */
  trace(dir: TraceDirection, id: number) { this.protocol.push({ t: this.clock(), dir, id }); }
  /** The client's own error line (main.ts report()). */
  error(message: string) { this.errors.push({ t: this.clock(), kind: 'report', message }); }

  install(target: Window & typeof globalThis = window) {
    if (this.installed) return;
    this.installed = true;
    const sink = target.console as unknown as Record<string, (...args: unknown[]) => void>;
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
      const original = sink[level];
      if (typeof original !== 'function') continue;
      sink[level] = (...args: unknown[]) => {
        try { this.console.push({ t: this.clock(), level, text: consoleText(args).slice(0, LIMITS.line * 2) }); } catch { /* never break logging */ }
        original.apply(target.console, args);
      };
    }
    target.addEventListener('error', event => {
      const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : '';
      const stack = event.error instanceof Error ? event.error.stack : undefined;
      this.errors.push({ t: this.clock(), kind: 'error', message: `${event.message}${where}`, ...(stack ? { stack } : {}) });
    });
    target.addEventListener('unhandledrejection', event => {
      const reason: unknown = event.reason;
      const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : consoleText([reason]);
      this.errors.push({ t: this.clock(), kind: 'rejection', message, ...(reason instanceof Error && reason.stack ? { stack: reason.stack } : {}) });
    });
  }
}

/** The JPEG fallback starts here; PNG above this many bytes is re-encoded. The server accepts up to 1.5 MB decoded. */
export const SCREENSHOT_BUDGET = 900 * 1024;
const MAX_WIDTH = 1280;

const dataUrlBytes = (url: string) => Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4);

/**
 * A picture of the game canvas, at most MAX_WIDTH wide: PNG when it fits the budget, else JPEG at falling quality and size.
 * `render` must draw a frame right before the read: a WebGL canvas without preserveDrawingBuffer is blank once the frame is composited,
 * so the draw and toDataURL happen in the same task.
 */
export function captureCanvas(canvas: HTMLCanvasElement, render: () => void): ScreenshotInfo | undefined {
  try {
    render();
    let width = canvas.width, height = canvas.height;
    if (!width || !height) return undefined;
    const scale = Math.min(1, MAX_WIDTH / width);
    width = Math.round(width * scale); height = Math.round(height * scale);
    const copy = document.createElement('canvas');
    copy.width = width; copy.height = height;
    const context = copy.getContext('2d');
    if (!context) return undefined;
    context.imageSmoothingEnabled = scale < 1;
    context.drawImage(canvas, 0, 0, width, height);
    let dataUrl = copy.toDataURL('image/png');
    if (dataUrlBytes(dataUrl) <= SCREENSHOT_BUDGET) return { dataUrl, width, height, type: 'image/png', bytes: dataUrlBytes(dataUrl) };
    for (const [quality, shrink] of [[0.85, 1], [0.7, 1], [0.7, 0.66], [0.6, 0.5]] as const) {
      let target = copy;
      if (shrink < 1) {
        target = document.createElement('canvas');
        target.width = Math.round(width * shrink); target.height = Math.round(height * shrink);
        target.getContext('2d')?.drawImage(copy, 0, 0, target.width, target.height);
      }
      dataUrl = target.toDataURL('image/jpeg', quality);
      if (dataUrlBytes(dataUrl) <= SCREENSHOT_BUDGET) return { dataUrl, width: target.width, height: target.height, type: 'image/jpeg', bytes: dataUrlBytes(dataUrl) };
    }
    return undefined;
  } catch { return undefined; } // a tainted or lost context: the report goes without a picture
}
