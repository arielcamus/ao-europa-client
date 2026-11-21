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
