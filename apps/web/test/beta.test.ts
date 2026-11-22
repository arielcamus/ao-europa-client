import { describe, expect, it } from 'vitest';
import { BETA_CONSOLE_LINE, betaButtonPlacement, betaEnabled, isTouchMode } from '../src/beta.js';
import { classicScale } from '../src/classic-layout.js';
import { betaFromEnv } from '../../../tools/bug-reports.mjs';

describe('beta flag', () => {
  it('AO_BETA is on by default and off only for an explicit 0/false/off/no', () => {
    expect(betaFromEnv({})).toBe(true);
    expect(betaFromEnv({ AO_BETA: '1' })).toBe(true);
    expect(betaFromEnv({ AO_BETA: '' })).toBe(true);
    for (const off of ['0', 'false', 'OFF', ' no ']) expect(betaFromEnv({ AO_BETA: off }), off).toBe(false);
  });

  it('the client turns the aids on only for an explicit `beta: true` in ao-config.json', () => {
    expect(betaEnabled({ mode: 'classic', beta: true })).toBe(true);
    expect(betaEnabled({ mode: 'classic', beta: false })).toBe(false);
    expect(betaEnabled({ mode: 'classic' })).toBe(false); // an older server without the field
    expect(betaEnabled({ beta: 'true' })).toBe(false);
    expect(betaEnabled(null)).toBe(false);
    // ?beta=1 / ?beta=0 override the server for one page; anything else leaves it alone.
    expect(betaEnabled({ beta: false }, '?beta=1')).toBe(true);
    expect(betaEnabled({ beta: true }, '?beta=0')).toBe(false);
    expect(betaEnabled({ beta: true }, '?beta=yes&scale=fill')).toBe(true);
  });

  it('touch devices keep the MENU tab button instead of the floating one', () => {
    const media = (coarse: boolean) => (query: string) => ({ matches: coarse && query === '(hover: none) and (pointer: coarse)' });
    expect(isTouchMode(media(true))).toBe(true);
    expect(isTouchMode(media(false))).toBe(false);
    expect(isTouchMode(undefined)).toBe(false);
  });

  it('the console line names both ways in', () => {
    expect(BETA_CONSOLE_LINE).toBe('Beta: si ves algo raro, F8 o el botón 🐞 arriba a la derecha');
  });
});

describe('betaButtonPlacement', () => {
  const full = { width: 170, height: 34 }, compact = { width: 40, height: 34 };
  // The real layout: 1024x768 scaled to fit (classic mode, DPR 1).
  const at = (height: number) => (width: number) => { const scale = classicScale(width, height); return { width: 1024 * scale, height: 768 * scale }; };
  it('full label beside the game on a 16:9 screen (1920x1080: 240 px a side)', () => {
    expect(betaButtonPlacement({ width: 1920, height: 1080 }, at(1080), full, compact)).toEqual({ variant: 'full', gutter: 0 });
  });
  it('full label above the game when the window is taller than 4:3', () => {
    expect(betaButtonPlacement({ width: 1024, height: 900 }, at(900), full, compact)).toEqual({ variant: 'full', gutter: 0 });
  });
  it('a laptop window (1512x860) snaps the game to 1x, which leaves 244 px a side: full label, no gutter', () => {
    expect(betaButtonPlacement({ width: 1512, height: 860 }, at(860), full, compact)).toEqual({ variant: 'full', gutter: 0 });
  });
  it('just too narrow for the words (1600x1000, 133 px a side): a 186 px gutter costs the game 8%, so full label with the gutter', () => {
    expect(betaButtonPlacement({ width: 1600, height: 1000 }, at(1000), full, compact)).toEqual({ variant: 'full', gutter: 186 });
  });
  it('icon only where a gutter for the words would shrink the game too much (1440x1000: 54 px a side)', () => {
    expect(betaButtonPlacement({ width: 1440, height: 1000 }, at(1000), full, compact)).toEqual({ variant: 'compact', gutter: 56 });
    expect(betaButtonPlacement({ width: 1400, height: 1000 }, at(1000), full, compact)).toEqual({ variant: 'compact', gutter: 56 });
  });
  it('icon only, no gutter, when the side room fits the icon', () => {
    expect(betaButtonPlacement({ width: 1440, height: 960 }, at(960), full, compact)).toEqual({ variant: 'compact', gutter: 0 });
  });
  it('a 4:3 window with no room: a gutter of exactly the icon button plus margins', () => {
    expect(betaButtonPlacement({ width: 1024, height: 768 }, at(768), full, compact)).toEqual({ variant: 'compact', gutter: 56 });
  });
  it('never lands on the game: whatever it picks, the button fits in the room left once the gutter is applied', () => {
    for (const [w, h] of [[800, 600], [1024, 768], [1280, 720], [1366, 768], [1440, 900], [1440, 1000], [1512, 860], [1920, 1200], [2560, 1080]] as const) {
      const p = betaButtonPlacement({ width: w, height: h }, at(h), full, compact);
      const game = at(h)(w - 2 * p.gutter), button = p.variant === 'full' ? full : compact;
      const side = (w - game.width) / 2, top = (h - game.height) / 2;
      expect(side >= button.width + 16 || top >= button.height + 16, `${w}x${h} ${JSON.stringify(p)}`).toBe(true);
    }
  });
});
