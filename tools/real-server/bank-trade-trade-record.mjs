// Records player-to-player trade between two characters into tests/fixtures/vb6/trade/<scenario>-initiator|responder.jsonl.
// AGPL-3.0-or-later. A = AO_A_EMAIL / AO_A_PASSWORD, B = AO_B_EMAIL / AO_B_PASSWORD (two level-1 test accounts on map 1).
// Flow (HandleCommerceStart / IniciarComercioConUsuario / HandleResponderPregunta case 4): A targets B (LeftClick), sends /COMERCIAR;
// B gets a ShowPregunta and answers yes; both get UserCommerceInit; offers -> ChangeUserTradeSlot; both UserCommerceOk swaps the goods.
// The scenarios leave the characters as they were (the item goes back and forth).
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
import { Vb6Session, gotoTile, sleep, DC, BC } from './bank-trade-session.mjs';
const dir = new URL('../../tests/fixtures/vb6/trade/', import.meta.url).pathname;
const a = new Vb6Session({ email: need('AO_A_EMAIL'), password: need('AO_A_PASSWORD') });
const b = new Vb6Session({ email: need('AO_B_EMAIL'), password: need('AO_B_PASSWORD') });
setTimeout(() => { console.error('timeout'); process.exit(2); }, 240000);
await Promise.all([a.login(), b.login()]);
const target = [a.pos.x + 1, a.pos.y];
console.log('A at', a.pos, 'B at', b.pos, 'B goes to', target);
await gotoTile(b, target, { maxSteps: 300 });
await sleep(800);
const mark = () => [a.records.length, b.records.length];
let m = mark();
const save = name => { a.save(`${dir}${name}-initiator.jsonl`, m[0]); b.save(`${dir}${name}-responder.jsonl`, m[1]); console.log(name, a.records.length - m[0], b.records.length - m[1], 'frames'); m = mark(); };
const click = (s, other) => s.send({ id: DC.LeftClick, x: other.pos.x, y: other.pos.y, counter: s.nextCounter('leftClick') });
const start = async () => {
  click(a, b); await sleep(1800); click(b, a); await sleep(1800);   // each targets the other (the responder's own target is set by the server on the request)
  a.send({ id: BC.CommerceStart }); await sleep(900);
  b.send({ id: BC.ResponderPregunta, accept: true }); await sleep(1200);
};

// 1. Full trade: both offer, chat, both accept; then the same trade backwards so both characters end as they began.
click(a, b); await sleep(1800); click(b, a); await sleep(1800); m = mark();
a.send({ id: BC.CommerceStart }); await sleep(900);
b.send({ id: BC.ResponderPregunta, accept: true }); await sleep(1200);
a.send({ id: BC.UserCommerceOffer, slot: 3, amount: 1 }); await sleep(900);                 // 3791 x1
a.send({ id: BC.UserCommerceOffer, slot: 200, amount: 5 }); await sleep(900);                // gold slot: no gold, refused
b.send({ id: BC.UserCommerceOffer, slot: 4, amount: 2 }); await sleep(900);                  // 3684 x2
a.send({ id: BC.CommerceSendChatMessage, message: 'hola' }); await sleep(900);
a.send({ id: BC.UserCommerceOk }); await sleep(900);                                        // first accept: the other has not accepted yet
b.send({ id: BC.UserCommerceOk }); await sleep(1500);                                       // second accept: goods swap
save('offer-and-accept');
// 2. Reject.
a.send({ id: BC.CommerceStart }); await sleep(900);
b.send({ id: BC.ResponderPregunta, accept: true }); await sleep(1200);
b.send({ id: BC.UserCommerceOffer, slot: 3, amount: 1 }); await sleep(900);                 // the 3791 he received goes back on offer
b.send({ id: BC.UserCommerceReject }); await sleep(1200);
save('reject');
// 3. The other player declines the invitation.
a.send({ id: BC.CommerceStart }); await sleep(900);
b.send({ id: BC.ResponderPregunta, accept: false }); await sleep(1200);
save('invitation-declined');
// 4. Cancel from the window (UserCommerceEnd), then give the goods back with a last trade.
a.send({ id: BC.CommerceStart }); await sleep(900);
b.send({ id: BC.ResponderPregunta, accept: true }); await sleep(1200);
a.send({ id: BC.UserCommerceEnd }); await sleep(1200);
save('cancel');
a.send({ id: BC.CommerceStart }); await sleep(900);
b.send({ id: BC.ResponderPregunta, accept: true }); await sleep(1200);
b.send({ id: BC.UserCommerceOffer, slot: 3, amount: 1 }); await sleep(900);
b.send({ id: BC.UserCommerceOffer, slot: 4, amount: 2 }); await sleep(900);
a.send({ id: BC.UserCommerceOk }); await sleep(600); b.send({ id: BC.UserCommerceOk }); await sleep(1500);
save('give-back');
console.log('A', [...a.inventory.values()].filter(i => [3, 4].includes(i.slot)).map(i => `${i.slot}:${i.object}x${i.amount}`), 'B', [...b.inventory.values()].filter(i => [3, 4].includes(i.slot)).map(i => `${i.slot}:${i.object}x${i.amount}`));
a.close(); b.close(); setTimeout(() => process.exit(0), 400);
