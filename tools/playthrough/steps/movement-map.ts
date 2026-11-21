// AGPL-3.0-or-later. MOV-04, 07, 08, 11: steps that need tile data from the CSM map files (tools/playthrough/maps.ts reads them with the client's parseMap).
import { step } from '../harness.js';
import type { ClientPacket } from '@ao/protocol';
import { DoorClientPacketId as D } from '@ao/protocol';
import { walkTo, relocate, dbUpdateOwn, loadMap, objects, HEAD } from './util.js';
import { walkable, isWater } from '../maps.js';

/** nearest tile (BFS order from `from`) satisfying `ok`, reachable over walkable tiles */
function nearest(f: ReturnType<typeof loadMap>, from: [number, number], ok: (x: number, y: number) => boolean): [number, number] | undefined {
  const seen = new Set<number>([from[1] * 101 + from[0]]), q: [number, number][] = [from];
  while (q.length) { const [x, y] = q.shift()!; if (ok(x, y) && !(x === from[0] && y === from[1])) return [x, y];
    for (const [dx, dy] of Object.values(HEAD)) { const nx = x + dx, ny = y + dy, k = ny * 101 + nx; if (!seen.has(k) && walkable(f!.map, nx, ny)) { seen.add(k); q.push([nx, ny]); } } }
  return undefined;
}

step('MOV-04', async c => {
  if (!c.own) c.blocked('needs the own character');
  const f = await relocate(c, 751, 60, 57), p = c.player;
  const exits = new Map(f.exits.map(e => [e.y * 101 + e.x, e]));
  const target = nearest(f, [p.x, p.y], (x, y) => exits.has(y * 101 + x));
  if (!target) c.blocked('no reachable walkable tile exit on map 751');
  const exit = exits.get(target![1] * 101 + target![0])!, m = p.mark();
  await walkTo(c, target![0], target![1]);
  await p.sleep(1500);
  const cm = p.since(m).find(r => r.name === 'ChangeMap');
  c.ok(!!cm, `stepping on exit tile 751:${exit.x},${exit.y} sent ChangeMap`);
  c.eq((cm!.packet as any).map, exit.map, `destination map (tile exit -> ${exit.map}:${exit.dx},${exit.dy})`);
  c.note(`arrived at ${p.x},${p.y} (exit says ${exit.dx},${exit.dy}; ClosestLegalPos may shift it)`);
});

step('MOV-07', async c => {
  if (!c.own) c.blocked('needs the own character');
  const objs = objects(), f = loadMap(24)!;
  const exitAt = new Set(f.exits.map(e => e.y * 101 + e.x));
  const tp = f.map.objects.find(o => objs.get(o.objIndex)?.type === 19 && exitAt.has(o.y * 101 + o.x) && loadMap(f.exits.find(e => e.x === o.x && e.y === o.y)!.map));
  if (!tp) c.blocked('no otTeleport object with a tile exit to an existing map on map 24');
  const t = tp!, exitTo = f.exits.find(e => e.x === t.x && e.y === t.y)!, neighbours = Object.entries(HEAD).filter(([, [dx, dy]]) => walkable(f.map, t.x - dx, t.y - dy));
  if (!neighbours.length) c.blocked(`teleport object at 24:${t.x},${t.y} has no walkable neighbour`);
  const [h, [dx, dy]] = neighbours[0]!;
  // VB6 GameLogic.bas:CheckMapRestrictions refuses a non-GM below MapInfo(dest).MinLevel (MSG 1108 "Necesitas ser al menos nivel N"); 391 needs 20. Level 20 through the DB (own char), reverted at the end.
  await dbUpdateOwn(c, `level=20, pos_map=24, pos_x=${t.x - dx}, pos_y=${t.y - dy}`);
  const p = c.player, m = p.mark(), before = [p.map, p.x, p.y];
  const r = await p.step(Number(h), 300); await p.sleep(1500);
  c.note(`stepped onto the otTeleport tile 24:${t.x},${t.y} (obj ${t.objIndex}) from ${before}; now ${p.map}:${p.x},${p.y}; saw ${p.since(m).map(x => x.name).filter(n => !/CharacterMove|CharacterChange/.test(n)).join(',')}`);
  c.ok(p.map !== 24 || Math.abs(p.x - t.x) + Math.abs(p.y - t.y) > 3, `the teleport moved the character away (moved=${r.moved}); the tile exit says ${exitTo.map}:${exitTo.dx},${exitTo.dy} +-${objs.get(t.objIndex)?.radio ?? '?'}`);
  const rad = objs.get(t.objIndex)?.radio ?? 0;
  c.eq(p.map, exitTo.map, 'arrived on the TileExit map');
  c.ok(Math.abs(p.x - exitTo.dx) <= rad + 3 && Math.abs(p.y - exitTo.dy) <= rad + 3, `landed within Radio ${rad} of the exit (+3 for ClosestLegalPos)`);
  c.fixture('teleport-object', p, m);
  await dbUpdateOwn(c, 'level=1, is_dead=0, pos_map=751, pos_x=60, pos_y=57');
});

