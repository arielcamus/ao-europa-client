// Records one scripted session against the classic VB6 server as a fixture (one JSON line per frame body).
// Usage: pnpm --filter @ao/protocol build && AO_EMAIL=.. AO_PASSWORD=.. AO_OUT=tests/fixtures/vb6/<feature>/<scenario>.jsonl \
//   AO_STEPS="wait:4000;list;walk:2;wait:400;attack;wait:1500;say:/RESUCITAR" node tools/real-server/vb6-record.mjs
// Steps: safe (SafeToggle, id 82) | wait:ms | list | walk:H(1N 2E 3S 4W) | attack | attacks:n:gapMs | say:text | click:x,y | dump:id (print frames with that id)
// Frame line: {"t_ms":<since connect>,"dir":"c2s"|"s2c","id":<int>,"name":"<PacketName>","hex":"<frame body hex>"}
import net from 'node:net';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ClientPacketId as C, CombatClientPacketId as CC, CombatServerPacketId as CS, ServerPacketId as S, FrameDecoder,
  decodeServerPacket, encodeClientFrame,
} from '../../packages/protocol/dist/index.js';

const env = process.env;
const host = env.AO_HOST ?? '127.0.0.1', port = Number(env.AO_PORT ?? 7667);
const email = env.AO_EMAIL, password = env.AO_PASSWORD, out = env.AO_OUT;
const steps = (env.AO_STEPS ?? 'wait:4000;list').split(';').filter(Boolean);
if (!email || !password) throw new Error('Set AO_EMAIL and AO_PASSWORD');
const names = { ...Object.fromEntries(Object.entries(S).filter(([k]) => isNaN(k)).map(([k, v]) => [`s${v}`, k])),
  ...Object.fromEntries(Object.entries(CS).filter(([k]) => isNaN(k)).map(([k, v]) => [`s${v}`, k])) };
const cnames = { ...Object.fromEntries(Object.entries(C).filter(([k]) => isNaN(k)).map(([k, v]) => [`c${v}`, k])),
  ...Object.fromEntries(Object.entries(CC).filter(([k]) => isNaN(k)).map(([k, v]) => [`c${v}`, k])) };
