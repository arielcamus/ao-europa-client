/*
 * VB6 vbRightButton in a browser. The pinned client starts every drag (inventory moves, hotkey binds) with the RIGHT button only. On a Mac
 * the system's own secondary click is also Control+click (one-button mice, trackpads with "secondary click" off), which a browser may report
 * as button 0 with ctrlKey: on a Mac that counts as the right button too. Elsewhere Control+click stays a left click.
 * AGPL-3.0-or-later; see NOTICE.
 */
export const isMacPlatform = (nav: { platform?: string; userAgent?: string } | undefined = globalThis.navigator): boolean =>
  /Mac|iPhone|iPad|iPod/.test(nav?.platform || nav?.userAgent || '');

/** The press that starts a VB6 right-button drag: button 2, or Control+primary on a Mac. */
export function isSecondaryPress(event: { button: number; ctrlKey: boolean }, mac = isMacPlatform()): boolean {
  return event.button === 2 || (mac && event.button === 0 && event.ctrlKey);
}

/**
 * Control is both the default Attack key ([DEFAULTSMODERN] 1 = 17, repeating while held) and the Mac's secondary-click modifier, so a
 * Control+click drag to the hotkey bar would attack the whole time (issue #103). On a Mac a Control press is CLAIMED as a click modifier,
 * and then attacks neither on the press nor on its repeats until Control is released, when:
 *  - the pointer rests on a drag source (the inventory or the spell list) as Control goes down: the drag's own first step, so no attack
 *    leaves at all; or
 *  - a Control+click lands while Control is held (the pointer was elsewhere): the repeats stop from that click on.
 * Anywhere else, and on every other platform, Control attacks exactly as in VB6.
 */
export class MacControlClick {
  private overSource = false;
  private claimed = false;
  constructor(private readonly mac = isMacPlatform(), private readonly sources = '#inventory, #spells') {}
  install(target: Pick<Window, 'addEventListener'> = window) {
    target.addEventListener('pointermove', event => this.pointerAt(event.target), true);
    target.addEventListener('pointerdown', event => this.pointerDown(event), true);
    target.addEventListener('keyup', event => { if (/^Control(Left|Right)$/.test(event.code)) this.release(); }, true);
    target.addEventListener('blur', () => this.release());
  }
  pointerAt(target: EventTarget | null) { this.overSource = !!(target as Element | null)?.closest?.(this.sources); }
  pointerDown(event: { button: number; ctrlKey: boolean; target?: EventTarget | null }) {
    if (event.target !== undefined) this.pointerAt(event.target);
    if (this.mac && event.button === 0 && event.ctrlKey) this.claimed = true;
  }
  release() { this.claimed = false; }
  /** True when this keydown is a Control press (or repeat) that must not attack. */
  suppress(event: { code: string; repeat: boolean }): boolean {
    if (!this.mac || !/^Control(Left|Right)$/.test(event.code)) return false;
    if (!event.repeat && this.overSource) this.claimed = true;
    return this.claimed;
  }
}
