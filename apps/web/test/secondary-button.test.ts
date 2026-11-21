import { describe, expect, it } from 'vitest';
import { MacControlClick, isMacPlatform, isSecondaryPress } from '../src/secondary-button.js';

describe('VB6 right button in the browser', () => {
  it('is button 2 everywhere, and Control+primary only on a Mac', () => {
    expect(isSecondaryPress({ button: 2, ctrlKey: false }, false)).toBe(true);
    expect(isSecondaryPress({ button: 2, ctrlKey: false }, true)).toBe(true);
    expect(isSecondaryPress({ button: 0, ctrlKey: true }, true)).toBe(true);
    expect(isSecondaryPress({ button: 0, ctrlKey: true }, false)).toBe(false);
    expect(isSecondaryPress({ button: 0, ctrlKey: false }, true)).toBe(false);
  });
  it('recognises the Mac platforms', () => {
    expect(isMacPlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isMacPlatform({ platform: 'Win32' })).toBe(false);
    expect(isMacPlatform({ platform: '', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe(true);
  });
});

describe('Mac Control as a click modifier, not an attack (issue #103)', () => {
  const source = { closest: (sel: string) => (sel.includes('#inventory') ? {} : null) };
  const world = { closest: () => null };
  const press = { code: 'ControlLeft', repeat: false }, repeat = { code: 'ControlLeft', repeat: true };
  it('Control pressed over the inventory or spells attacks neither on the press nor on repeats, until released', () => {
    const m = new MacControlClick(true);
    m.pointerAt(source as unknown as EventTarget);
    expect(m.suppress(press)).toBe(true);
    m.pointerAt(world as unknown as EventTarget); // dragging out to the hotkey bar
    expect(m.suppress(repeat)).toBe(true);
    m.release();
    expect(m.suppress(press)).toBe(false); // a fresh press over the world attacks
  });
  it('a Control+click that lands while Control is held stops the repeats', () => {
    const m = new MacControlClick(true);
    m.pointerAt(world as unknown as EventTarget);
    expect(m.suppress(press)).toBe(false);
    m.pointerDown({ button: 0, ctrlKey: true });
    expect(m.suppress(repeat)).toBe(true);
  });
  it('changes nothing off a Mac or for other keys', () => {
    const m = new MacControlClick(false);
    m.pointerAt(source as unknown as EventTarget); m.pointerDown({ button: 0, ctrlKey: true });
    expect(m.suppress(press)).toBe(false); expect(m.suppress(repeat)).toBe(false);
    const mac = new MacControlClick(true); mac.pointerAt(source as unknown as EventTarget);
    expect(mac.suppress({ code: 'KeyQ', repeat: false })).toBe(false);
  });
});
