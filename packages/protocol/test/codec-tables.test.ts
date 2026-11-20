import { describe, expect, it } from 'vitest';
import { assertDisjointCodecTables, codecTables } from '../src/index.js';

describe('codec tables: exactly one codec per packet id', () => {
  it('no two feature tables register the same server or client id', () => {
    for (const side of ['server', 'client'] as const) {
      const ids = Object.values(codecTables[side]).flatMap(table => Object.keys(table));
      const dupes = ids.filter((id, index) => ids.indexOf(id) !== index);
      expect(dupes, `${side} ids with two codecs`).toEqual([]);
    }
  });
  it('the guard really fails on a duplicate and on a merged table nobody listed', () => {
    const a = { 95: {} }, b = { 95: {} };
    expect(() => assertDisjointCodecTables({ a, b }, { ...a, ...b }, 'client')).toThrow(/95 has two codecs/);
    expect(() => assertDisjointCodecTables({ a }, { ...a, 96: {} }, 'client')).toThrow(/96 .*not listed/);
  });
});
