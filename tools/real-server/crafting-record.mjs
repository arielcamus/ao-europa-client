// Records the crafting / work scenarios against the VB6 server into tests/fixtures/vb6/crafting/*.jsonl.
// Usage: AO_EMAIL=aotest@local.test AO_PASSWORD=... node tools/real-server/crafting-record.mjs   (pnpm --filter @ao/protocol build first)
// AGPL-3.0-or-later. A level-1 character has no gold, no tool and no skill, so every scenario records the server's REFUSAL or its
// silence; the successful build / extraction paths are covered by hand-built goldens (packages/protocol/test/crafting.test.ts).
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { Vb6Session, C, sleep } from './items-session.mjs';
import { blockedTiles } from '../conformance/csm-blocked.mjs';
import { CraftingClientPacketId as CC, CraftingServerPacketId as CS } from '../../packages/protocol/dist/index.js';

const dir = new URL('../../tests/fixtures/vb6/crafting/', import.meta.url).pathname;
const assets = process.env.AO_ASSETS ?? path.join(process.env.HOME, 'Projects/ao-reference/Recursos');
const blocked = blockedTiles(path.join(assets, 'Mapas', 'Mapa1.csm'));
const s = new Vb6Session({ email: process.env.AO_EMAIL ?? 'aotest@local.test', password: process.env.AO_PASSWORD });
setTimeout(() => { console.error('timeout'); process.exit(2); }, 240000);

// Names are informational; the shared session helper only knows the older feature tables.
const names = new Map(); for (const [k, v] of Object.entries(CS)) names.set(`s${v}`, k); for (const [k, v] of Object.entries(CC)) names.set(`c${v}`, k);
const known = JSON.parse(readFileSync(new URL('../conformance/server-packet-names.json', import.meta.url), 'utf8'));
for (const [id, name] of Object.entries(Array.isArray(known) ? known : known.names ?? known)) if (!names.has(`s${id}`)) names.set(`s${id}`, name);
for (const [name, id] of [['Walk', 78], ['RequestPositionUpdate', 79], ['LeftClick', 95]]) names.set(`c${id}`, name);
const save = (name, from) => {
  for (const r of s.records) { const n = names.get(`${r.dir === 's2c' ? 's' : 'c'}${r.id}`); if (n) r.name = n; }
  s.save(`${dir}${name}.jsonl`, from); console.log(name, s.records.length - from, 'frames');
};
await s.login();
save('login', 0);

const heads = [[1, 0, -1], [2, 1, 0], [3, 0, 1], [4, -1, 0]];
const learned = new Set(), stuck = new Map();
const bfs = (from, to) => {
  const q = [from], prev = new Map([[from.join(), null]]);
  while (q.length) { const [x, y] = q.shift(); if (x === to[0] && y === to[1]) break;
    for (const [h, dx, dy] of heads) { const n = [x + dx, y + dy], k = n.join(',');
      if (n[0] < 1 || n[1] < 1 || n[0] > 100 || n[1] > 100 || prev.has(k)) continue;
      if ((blocked.has(k) || learned.has(k)) && !(n[0] === to[0] && n[1] === to[1])) continue;
      prev.set(k, { from: [x, y], h, to: n }); q.push(n); } }
  if (!prev.has(to.join())) return null;
  const out = []; let cur = to; while (prev.get(cur.join())) { const p = prev.get(cur.join()); out.unshift(p); cur = p.from; } return out;
};
async function goto(to) {
  for (let guard = 0; guard < 400; guard++) {
    if (s.pos.x === to[0] && s.pos.y === to[1]) return true;
    const route = bfs([s.pos.x, s.pos.y], to); if (!route?.length) return false;
    const before = { ...s.pos };
    s.send({ id: C.Walk, heading: route[0].h, counter: s.nextCounter('walk') }); s.send({ id: C.RequestPositionUpdate }); await sleep(500);
    // A refused step is retried once (the walk interval is paced) before the tile is treated as blocked (an NPC, a statue).
    if (s.pos.x === before.x && s.pos.y === before.y) { if (stuck.get(route[0].to.join()) === 1) learned.add(route[0].to.join()); stuck.set(route[0].to.join(), 1); }
  }
  return false;
}
const click = async (x, y, wait = 1800) => { s.send({ id: 95, x, y, counter: s.nextCounter('leftClick') }); await sleep(wait); };
const step = async (from, steps) => { const start = s.records.length; for (const [packet, wait = 700] of steps) { s.send(packet); await sleep(wait); } return start; };

// 1. Stations that are not open: the server ignores every crafting-window packet (no reply at all).
let from = s.records.length;
await step(from, [
  [{ id: CC.AddItemCrafting, inventorySlot: 4, craftSlot: 0 }], [{ id: CC.RemoveItemCrafting, craftSlot: 1, inventorySlot: 0 }], [{ id: CC.AddCatalyst, inventorySlot: 7 }],
  [{ id: CC.RemoveCatalyst, inventorySlot: 0 }], [{ id: CC.MoveCraftItem, drag: 1, drop: 2 }], [{ id: CC.CraftItem }], [{ id: CC.CloseCrafting }],
  [{ id: CC.FlagTrabajar }], [{ id: CC.RepeatMacro }],
]);
save('station-not-open', from);
// 2. CompletarAccion with no pending action: Msg750.
from = s.records.length;
await step(from, [[{ id: CC.CompletarAccion, action: 1 }, 1200]]);
save('complete-action-none', from);
// 3. Build requests with no materials, no tool and no skill (daga +1, cuchara, pocion de vida, tela).
from = s.records.length;
await step(from, [
  [{ id: CC.CraftBlacksmith, object: 165 }, 1200], [{ id: CC.CraftAlquimista, object: 5997 }, 1200], [{ id: CC.CraftSastre, object: 3578 }, 1200],
  [{ id: CC.CraftCarpenter, object: 163, amount: 1 }, 4500], [{ id: CC.FlagTrabajar }, 800],
]);
save('build-refused', from);
// 4. The anvil: too far away, then next to it with no hammer equipped.
console.log('to anvil', await goto([36, 65]), s.pos);
from = s.records.length;
await click(34, 65);
save('anvil-no-hammer', from);
// 5. A tree next to a character with no axe: StartAutomatedAction is accepted or refused by the server, never by the client.
console.log('to tree', await goto([38, 70]), s.pos);
from = s.records.length;
await step(from, [
  [{ id: CC.StartAutomatedAction, x: 38, y: 71, skill: 17 }, 3000],   // chop the tree, no axe
  [{ id: CC.StartAutomatedAction, x: 38, y: 70, skill: 19 }, 1500],   // mine where there is no deposit
  [{ id: CC.StartAutomatedAction, x: 38, y: 71, skill: 26 }, 1500],   // smelt where there is no forge
  [{ id: CC.StartAutomatedAction, x: 38, y: 71, skill: 18 }, 1500],   // fish on dry land
  [{ id: CC.FlagTrabajar }, 600],
]);
save('automated-action-refused', from);
s.close(); setTimeout(() => process.exit(0), 300);
