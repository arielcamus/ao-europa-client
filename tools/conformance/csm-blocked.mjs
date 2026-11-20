// Minimal CSM reader for the recorder's path finder: the tiles a walker cannot enter (water flag or all four sides blocked).
// Mirrors apps/web/src/assets.ts parseMap; only the header and the blocked section are read. AGPL-3.0-or-later.
import fs from 'node:fs';
export function blockedTiles(path) {
  const b = fs.readFileSync(path); let o = 0;
  const i32 = () => { const v = b.readInt32LE(o); o += 4; return v; };
  const i16 = () => { const v = b.readInt16LE(o); o += 2; return v; };
  const text = () => { const n = b.readUInt16LE(o); o += 2 + n; };
  const first = i32(), five = first === 0x324c3557;
  const count = five ? i32() : first;
  o += 4 * (five ? 5 : 4) + 4 * 6 + 8;
  text(); o += 1; text(); o += 9; text(); text(); text(); o += 16; text(); o += 3;
  const set = new Set();
  for (let k = 0; k < count; k++) { const x = i16(), y = i16(), v = b[o++]; if ((v & 0x20) || (v & 15) === 15) set.add(`${x},${y}`); }
  return set;
}
