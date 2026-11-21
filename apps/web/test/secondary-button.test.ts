import { describe, expect, it } from 'vitest';
import { isMacPlatform, isSecondaryPress } from '../src/secondary-button.js';

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
