import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RoofLights, hayTecho, nearRoof, roofTriggers, tileKey } from '../src/map-objects.js';

// Real tiles of mapa1 (Ullathorpe) around the bank (77,43..55) and the carpinteria (63..72,74..79).
const fx = JSON.parse(readFileSync(new URL('./fixtures/mapa1-bank-carpinteria.json', import.meta.url), 'utf8')) as { x0: number; y0: number; rows: string[] };
const raw = new Uint16Array(10_000); const roofTile = new Set<number>();
fx.rows.forEach((row, ry) => row.split(' ').forEach((cell, rx) => {
  const i = tileKey(fx.x0 + rx, fx.y0 + ry); raw[i] = parseInt(cell, 10); if (cell.endsWith('r')) roofTile.add(i);
}));
const at = (x: number, y: number) => tileKey(x, y);

describe('roofs over building interiors (castle-entry triggers on mapa1)', () => {
  it('the file has no roof trigger on these interiors, so the faithful rule alone never fades them', () => {
    expect(raw[at(77, 51)]).toBe(29); expect(raw[at(65, 77)]).toBe(32);
    expect(hayTecho(raw[at(77, 51)]!)).toBe(false);
    expect(nearRoof(raw, 77, 50)).toBe(0);
  });
  it('bank: standing at (77,51) fades the roof above you to transparent', () => {
    const t = roofTriggers(raw); const lights = new RoofLights(); lights.reset(t);
    expect(roofTile.has(at(77, 50))).toBe(true);
    const trigger = nearRoof(t, 77, 50);
    expect(hayTecho(t[at(77, 51)]!)).toBe(true);
    expect(trigger).toBe(t[at(77, 51)]);
    expect(lights.alphaOf(trigger)).toBe(1);
    for (let i = 0; i < 20; i++) lights.update(t[at(77, 51)]!, 16);
    expect(lights.alphaOf(trigger)).toBe(0);
  });
  it('carpinteria: standing at (65,77) fades its roof, a roof elsewhere stays opaque', () => {
    const t = roofTriggers(raw); const lights = new RoofLights(); lights.reset(t);
    const mine = nearRoof(t, 65, 77);
    expect(mine).toBe(t[at(65, 77)]);
    for (let i = 0; i < 20; i++) lights.update(t[at(65, 77)]!, 16);
    expect(lights.alphaOf(mine)).toBe(0);
    expect(lights.alphaOf(t[at(77, 51)]!)).toBe(1);
    // stepping back out (65,81, trigger 0) brings it back up
    for (let i = 0; i < 20; i++) lights.update(0, 16);
    expect(lights.alphaOf(mine)).toBe(1);
  });
  it('real roof triggers and plain tiles are not changed', () => {
    const t = roofTriggers(Uint16Array.from([0, 1, 4, 16, 20, 21, 59, 60, 61]));
    expect(Array.from(t)).toEqual([0, 1, 4, 16, 20, 81, 119, 60, 61]);
  });
});
