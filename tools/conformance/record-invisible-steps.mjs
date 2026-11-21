// AGPL-3.0-or-later. Records PlayWaveStep (188) from the real VB6 server: two NON-GM sessions on the same map, the walker drinks an
// invisibility potion (OBJ1096, TipoPocion 10) and walks at a Manhattan distance > DISTANCIA_ENVIO_DATOS (3) from the watcher, who then
// gets WritePlayWaveStep (Modulo_UsUaRiOs.MoveUserChar) instead of a position; within 3 tiles the server sends PosUpdateChar instead.
// Usage: AO_WATCH_EMAIL AO_WATCH_PASSWORD AO_WATCH_CHAR_ID AO_WATCH_CHAR AO_WALK_EMAIL AO_WALK_PASSWORD AO_WALK_CHAR_ID AO_WALK_CHAR
//        AO_WALK_POTION_SLOT [AO_ASSETS] node tools/conformance/record-invisible-steps.mjs <watcher.jsonl> [walker.jsonl]
// The potion must already be in the walker's inventory (a DB UPDATE on the logged-out character, see docs/CONFORMANCE.md).
import { Recorder } from './vb6-record.mjs';
import { makeWalker, mapBlocked } from './helpers.mjs';
import { i32, str } from './wire.mjs';

const need = k => process.env[k] ?? (() => { throw new Error(`Set ${k} (no defaults: use throw-away @local.test accounts)`); })();
const [, , watchOut, walkOut] = process.argv;
if (!watchOut) throw new Error('usage: record-invisible-steps.mjs <watcher.jsonl> [walker.jsonl]');
const host = process.env.AO_HOST ?? '127.0.0.1', port = Number(process.env.AO_PORT ?? 7667);

async function login(prefix) {
  const rec = new Recorder(host, port);
  await rec.wait(r => r.id === 1);
  rec.send(305, [...str(need(`${prefix}_EMAIL`)), ...str(need(`${prefix}_PASSWORD`))]);
  await rec.wait(r => r.id === 199);
  rec.send(73, [...i32(Number(need(`${prefix}_CHAR_ID`))), ...str(need(`${prefix}_CHAR`))]);
  await rec.wait(r => r.id === 2); await rec.sleep(1500);
  return rec;
}
const selfPos = rec => {
  const self = Buffer.from(rec.records.find(r => r.name === 'UserCharIndexInServer').hex, 'hex').readInt16LE(2);
  const cc = rec.records.filter(r => r.name === 'CharacterCreate').map(r => Buffer.from(r.hex, 'hex')).find(b => b.readInt16LE(2) === self);
  return { map: Buffer.from(rec.records.filter(r => r.name === 'ChangeMap').at(-1).hex, 'hex').readInt16LE(2), x: cc[9], y: cc[10] };
};

const watch = await login('AO_WATCH');
let walk;
try {
  walk = await login('AO_WALK');
  const wp = selfPos(watch), kp = selfPos(walk);
  console.log('watcher', wp, 'walker', kp);
  if (wp.map !== kp.map) throw new Error('both characters must be on the same map');
  // UseItem(slot, fromInventory, counter): the potion sets flags.invisible and the area gets SetInvisible.
  const mark = walk.records.length;
  walk.send(99, [Number(need('AO_WALK_POTION_SLOT')), 1, ...i32(1)]);
  await walk.wait(r => r.name === 'SetInvisible' && walk.records.indexOf(r) >= mark, 5000);
  await walk.sleep(4500); // Counters.timeFx must be 0 (no chat either) for the step to be sent
  const w = makeWalker(walk, mapBlocked(kp.map));
  w.pos = [kp.x, kp.y];
  // Out to 6 tiles east of the watcher (Manhattan > 3: PlayWaveStep), then back to 2 tiles (PosUpdateChar), then out again.
  for (const target of [[wp.x + 6, wp.y], [wp.x + 2, wp.y], [wp.x + 6, wp.y]]) console.log('goto', target, await w.goto(target));
  await walk.sleep(1000);
  const steps = watch.records.filter(r => r.id === 188).length;
  console.log(`watcher got ${steps} PlayWaveStep`);
} finally {
  for (const [rec, out] of [[watch, watchOut], [walk, walkOut]]) {
    if (!rec) continue;
    rec.send(39); await rec.sleep(300); // Quit: a safe map logs out at once
    if (out) { rec.save(out); console.log(`saved ${rec.records.length} packets to ${out}`); }
    rec.close();
  }
}
