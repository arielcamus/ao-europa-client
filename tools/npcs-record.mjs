// AGPL-3.0-or-later. Records a real session against the classic VB6 server as a fixture.
// Usage: node tools/npcs-record.mjs --email e --password p --out tests/fixtures/vb6/npcs/x.jsonl \
//          [--host 127.0.0.1] [--port 7667] [--script "wait:3000,walk:2,click-npc,click:50,40"]
// Script steps: wait:<ms> | walk:<heading 1-4> | click:<x>,<y> | click-npc | click-self | click-player | click-empty | say:<text>
// Fixture line: {"t_ms","dir":"c2s"|"s2c","id","name","hex"}; hex is the frame body (id included, length prefix excluded).
import net from 'node:net';
import fs from 'node:fs';
import { FrameDecoder, decodeServerPacket, encodeClientFrame, ClientPacketId as C } from '../packages/protocol/dist/index.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((out, v, i, all) => (v.startsWith('--') ? [...out, [v.slice(2), all[i + 1]]] : out), []));
const { email, password, out } = args;
if (!email || !password || !out) throw new Error('--email --password --out are required');
const host = args.host ?? '127.0.0.1', port = Number(args.port ?? 7667);
const script = (args.script ?? 'wait:8000').split(',').reduce((steps, part) => {
  // "click:50,40" contains a comma: glue a bare number back onto the previous click.
  if (/^\d+$/.test(part) && steps.at(-1)?.startsWith('click:')) steps[steps.length - 1] += `,${part}`; else steps.push(part);
  return steps;
}, []);

const names = new Map();
try {
  const text = fs.readFileSync(`${process.env.HOME}/Projects/ao-reference/argentum-online-client-classic/CODIGO/PacketId.bas`, 'latin1');
  const enumText = /Enum ServerPacketID(.*?)End Enum/s.exec(text)[1];
  enumText.split(/\r?\n/).map(l => l.split("'")[0].trim()).filter(l => l && !l.startsWith('#')).forEach((n, i) => names.set(i, n.replace(/^e/, '')));
} catch { /* names stay Unknown<id> */ }
const clientNames = { 73: 'LoginExistingChar', 75: 'Talk', 78: 'Walk', 79: 'RequestPositionUpdate', 95: 'LeftClick', 305: 'LoginAccount' };

const lines = [];
const t0 = Date.now();
const record = (dir, body) => {
  const id = body.readInt16LE(0);
  lines.push(JSON.stringify({ t_ms: Date.now() - t0, dir, id, name: (dir === 's2c' ? names.get(id) : clientNames[id]) ?? `Unknown${id}`, hex: (dir === 'c2s' && (id === 304 || id === 305) ? body.subarray(0, 2) : body).toString('hex') })); // credentials redacted (docs/CONFORMANCE.md)
};
const socket = net.connect(port, host);
const decoder = new FrameDecoder();
const chars = new Map();
let selfIndex, selfPos, phase = 'connecting', walkInterval = 300, walkCounter = 0, clickCounter = 0, talkCounter = 0;
const sendPacket = packet => { const frame = Buffer.from(encodeClientFrame(packet)); record('c2s', frame.subarray(2)); socket.write(frame); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = message => console.log(`[npcs-record] ${message}`);

async function run() {
  while (phase !== 'playing') await sleep(100);
  await sleep(1500);
  for (const step of script) {
    const [name, rest = ''] = [step.slice(0, step.indexOf(':') < 0 ? undefined : step.indexOf(':')), step.includes(':') ? step.slice(step.indexOf(':') + 1) : ''];
    if (name === 'wait') await sleep(Number(rest));
    else if (name === 'walk') { sendPacket({ id: C.Walk, heading: Number(rest), counter: ++walkCounter }); sendPacket({ id: C.RequestPositionUpdate }); await sleep(walkInterval + 80); }
    else if (name === 'say') { sendPacket({ id: C.Talk, message: rest, counter: ++talkCounter }); await sleep(700); }
    else if (name.startsWith('click')) {
      let [x, y] = rest.split(',').map(Number);
      const near = filter => [...chars.values()].filter(c => c.charIndex !== selfIndex && filter(c))
        .sort((a, b) => Math.hypot(a.x - selfPos.x, a.y - selfPos.y) - Math.hypot(b.x - selfPos.x, b.y - selfPos.y))[0];
      const target = name === 'click-npc' ? near(c => c.npc > 0) : name === 'click-player' ? near(c => c.npc === 0)
        : name === 'click-self' ? chars.get(selfIndex) : name === 'click-empty' ? { x: selfPos.x + 5, y: selfPos.y + 5 } : { x, y };
      if (!target) { log(`${step}: nobody to click`); continue; }
      log(`${step} -> ${target.x},${target.y} ${target.name ?? ''}`);
      sendPacket({ id: 95, x: target.x, y: target.y, counter: ++clickCounter });
      await sleep(1500);
    }
  }
  await sleep(1500);
  socket.end();
}
socket.on('data', bytes => {
  for (const body of decoder.push(new Uint8Array(bytes))) {
    const buffer = Buffer.from(body); record('s2c', buffer);
    const packet = decodeServerPacket(body);
    if ('unknown' in packet) continue;
    if (packet.id === 1) { sendPacket({ id: C.LoginAccount, email, password }); phase = 'account'; }
    else if (packet.id === 199) { const first = packet.characters[0]; sendPacket({ id: C.LoginExistingChar, charId: first.id, name: first.name }); phase = 'login'; }
    else if (packet.id === 158) walkInterval = packet.walk;
    else if (packet.id === 42) { chars.set(packet.charIndex, packet); if (packet.charIndex === selfIndex) selfPos = packet; }
    else if (packet.id === 43) chars.delete(packet.charIndex);
    else if (packet.id === 44 || packet.id === 187) { const c = chars.get(packet.charIndex); if (c) { c.x = packet.x; c.y = packet.y; } if (packet.charIndex === selfIndex) selfPos = chars.get(selfIndex) ?? packet; }
    else if (packet.id === 47) { selfIndex = packet.charIndex; selfPos = chars.get(selfIndex); }
    else if (packet.id === 31) { selfPos = { x: packet.x, y: packet.y }; }
    else if (packet.id === 30) chars.clear();
    else if (packet.id === 2) { phase = 'playing'; selfPos ??= chars.get(selfIndex); log(`logged in, ${chars.size} chars known, self ${selfIndex} at ${selfPos?.x},${selfPos?.y}`); }
  }
});
socket.on('close', () => { if (!lines.length) { log('no frames: the server never answered (paused in the IDE?); nothing written'); process.exit(2); } fs.mkdirSync(out.replace(/[^/]+$/, ''), { recursive: true }); fs.writeFileSync(out, `${lines.join('\n')}\n`); log(`wrote ${lines.length} frames to ${out}`); process.exit(0); });
socket.on('error', error => { log(`error ${error.message}`); process.exit(1); });
setTimeout(() => { log('timeout'); socket.destroy(); }, Number(args.timeout ?? 90_000));
run().catch(error => { log(String(error)); socket.destroy(); });
