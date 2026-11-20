// AGPL-3.0-or-later. Opt-in checks against the running real local server.
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { ClientPacketId as C, ServerPacketId as S, FrameDecoder, encodeClientFrame, decodeServerPacket } from '../../packages/protocol/dist/index.js';

const { AO_EMAIL: email, AO_PASSWORD: password } = process.env;
assert(email && password, 'Set AO_EMAIL and AO_PASSWORD');
const socket = createConnection({ host: '127.0.0.1', port: Number(process.env.AO_PORT ?? 17666) });
const decoder = new FrameDecoder();
let packets = [], failure, closed = false;
socket.on('error', error => { failure = error; });
socket.on('close', () => { closed = true; });
socket.on('data', data => {
  try { packets.push(...decoder.push(data).map(decodeServerPacket)); }
  catch (error) { failure = error; }
});
const send = packet => socket.write(encodeClientFrame(packet));
async function next(id) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    const index = packets.findIndex(packet => packet.id === id);
    if (index >= 0) return packets.splice(0, index + 1).at(-1);
    assert(!closed, `Server closed before packet ${id}`);
    await delay(10);
  }
  throw new Error(`Timed out waiting for packet ${id}`);
}
try {
  await next(S.Connected);
  send({ id: C.LoginExistingChar, charId: 1, name: 'Macwalker' });
  assert.match((await next(S.ErrorMsg)).message, /Authenticate first/);
  send({ id: C.LoginAccount, email, password: password + '-wrong' });
  assert.match((await next(S.ErrorMsg)).message, /Invalid account credentials/);
  send({ id: C.LoginAccount, email, password });
  const character = (await next(S.AccountCharacterList)).characters[0];
  assert(character, 'Account needs an existing character');
  send({ id: C.LoginExistingChar, charId: character.id + 1_000_000, name: character.name });
  assert.match((await next(S.ErrorMsg)).message, /does not belong/);
  send({ id: C.LoginExistingChar, charId: character.id, name: character.name });
  const initial = await next(S.PosUpdate);
  const intervals = await next(S.Intervals);
  let position = initial, counter = 0;
  async function walk(heading) {
    await delay(Math.max(intervals.walk + 75, 300));
    packets = [];
    send({ id: C.Walk, heading, counter: ++counter });
    await delay(75);
    // Discard any immediate correction; the explicit query is authoritative.
    packets = [];
    send({ id: C.RequestPositionUpdate });
    return next(S.PosUpdate);
  }
  let northSteps = 0, collision;
  for (let i = 0; i < 40; i++) {
    const nextPosition = await walk(1);
    if (nextPosition.x === position.x && nextPosition.y === position.y) {
      collision = { at: { x: position.x, y: position.y }, attempted: { x: position.x, y: position.y - 1 } };
      break;
    }
    assert.equal(nextPosition.x, position.x);
    assert.equal(nextPosition.y, position.y - 1);
    northSteps++;
    position = nextPosition;
  }
  assert(collision, 'Expected an actual blocked tile within 40 northward steps');
  for (let i = 0; i < northSteps; i++) position = await walk(3);
  assert.deepEqual(position, initial, 'Walk back to the persisted starting position');
  packets = [];
  send({ id: C.Walk, heading: 2, counter });
  assert.match((await next(S.ErrorMsg)).message, /Packet replay detected/);
  for (let i = 0; i < 100 && !closed; i++) await delay(20);
  assert(closed, 'Replay must disconnect through the normal anti-cheat path');
  console.log(JSON.stringify({
    server: 'lambdaclass/argentum + classic adapter',
    unauthenticatedLoginRejected: true, wrongPasswordRejected: true,
    unownedCharacterRejected: true, duplicateWalkCounterDisconnected: true,
    acceptedNorthSteps: northSteps, collision, returnedTo: { x: initial.x, y: initial.y },
  }, null, 2));
} finally { socket.destroy(); }
