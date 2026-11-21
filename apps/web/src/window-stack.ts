// AGPL-3.0-or-later. See ../../../LICENSE.
/*
 * One stack of open windows for the whole client. In VB6 every window is its own form: Escape reaches the form that has the focus, so the
 * top-most one closes and the others stay. The DOM windows of this client are separate widgets that used to listen for Escape on their own
 * (and only while focus was inside them), so Escape closed several, or none. Each window registers here once; the stack remembers the order in
 * which they became visible, Escape closes the most recent one, and panels marked `exclusive` (party, guild, quests, stats, options) replace
 * each other instead of piling up.
 */
export interface WindowEntry { id: string; isOpen: () => boolean; close: () => void; exclusive: boolean; shown?: number | undefined }

export class WindowStack {
  private readonly entries = new Map<string, WindowEntry>();
  private seq = 0;
  private refreshing = false;
  /** Register a window. `isOpen` is read on every refresh, so it may be a `hidden` flag or a closed flag. */
  watch(id: string, isOpen: () => boolean, close: () => void, exclusive = false) {
    this.entries.set(id, { id, isOpen, close, exclusive });
    this.refresh();
  }
  unwatch(id: string) { this.entries.delete(id); }
  /** Watch an element: open while connected and not `hidden`. */
  watchElement(id: string, el: HTMLElement, close: () => void, exclusive = false) {
    this.watch(id, () => el.isConnected && !el.hidden, close, exclusive);
  }
  /** Ids of the open windows, oldest first. */
  get open(): string[] {
    this.refresh();
    return [...this.entries.values()].filter(e => e.shown !== undefined).sort((a, b) => a.shown! - b.shown!).map(e => e.id);
  }
  /** Note which windows opened or closed since the last call; a newly opened exclusive panel closes the older ones. */
  refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const opened: WindowEntry[] = [];
      for (const entry of this.entries.values()) {
        if (entry.isOpen()) { if (entry.shown === undefined) { entry.shown = ++this.seq; opened.push(entry); } } else entry.shown = undefined;
      }
      for (const entry of opened.filter(e => e.exclusive)) {
        for (const other of this.entries.values()) {
          if (other !== entry && other.exclusive && other.shown !== undefined && other.shown < entry.shown!) { other.close(); if (!other.isOpen()) other.shown = undefined; }
        }
      }
    } finally { this.refreshing = false; }
  }
  /** Escape: close the most recently opened window. False when nothing was open. */
  closeTop(): boolean {
    this.refresh();
    let top: WindowEntry | undefined;
    for (const entry of this.entries.values()) if (entry.shown !== undefined && (!top || entry.shown > top.shown!)) top = entry;
    if (!top) return false;
    top.close();
    this.refresh();
    return true;
  }
  /** Re-check every window whenever the DOM changes, and own Escape before any element-level handler sees it. */
  install(target: Window & typeof globalThis = window) {
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => this.refresh()).observe(target.document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
    }
    target.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.repeat) return;
      if (this.closeTop()) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }
}

export const windows = new WindowStack();
