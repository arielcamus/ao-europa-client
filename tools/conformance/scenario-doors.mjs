// Doors scenario: walk next to the plain door at (72,35) of map 1, LeftClick it (opens), walk through, LeftClick again (closes).
import fs from 'node:fs';
const blockedTiles = new Set(JSON.parse(fs.readFileSync(process.env.AO_MAP1_JSON ?? '/private/tmp/claude-501/ao-map1.json', 'utf8')).blocked
  .filter(b => (b[2] & 0x20) || (b[2] & 15) === 15).map(b => b[0] + ',' + b[1]));
const learned = new Set();
export default async function run(rec) {
  const tx = 72, ty = 36; // tile south of the door (72,35)
  let pos = null, counter = 0;
  for (const r of rec.records) if (r.name === 'CharacterCreate') {} // self position from UserCharIndexInServer + CharacterCreate
  const self = Buffer.from(rec.records.find(r => r.name === 'UserCharIndexInServer').hex, 'hex').readInt16LE(0);
  const cc = rec.records.filter(r => r.name === 'CharacterCreate').map(r => Buffer.from(r.hex, 'hex')).find(b => b.readInt16LE(0) === self);
  pos = [cc[7], cc[8]]; console.log('start', pos);
  const bfs = (from, to) => { const q = [from], prev = new Map([[from.join(), null]]);
    while (q.length) { const [x, y] = q.shift(); if (x === to[0] && y === to[1]) break;
      for (const [h, dx, dy] of [[1, 0, -1], [2, 1, 0], [3, 0, 1], [4, -1, 0]]) { const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
        if (nx < 1 || ny < 1 || nx > 100 || ny > 100 || prev.has(k.replace(',', ','))) continue; if (prev.has([nx, ny].join())) continue;
        if ((blockedTiles.has(k) || learned.has(k)) && !(nx === to[0] && ny === to[1])) continue; prev.set([nx, ny].join(), { from: [x, y], h, to: [nx, ny] }); q.push([nx, ny]); } }
    let cur = to; const path = []; while (prev.get(cur.join())) { const p = prev.get(cur.join()); path.unshift(p); cur = p.from; } return prev.has(to.join()) ? path : null; };
  const step = async h => { const before = rec.records.length; rec.send(78, [h, ...(() => { const b = Buffer.alloc(4); b.writeInt32LE(++counter); return [...b]; })()]); await rec.sleep(120); rec.send(79);
    await rec.sleep(500); const ups = rec.records.slice(before).filter(x => x.name === 'PosUpdate'); if (!ups.length) throw new Error('no PosUpdate (connection dropped?)');
    const b = Buffer.from(ups.at(-1).hex, 'hex'); return [b[0], b[1]]; };
  const goto = async to => { for (let guard = 0; guard < 400; guard++) { if (pos[0] === to[0] && pos[1] === to[1]) return true;
      const path = bfs(pos, to); if (!path?.length) { console.log('no path', pos, to); return false; }
      const st = path[0], np = await step(st.h); if (np[0] === pos[0] && np[1] === pos[1]) learned.add(st.to.join()); pos = np; await rec.sleep(60); } return false; };
  console.log('goto', await goto([tx, ty]), pos);
  rec.mark = rec.records.length;
  const click = (x, y, n) => [x, y, ...(() => { const b = Buffer.alloc(4); b.writeInt32LE(n); return [...b]; })()];
  // The server acts on doors from the clicked tile's (x+1,y)/(x+1,y+1)/(x,y+1) neighbours; a click on the door tile only looks.
  rec.send(95, click(72, 35, 1)); await rec.sleep(1700);   // exactly on the door: look only
  rec.send(95, click(71, 35, 2)); await rec.sleep(1700);   // opens or closes (toggle) the door at (72,35)
  rec.send(96, [71, 35]); await rec.sleep(500);            // DoubleClick: ignored by the reference server
  console.log('through', await step(1), await step(1), await step(3), await step(3));
  rec.send(95, click(71, 35, 3)); await rec.sleep(1700);   // toggles again
  rec.send(79); await rec.sleep(500);
}