const sock = net.connect(port, host), decoder = new FrameDecoder(), lines = [];
const t0 = Date.now();
const log = m => console.log(`[rec +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
let intervals, selfChar, selfPos, walkCounter = 0, attackCounter = 0, talkCounter = 0, clickCounter = 0, logged = false, stage = 0;
const npcs = new Map();
const hex = body => Buffer.from(body).toString('hex');
const sendPacket = packet => {
  const frame = encodeClientFrame(packet);
  const body = frame.subarray(2);
  lines.push({ t_ms: Date.now() - t0, dir: 'c2s', id: packet.id, name: cnames[`c${packet.id}`] ?? 'Unknown', hex: hex(packet.id === 304 || packet.id === 305 ? body.subarray(0, 2) : body) }); // credentials redacted (docs/CONFORMANCE.md)
  sock.write(frame);
};
sock.on('data', chunk => {
  for (const body of decoder.push(chunk)) {
    const id = new DataView(body.buffer, body.byteOffset).getInt16(0, true);
    const packet = decodeServerPacket(body);
    lines.push({ t_ms: Date.now() - t0, dir: 's2c', id, name: names[`s${id}`] ?? (S[id] ?? 'Unknown'), hex: hex(body) });
    if ('unknown' in packet) continue;
    switch (packet.id) {
      case S.Connected: sendPacket({ id: C.LoginAccount, email, password }); break;
      case S.AccountCharacterList: {
        const first = packet.characters[0];
        if (!first) throw new Error('no character'); log(`login ${first.name}`);
        sendPacket({ id: C.LoginExistingChar, charId: first.id, name: first.name }); break;
      }
      case S.Intervals: intervals = packet; break;
      case S.UserCharIndexInServer: selfChar = packet.charIndex; if (npcs.has(selfChar)) selfPos = { x: npcs.get(selfChar).x, y: npcs.get(selfChar).y }; break;
      case S.Logged: logged = true; log('logged'); break;
      case S.CharacterCreate:
        npcs.set(packet.charIndex, packet);
        if (packet.charIndex === selfChar) selfPos = { x: packet.x, y: packet.y };
        break;
      case S.PosUpdate: selfPos = { x: packet.x, y: packet.y }; break;
      case S.CharacterMove: case S.PosUpdateChar: case S.PosUpdateUserChar:
        if (packet.charIndex === selfChar) selfPos = { x: packet.x, y: packet.y };
        if (npcs.has(packet.charIndex)) npcs.set(packet.charIndex, { ...npcs.get(packet.charIndex), x: packet.x, y: packet.y });
        break;
      case S.ErrorMsg: log(`ErrorMsg ${packet.message}`); break;
      case S.ConsoleMsg: log(`Console: ${packet.message}`); break;
      case CS.LocaleMsg: log(`Locale ${packet.messageId} "${packet.text}" font=${packet.font} ch=${packet.channel}`); break;
      case CS.CharacterRemove: npcs.delete(packet.charIndex); log(`CharacterRemove ${packet.charIndex}`); break;
      case CS.NPCHitUser: case CS.CharSwing: case CS.CharAtaca: case CS.CreateFX: case CS.TextOverChar:
      case CS.UserHittedUser: case CS.UserHittedByUser: case CS.CharacterChange: case S.UpdateHP: case CS.ArmaMov:
        log(`${names[`s${packet.id}`] ?? packet.id} ${JSON.stringify(packet)}`); break;
    }
  }
});
sock.on('error', e => { log(`error ${e.message}`); process.exit(1); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function run() {
  while (!logged || !selfPos || !intervals) await sleep(200);
  await sleep(1500);
  log(`self ${selfChar} at ${JSON.stringify(selfPos)} intervals ${JSON.stringify(intervals)}`);
  for (const step of steps) {
    const [cmd, ...rest] = step.split(':'), arg = rest.join(':');
    if (cmd === 'wait') await sleep(Number(arg));
    else if (cmd === 'list') for (const c of npcs.values()) log(`char ${c.charIndex} "${c.name}" npc=${c.npc} num=${c.npcNumber} body=${c.body} at ${c.x},${c.y} hp=${c.minHp}/${c.maxHp}`);
    else if (cmd === 'walk') { sendPacket({ id: C.Walk, heading: Number(arg), counter: ++walkCounter }); sendPacket({ id: C.RequestPositionUpdate }); await sleep(intervals.walk + 150); log(`pos ${JSON.stringify(selfPos)}`); }
    else if (cmd === 'attack') sendPacket({ id: CC.Attack, counter: ++attackCounter });
    else if (cmd === 'attacks') { const [n, gap] = arg.split(':').map(Number); for (let i = 0; i < n; i++) { sendPacket({ id: CC.Attack, counter: ++attackCounter }); await sleep(gap); } }
    else if (cmd === 'say') sendPacket(arg.toUpperCase().startsWith('/RESUCITAR') ? { id: CC.Resucitate } : arg.toUpperCase().startsWith('/CURAR') ? { id: CC.Heal } : { id: C.Talk, message: arg, counter: ++talkCounter });
    else if (cmd === 'safe') { const body = Buffer.from([82, 0]); lines.push({ t_ms: Date.now() - t0, dir: 'c2s', id: 82, name: 'SafeToggle', hex: body.toString('hex') }); sock.write(Buffer.from([2, 0, 82, 0])); }
    else if (cmd === 'click') { const [x, y] = arg.split(',').map(Number); sendPacket({ id: CC.LeftClick, x, y, counter: ++clickCounter }); }
    else throw new Error(`unknown step ${step}`);
  }
  await sleep(1500);
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, lines.map(l => JSON.stringify(l)).join('\n') + '\n'); log(`wrote ${lines.length} frames to ${out}`); }
  sock.destroy(); process.exit(0);
}
run().catch(e => { log(`failed ${e.stack}`); process.exit(1); });
setTimeout(() => { log('timeout'); process.exit(2); }, 120_000);
