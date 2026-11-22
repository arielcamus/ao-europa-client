import { describe, expect, it } from 'vitest';
import { characterTapTile } from '../src/combat.js';

const at = (charIndex: number, x: number, y: number) => ({ charIndex, x, y });

describe('characterTapTile (click anywhere on a creature sprite)', () => {
  it('covers the foot tile and up to 2 tiles above it', () => {
    const cs = [at(2, 10, 20)];
    expect(characterTapTile(cs, 1, { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
    expect(characterTapTile(cs, 1, { x: 10, y: 19 })).toEqual({ x: 10, y: 20 });
    expect(characterTapTile(cs, 1, { x: 10, y: 18 })).toEqual({ x: 10, y: 20 });
  });
  it('misses 3 tiles above, below the foot and other columns', () => {
    const cs = [at(2, 10, 20)];
    expect(characterTapTile(cs, 1, { x: 10, y: 17 })).toBeUndefined();
    expect(characterTapTile(cs, 1, { x: 10, y: 21 })).toBeUndefined();
    expect(characterTapTile(cs, 1, { x: 11, y: 20 })).toBeUndefined();
  });
  it('picks the nearest foot on a vertical stack', () => {
    const cs = [at(2, 10, 20), at(3, 10, 21)];
    expect(characterTapTile(cs, 1, { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
    expect(characterTapTile(cs, 1, { x: 10, y: 19 })).toEqual({ x: 10, y: 20 });
    expect(characterTapTile(cs, 1, { x: 10, y: 21 })).toEqual({ x: 10, y: 21 });
    expect(characterTapTile(cs, 1, { x: 10, y: 18 })).toEqual({ x: 10, y: 20 });
  });
  it('ignores yourself and empty ground', () => {
    expect(characterTapTile([at(1, 10, 20)], 1, { x: 10, y: 19 })).toBeUndefined();
    expect(characterTapTile([], 1, { x: 10, y: 19 })).toBeUndefined();
  });
});
