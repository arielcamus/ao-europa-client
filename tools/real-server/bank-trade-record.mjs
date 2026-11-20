// Records the bank scenarios against the VB6 server into tests/fixtures/vb6/bank/*.jsonl (AO_EMAIL / AO_PASSWORD: any level-1 test account, e.g. TItems).
// AGPL-3.0-or-later. These two scenarios were recorded from the street (77,56), 9 tiles from the banker Krix (77,47), BEFORE the map patch of
// docs/DATA-PATCHES.md let a level-1 character into the hall: deposit, extract and vault moves reach the server from there (distance limit 10), the window-opening
// packets do not. The hall itself is recorded by bank-trade-vault-record.mjs.
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
import { Vb6Session, gotoTile, sleep, DC, BC } from './bank-trade-session.mjs';
const dir = new URL('../../tests/fixtures/vb6/bank/', import.meta.url).pathname;
const s = new Vb6Session({ email: need('AO_EMAIL'), password: need('AO_PASSWORD') });
setTimeout(() => { console.error('timeout'); process.exit(2); }, 170000);
await s.login();
await gotoTile(s, [77, 56], { maxSteps: 200 });
const krix = [...s.chars.values()].find(c => c.name.startsWith('Krix'));
const scenario = async (name, steps) => {
  const from = s.records.length;
  for (const [packet, wait = 900] of steps) { s.send(packet()); await sleep(wait); }
  s.save(`${dir}${name}.jsonl`, from); console.log(name, s.records.length - from, 'frames');
};
await scenario('far-from-banker', [
  [() => ({ id: BC.BankStart })],                                                                 // no target yet
  [() => ({ id: DC.LeftClick, x: krix.x, y: krix.y, counter: s.nextCounter('leftClick') }), 1800], // target Krix (9 tiles away)
  [() => ({ id: BC.BankStart })],                                                                 // limit 6: too far
  [() => ({ id: BC.BankDepositGold, amount: 100 })],                                              // no gold
  [() => ({ id: BC.BankExtractGold, amount: 100 })],                                              // empty account
  [() => ({ id: BC.RequestAccountState })],
  [() => ({ id: BC.BankEnd })],                                                                   // not trading: ignored
]);
await scenario('deposit-move-extract', [
  [() => ({ id: BC.BankDeposit, slot: 3, amount: 1, destination: 0 })],                           // 3791 x1 into the first free vault slot
  [() => ({ id: BC.BankDeposit, slot: 3, amount: 1, destination: 7 })],                           // 3791 x1 into vault slot 7 (explicit destination)
  [() => ({ id: BC.BovedaMoveItem, from: 1, to: 5 })],                                            // move to an empty slot
  [() => ({ id: BC.BovedaMoveItem, from: 5, to: 7 })],                                            // swap with the item in slot 7: they stack apart, tags equal
  [() => ({ id: BC.BankExtractItem, slot: 5, amount: 1, destination: 0 })],                       // withdraw to the first free inventory slot
  [() => ({ id: BC.BankExtractItem, slot: 7, amount: 1, destination: 0 })],                       // and the other one: the vault is empty again
  [() => ({ id: BC.BankExtractItem, slot: 7, amount: 1, destination: 0 })],                       // empty slot: ignored
  [() => ({ id: BC.BankDeposit, slot: 8, amount: 1, destination: 0 })],                           // the equipped starter weapon: newbie, refused
]);
console.log('inventory slot 3:', s.inventory.get(3));
s.close(); setTimeout(() => process.exit(0), 300);
