import { expect, it } from 'vitest';
import { normalizeTrueColorBmp } from '../src/interface-assets.js';

// Synthetic 2×1 BGR bitmap with row padding and the upstream invalid
// biClrImportant value. No licensed image bytes are used.
const bmp = () => Uint8Array.from(Buffer.from(
  '424d3e000000000000003600000028000000020000000100000001001800000000000800000000000000000000000000000000000001' +
  '0000ff00ff000000', 'hex'));

it('normalizes unused palette metadata without touching pixels or the source buffer', () => {
  const original = bmp(), normalized = normalizeTrueColorBmp(original);
  expect(new DataView(original.buffer).getUint32(50, true)).toBe(16777216);
  expect(new DataView(normalized.buffer).getUint32(50, true)).toBe(0);
  expect(normalized.slice(0, 46)).toEqual(original.slice(0, 46));
  expect(normalized.slice(54)).toEqual(original.slice(54));
});
it('rejects truncated rows and formats outside the narrow metadata workaround', () => {
  expect(() => normalizeTrueColorBmp(bmp().slice(0, -1))).toThrow();
  const compressed = bmp(); new DataView(compressed.buffer).setUint32(30, 1, true);
  expect(() => normalizeTrueColorBmp(compressed)).toThrow('Unsupported');
  const indexed = bmp(); new DataView(indexed.buffer).setUint16(28, 8, true);
  expect(() => normalizeTrueColorBmp(indexed)).toThrow('Unsupported');
});
it('also preserves the pixel bytes of uncompressed 32-bit BMPs', () => {
  const original = bmp(); new DataView(original.buffer).setUint16(28, 32, true);
  const normalized = normalizeTrueColorBmp(original);
  expect(normalized.slice(54)).toEqual(original.slice(54));
  expect(new DataView(normalized.buffer).getUint16(28, true)).toBe(32);
});
