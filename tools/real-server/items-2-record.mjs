// Records the wp04 scenarios (key ring, item moving, delete, papyrus) against the VB6 server into tests/fixtures/vb6/items-2/*.jsonl.
// Needs: account is a patron tier (account.is_active_patron = 6057393) and house_key rows 54 and 65 for it, TItems at map 1 (60,24) for
// SCENE=door and (42,53) for SCENE=board, slot 16 holding 20 apples. See docs/DATA-PATCHES.md (wp04 section) for the exact UPDATEs and undo.
// Usage: SCENE=door|board AO_EMAIL=items@local.test AO_PASSWORD=itemspw1 node tools/real-server/items-2-record.mjs
// AGPL-3.0-or-later. Counters are the session helper's per-family counters (one per socket, like the client's PacketCounters).
import { Vb6Session, C, sleep } from './items-session.mjs';
import { DoorClientPacketId as D, KeyringClientPacketId as K } from '../../packages/protocol/dist/index.js';
const dir = new URL('../../tests/fixtures/vb6/items-2/', import.meta.url).pathname;
const scene = process.env.SCENE ?? 'door';
const s = new Vb6Session({ email: process.env.AO_EMAIL ?? 'items@local.test', password: process.env.AO_PASSWORD ?? 'itemspw1' });
setTimeout(() => { console.error('timeout'); process.exit(2); }, 120000);
await s.login();
const scenario = async (name, steps) => {
  const from = s.records.length;
  for (const [packet, wait = 1200] of steps) { s.send(packet()); await sleep(wait); }
  s.save(`${dir}${name}.jsonl`, from); console.log(name, s.records.length - from, 'frames');
};
const c = n => s.nextCounter(n);
const click = (x, y) => () => ({ id: D.LeftClick, x, y, counter: c('leftClick') });
if (scene === 'door') {
  s.save(`${dir}login-keys.jsonl`);
  // The locked door "Puerta 1" (object 53, key clave 2) at map 1 (60,23); key slot 1 is object 54 (clave 2), slot 2 is object 65 (clave 4).
  await scenario('use-key-no-target', [[() => ({ id: K.UseKey, slot: 1 })]]);
  await scenario('use-key-locked-door', [
    [click(60, 23), 1800],                                   // locked: the server says so and targets the door
    [() => ({ id: K.UseKey, slot: 2 }), 1800],               // wrong key (clave 4)
    [() => ({ id: K.UseKey, slot: 1 }), 1800],               // right key: opens
    [() => ({ id: K.UseKey, slot: 1 }), 1800],               // again: locks it back
    [() => ({ id: K.UseKey, slot: 11 }), 800],               // out of range slot: ignored (and logged by the server)
  ]);
} else {
  await scenario('papiro-sign', [[click(43, 52), 1800]]);   // Cartelera without text: ShowPapiro
  await scenario('move-item', [
    [() => ({ id: K.Moveitem, from: 3, to: 17 })],          // into an empty unlocked slot
    [() => ({ id: K.Moveitem, from: 17, to: 3 })],          // and back
    [() => ({ id: K.Moveitem, from: 2, to: 3 })],           // two different objects swap places
    [() => ({ id: K.Moveitem, from: 3, to: 2 })],
    [() => ({ id: K.Moveitem, from: 1, to: 42 })],          // slot 42: whatever the tier unlocks (a refusal when it is locked)
    [() => ({ id: K.Moveitem, from: 4, to: 4 })],           // same slot: the server merges the stack into itself and EMPTIES the slot (why Inventario_ItemDropped checks Drag <> Drop)
  ]);
  await scenario('delete-item', [
    [() => ({ id: K.DeleteItem, skin: false, slot: 8 })],    // equipped sword: refused
    [() => ({ id: K.DeleteItem, skin: true, slot: 8 })],     // skins: the server has it switched off
    [() => ({ id: K.DeleteItem, skin: false, slot: 16 })],   // 20 apples: deleted
    [() => ({ id: K.DeleteItem, skin: false, slot: 16 })],   // empty now
  ]);
}
s.close(); setTimeout(() => process.exit(0), 300);
