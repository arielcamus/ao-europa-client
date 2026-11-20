// Shared scenario helpers: login-independent walking and clicking with VB6-style per-family counters. AGPL-3.0-or-later.
import path from 'node:path';
import { blockedTiles } from './csm-blocked.mjs';
import { i32 } from './wire.mjs';

export function mapBlocked(map = 1) {
  const root = process.env.AO_ASSETS ?? path.join(process.env.HOME, 'Projects/ao-reference/Recursos');
  return blockedTiles(path.join(root, 'Mapas', `Mapa${map}.csm`));
}
const heads = [[1, 0, -1], [2, 1, 0], [3, 0, 1], [4, -1, 0]];

export function makeWalker(rec, blocked = mapBlocked()) {
  const learned = new Set(), counters = { walk: 0, leftClick: 0 };
  const selfPos = () => {
    const self = Buffer.from(rec.records.find(r => r.name === 'UserCharIndexInServer').hex, 'hex').readInt16LE(2);
    const cc = rec.records.filter(r => r.name === 'CharacterCreate').map(r => Buffer.from(r.hex, 'hex')).find(b => b.readInt16LE(2) === self);
    return [cc[9], cc[10]]; // body = id(2) charIndex(2) body(2) head(2) heading(1) x y
  };
  const bfs = (from, to) => {
    const q = [from], prev = new Map([[from.join(), null]]);
    while (q.length) { const [x, y] = q.shift(); if (x === to[0] && y === to[1]) break;
      for (const [h, dx, dy] of heads) { const n = [x + dx, y + dy], k = n.join(',');
        if (n[0] < 1 || n[1] < 1 || n[0] > 100 || n[1] > 100 || prev.has(k)) continue;
        if ((blocked.has(k) || learned.has(k)) && !(n[0] === to[0] && n[1] === to[1])) continue;
        prev.set(k, { from: [x, y], h, to: n }); q.push(n); } }
    if (!prev.has(to.join())) return null;
    const path = []; let cur = to; while (prev.get(cur.join())) { const p = prev.get(cur.join()); path.unshift(p); cur = p.from; } return path;
  };
  const w = { pos: null,
    async step(h) { const before = rec.records.length; rec.send(78, [h, ...i32(++counters.walk)]); await rec.sleep(120); rec.send(79); await rec.sleep(500);
      const ups = rec.records.slice(before).filter(x => x.name === 'PosUpdate'); if (!ups.length) throw new Error('no PosUpdate (connection dropped?)');
      const b = Buffer.from(ups.at(-1).hex, 'hex'); w.pos = [b[2], b[3]]; return w.pos; },
    async goto(to) { w.pos ??= selfPos();
      for (let guard = 0; guard < 500; guard++) { if (w.pos[0] === to[0] && w.pos[1] === to[1]) return true;
        const path = bfs(w.pos, to); if (!path?.length) return false; const st = path[0], np = await w.step(st.h); if (process.env.AO_DEBUG) console.log('step', st.h, '->', np, 'want', st.to);
        if (np[0] === w.pos[0] && np[1] === w.pos[1]) learned.add(st.to.join()); await rec.sleep(60); }
      return false; },
    /** LeftClick(x, y, counter): the server runs verifyTimeStamp on the counter. Pace clicks >= 1.7 s apart. */
    async click(x, y) { rec.send(95, [x, y, ...i32(++counters.leftClick)]); await rec.sleep(1700); } };
  return w;
}
