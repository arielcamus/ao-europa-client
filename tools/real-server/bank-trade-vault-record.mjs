// Records the vault and Goliath scenarios INSIDE Ullathorpe's bank hall into tests/fixtures/vb6/bank/*.jsonl (AO_EMAIL / AO_PASSWORD).
// AGPL-3.0-or-later. Needs the server to run with the map patch of docs/DATA-PATCHES.md (castle-entry triggers cleared), otherwise the doorway
// bounces the walker (see tests/fixtures/vb6/buildings/bank-castle-trigger-bounce.jsonl). The west door (77,55) opens with a LeftClick on (76,55).
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
import { Vb6Session, gotoTile, sleep, C, DC, BC } from './bank-trade-session.mjs';
const dir = new URL('../../tests/fixtures/vb6/bank/', import.meta.url).pathname;
const s = new Vb6Session({ email: need('AO_EMAIL'), password: need('AO_PASSWORD') });
setTimeout(() => { console.error('timeout'); process.exit(2); }, 200000);
await s.login();
await gotoTile(s, [77, 56], { maxSteps: 700 });
const door = s.packets.filter(p => p.id === 50 && p.x === 77 && p.y === 55).at(-1);
if (door?.objIndex === 1424) { s.send({ id: DC.LeftClick, x: 76, y: 55, counter: s.nextCounter('leftClick') }); await sleep(2000); }
for (let i = 0; i < 5; i++) { s.send({ id: C.Walk, heading: 1, counter: s.nextCounter('walk') }); s.send({ id: C.RequestPositionUpdate }); await sleep(450); }
if (s.pos.y > 51) throw new Error(`could not enter the bank hall (at ${s.pos.x},${s.pos.y}): is the map patch loaded?`);
const krix = [...s.chars.values()].find(c => c.name.startsWith('Krix'));
const scenario = async (name, steps) => {
  const from = s.records.length;
  for (const [packet, wait = 900] of steps) { s.send(packet()); await sleep(wait); }
  s.save(`${dir}${name}.jsonl`, from); console.log(name, s.records.length - from, 'frames');
};
await scenario('goliath-and-vault', [
  [() => ({ id: DC.LeftClick, x: krix.x, y: krix.y, counter: s.nextCounter('leftClick') }), 1800],   // click the banker: Goliath opens
  [() => ({ id: BC.BankDepositGold, amount: 100 })],                                                  // no gold on hand
  [() => ({ id: BC.BankExtractGold, amount: 100 })],                                                  // nothing in the account
  [() => ({ id: BC.RequestAccountState })],
  [() => ({ id: BC.BankStart })],                                                                     // "Ver bóveda": 42 ChangeBankSlot + BankInit
  [() => ({ id: BC.BankDeposit, slot: 3, amount: 2, destination: 0 })],
  [() => ({ id: BC.BovedaMoveItem, from: 1, to: 9 })],
  [() => ({ id: BC.BankExtractItem, slot: 9, amount: 2, destination: 0 })],
  [() => ({ id: BC.BankEnd })],                                                                       // BankEnd (9) comes back
  [() => ({ id: BC.BankEnd })],                                                                       // already closed: ignored
]);
console.log('inventory slot 3:', s.inventory.get(3)?.amount);
s.close(); setTimeout(() => process.exit(0), 300);
