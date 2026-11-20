// Records the items scenarios against the VB6 server into tests/fixtures/vb6/items/*.jsonl.
// Usage: AO_EMAIL=items@local.test AO_PASSWORD=itemspw1 node tools/real-server/items-record.mjs
// AGPL-3.0-or-later. One session, one account; a newbie cannot drop or sell its starter gear, so those
// scenarios record the server's refusal (LocaleMsg).
import { Vb6Session, IC, sleep, walkNear } from './items-session.mjs';
const dir = new URL('../../tests/fixtures/vb6/items/', import.meta.url).pathname;
const s = new Vb6Session({ email: process.env.AO_EMAIL ?? 'items@local.test', password: process.env.AO_PASSWORD ?? 'itemspw1' });
setTimeout(() => { console.error('timeout'); process.exit(2); }, 170000);
await s.login();
s.save(`${dir}login.jsonl`);
const scenario = async (name, steps) => {
  const from = s.records.length;
  for (const [packet, wait = 1000] of steps) { s.send(packet()); await sleep(wait); }
  s.save(`${dir}${name}.jsonl`, from); console.log(name, s.records.length - from, 'frames');
};
const c = n => s.nextCounter(n);
await scenario('use-items', [
  [() => ({ id: IC.UseItemU, slot: 4, counter: c('useItemU') })],                                 // apple, key
  [() => ({ id: IC.UseItem, slot: 7, fromInventory: true, counter: c('useItem') })],               // strength potion, click
  [() => ({ id: IC.UseItemU, slot: 6, counter: c('useItemU') })],                                  // agility potion, key
]);
await scenario('equip-unequip', [
  [() => ({ id: IC.EquipItem, slot: 15, skin: false, counter: c('equip') })],                      // armour off
  [() => ({ id: IC.EquipItem, slot: 15, skin: false, counter: c('equip') })],                      // armour on
  [() => ({ id: IC.EquipItem, slot: 8, skin: false, counter: c('equip') })],                       // sword on
  [() => ({ id: IC.EquipItem, slot: 8, skin: false, counter: c('equip') })],                       // sword off
]);
await scenario('drop-pickup', [
  [() => ({ id: IC.Drop, slot: 4, amount: 3, counter: c('drop'), x: s.pos.x, y: s.pos.y })],       // newbie item: refused
  [() => ({ id: IC.PickUp, x: s.pos.x, y: s.pos.y, slot: 0 })],                                     // nothing on the tile
  [() => ({ id: IC.Drop, slot: 200, amount: 10, counter: c('drop'), x: s.pos.x, y: s.pos.y })],     // gold, none held
]);
const merchant = [...s.chars.values()].find(ch => ch.name.startsWith('Joseph'));
await walkNear(s, merchant.x, merchant.y, 2);
await scenario('npc-shop', [
  [() => ({ id: IC.LeftClick, x: merchant.x, y: merchant.y, counter: c('leftClick') }), 1500],
  [() => ({ id: IC.CommerceBuy, slot: 1, amount: 1 })],                                            // no gold
  [() => ({ id: IC.CommerceSell, slot: 3, amount: 2 })],                                           // refused
  [() => ({ id: IC.CommerceEnd })],
]);
s.close(); setTimeout(() => process.exit(0), 300);
