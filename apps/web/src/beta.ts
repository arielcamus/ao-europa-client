// AGPL-3.0-or-later. Alpha/beta play aids (docs/BUG-REPORTS.md "Beta: the bug button"): a red "Reportar bug (F8)" button outside the
// classic window and one console line per login. Both hang on one flag, ao-config.json `beta` (AO_BETA on the server, on by default),
// so they disappear together when the beta ends. Neither exists in the VB6 client.
import { CLASSIC_HEIGHT, CLASSIC_WIDTH, classicScale, classicScaleNow, onClassicScale, setLayoutGutter } from './classic-layout.js';

/** Shown in the game console once per entry into the world while the beta flag is on. Client-only: nothing is sent to the server. */
export const BETA_CONSOLE_LINE = 'Beta: si ves algo raro, F8 o el botón 🐞 arriba a la derecha';
export const BETA_BUTTON_LABEL = '🐞 Reportar bug (F8)';

/**
 * The client side of the flag: on only when the server says so explicitly (`"beta": true` in ao-config.json). `?beta=1` / `?beta=0` in the
 * address overrides it for one page (the Playwright suite runs with AO_BETA=0 so the layout specs see the bare game; the beta spec opts in).
 */
export function betaEnabled(config: unknown, search = ''): boolean {
  const forced = new URLSearchParams(search).get('beta');
  if (forced === '1' || forced === '0') return forced === '1';
  return typeof config === 'object' && config !== null && (config as { beta?: unknown }).beta === true;
}

/** Phones and tablets (no hover, coarse pointer): the floating button stays off and the MENU tab's "Bugs" button is the way in. */
export function isTouchMode(match: ((query: string) => { matches: boolean }) | undefined): boolean {
  return !!match && match('(hover: none) and (pointer: coarse)').matches;
}

export interface Size { width: number; height: number }
export interface BetaPlacement {
  /** `full`: icon and words; `compact`: the icon only. */
  variant: 'full' | 'compact';
  /** CSS px the classic layout must keep free on each side (setLayoutGutter); 0 when the button already fits beside or above the game. */
  gutter: number;
}

/**
 * Where the button goes. The button is always pinned `margin` px from the page's top-right corner; this picks the label and, when needed, a
 * gutter so that it lands in the space beside or above the game and never on it. `gameAt(width)` is the game window's on-screen size when the
 * layout has `width` CSS px across (classicScale; the game is centred). In order:
 * 1. the full label fits beside or above the game as it is;
 * 2. a gutter for the full label costs the game at most `maxShrink` of its size (a wide window that is only just too narrow);
 * 3. the icon alone fits as it is;
 * 4. a gutter for the icon alone (a 4:3 or narrower window).
 */
export function betaButtonPlacement(viewport: Size, gameAt: (width: number) => Size, full: Size, compact: Size, margin = 8, maxShrink = 0.1): BetaPlacement {
  const game = gameAt(viewport.width);
  const side = (viewport.width - game.width) / 2, top = (viewport.height - game.height) / 2;
  const fits = (button: Size) => side >= button.width + 2 * margin || top >= button.height + 2 * margin;
  const gutterFor = (button: Size) => Math.ceil(button.width + 2 * margin);
  if (fits(full)) return { variant: 'full', gutter: 0 };
  if (gameAt(viewport.width - 2 * gutterFor(full)).width >= game.width * (1 - maxShrink)) return { variant: 'full', gutter: gutterFor(full) };
  if (fits(compact)) return { variant: 'compact', gutter: 0 };
  return { variant: 'compact', gutter: gutterFor(compact) };
}

/** The floating button: fixed to the page corner, outside #classic, above every window, never takes the keyboard focus. */
export class BetaBugButton {
  readonly element: HTMLButtonElement;
  private full: Size = { width: 0, height: 0 };
  private compact: Size = { width: 0, height: 0 };

  constructor(open: () => void, private readonly margin = 8) {
    const button = document.createElement('button');
    button.id = 'beta-bug-button'; button.type = 'button'; button.tabIndex = -1;
    button.title = 'Reportar un bug (F8)'; button.setAttribute('aria-label', 'Reportar un bug (F8)');
    button.innerHTML = '<span class="beta-bug-icon" aria-hidden="true">🐞</span><span class="beta-bug-words"> Reportar bug (F8)</span>';
    // Clicking must not leave the focus on the button: Enter (chat) or Space would press it again.
    button.addEventListener('mousedown', event => { event.preventDefault(); });
    button.addEventListener('click', event => { event.preventDefault(); open(); });
    document.body.append(button);
    this.element = button;
    this.measure();
    const place = () => { this.place(); };
    window.addEventListener('resize', place);
    onClassicScale(place);
    void document.fonts?.ready.then(() => { this.measure(); this.place(); });
    this.place();
  }

  private measure() {
    const button = this.element;
    button.classList.remove('compact');
    this.full = { width: button.offsetWidth, height: button.offsetHeight };
    button.classList.add('compact');
    this.compact = { width: button.offsetWidth, height: button.offsetHeight };
  }

  /** The natural (gutter-free) game size, so the decision does not feed back on the gutter it asks for. */
  private place() {
    const width = document.documentElement.clientWidth, height = window.innerHeight;
    const { dpr, mode } = classicScaleNow();
    const gameAt = (across: number) => { const scale = classicScale(Math.max(1, across), height, dpr, mode); return { width: CLASSIC_WIDTH * scale, height: CLASSIC_HEIGHT * scale }; };
    const placement = betaButtonPlacement({ width, height }, gameAt, this.full, this.compact, this.margin);
    this.element.classList.toggle('compact', placement.variant === 'compact');
    this.element.dataset.variant = placement.variant;
    setLayoutGutter(placement.gutter);
  }
}