step('MOV-08', async c => {
  if (!c.own) c.blocked('needs the own character');
  const objs = objects(), f = await relocate(c, 751, 60, 57), p = c.player;
  const doors = f.map.objects.filter(o => objs.get(o.objIndex)?.type === 6 && !objs.get(o.objIndex)!.llave);
  if (!doors.length) c.blocked('no unlocked door object on map 751');
  // the nearest unlocked door; stand within 2 tiles
  const d = doors.sort((a, b) => Math.hypot(a.x - 60, a.y - 57) - Math.hypot(b.x - 60, b.y - 57))[0]!;
  const spot = nearest(f, [60, 57], (x, y) => Math.max(Math.abs(x - d.x), Math.abs(y - d.y)) <= 1 && !(x === d.x && y === d.y));
  if (!spot) c.blocked(`no walkable tile next to door ${d.objIndex} at ${d.x},${d.y}`);
  await walkTo(c, spot![0], spot![1]);
  const m = p.mark(); p.send({ id: D.LeftClick, x: d.x, y: d.y, counter: 0 } as ClientPacket); await p.sleep(1500);
  // Protocol.bas:HandleDoubleClick is a no-op in the pinned server ("World interactions are handled on left click"): doors answer LeftClick only.
  const created = p.since(m).filter(r => r.name === 'ObjectCreate' || r.name === 'ObjectDelete' || r.name === 'BlockPosition').map(r => r.name);
  c.ok(created.length > 0, `LeftClick on door ${d.objIndex} at ${d.x},${d.y} answered ${created.join(',') || '(nothing)'} (Toggles open/closed: ObjectCreate + BlockPosition)`);
  const m2 = p.mark(); p.send({ id: D.LeftClick, x: d.x, y: d.y, counter: 0 } as ClientPacket); await p.sleep(1500);
  c.ok(p.since(m2).some(r => r.name === 'ObjectCreate'), 'a second click toggles it back');
  c.fixture('door-open-close', p, 0);
});

step('MOV-11', async c => {
  if (!c.own) c.blocked('needs the own character');
  const f = loadMap(753)!;
  // a walkable tile with a water tile next to it
  let shore: [number, number, number] | undefined;
  for (let y = 2; y < 100 && !shore; y++) for (let x = 2; x < 100 && !shore; x++) if (walkable(f.map, x, y)) for (const [h, [dx, dy]] of Object.entries(HEAD)) if (isWater(f.map, x + dx, y + dy)) { shore = [x, y, Number(h)]; break; }
  if (!shore) c.blocked('no shore tile found on map 753');
  await relocate(c, 753, shore![0], shore![1]);
  const p = c.player, r = await p.step(shore![2], 300);
  c.ok(!r.moved, `walking into water at ${shore![0] + HEAD[shore![2]]![0]},${shore![1] + HEAD[shore![2]]![1]} without a boat was refused (stayed at ${p.x},${p.y})`);
});
