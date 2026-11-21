import { describe, expect, it } from 'vitest';
import { displayName } from '../src/character-data.js';

describe('header name', () => {
  it('an empty alias or clan tag renders nothing', () => {
    expect(displayName('Aotest {}')).toBe('Aotest');
    expect(displayName('Aotest <> {}')).toBe('Aotest');
    expect(displayName('Aotest')).toBe('Aotest');
  });
  it('a real alias or clan stays', () => {
    expect(displayName('Aotest <Pguildclan>')).toBe('Aotest <Pguildclan>');
    expect(displayName('Aotest {Ao}')).toBe('Aotest {Ao}');
  });
});
