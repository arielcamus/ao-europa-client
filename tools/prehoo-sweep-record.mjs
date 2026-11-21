// AGPL-3.0-or-later. Records a real session against the pinned pre-HOO VB6 server WITHOUT trusting our codecs: every frame is stored raw,
// then decoded strictly, and each frame that does not decode to exactly its length is reported (the codec sweep, issue: /EST trailing bytes).
// Usage: node tools/prehoo-sweep-record.mjs --email e --password p --out tests/fixtures/vb6/prehoo-sweep/x.jsonl
//          [--create 1 --char Name] [--host 127.0.0.1] [--port 7667] [--script "wait:3000;pkt:{\"id\":52}"]
// Script steps (separated by ';'): wait:<ms> | pkt:<json client packet> | raw:<hex client body, id included> | say:<text> | walk:<1-4>
// Fixture line: {"t_ms","dir":"c2s"|"s2c","id","name","hex"}; hex is the frame body (id included, length prefix excluded); credentials redacted.
import net from 'node:net';
import fs from 'node:fs';
import {
  FrameDecoder, decodeServerFrame, encodeClientFrame, encodeFrame, ClientPacketId as C, SessionClientPacketId as SC, setWireProfile,
} from '../packages/protocol/dist/index.js';

setWireProfile('prehoo');
const args = Object.fromEntries(process.argv.slice(2).reduce((out, v, i, all) => (v.startsWith('--') ? [...out, [v.slice(2), all[i + 1]]] : out), []));
const { email, password, out } = args;
if (!email || !password || !out) throw new Error('--email --password --out are required');
const host = args.host ?? '127.0.0.1', port = Number(args.port ?? 7667);
const script = (args.script ?? 'wait:5000').split(';').filter(Boolean);

const names = new Map();
try {
  const text = fs.readFileSync(`${process.env.HOME}/Projects/ao-reference/argentum-online-client-classic/CODIGO/PacketId.bas`, 'latin1');
  const enumText = /Enum ServerPacketID(.*?)End Enum/s.exec(text)[1];
  enumText.split(/\r?\n/).map(l => l.split("'")[0].trim()).filter(l => l && !l.startsWith('#')).forEach((n, i) => names.set(i, n.replace(/^e/, '')));
} catch { /* names stay Unknown<id> */ }

const lines = [], problems = [];
let concatenated = 0;
const t0 = Date.now();
const record = (dir, body) => {
  const id = body.readInt16LE(0);
  const hex = (dir === 'c2s' && (id === 304 || id === 305) ? body.subarray(0, 2) : body).toString('hex'); // credentials redacted (docs/CONFORMANCE.md)
  lines.push(JSON.stringify({ t_ms: Date.now() - t0, dir, id, name: dir === 's2c' ? (names.get(id) ?? `Unknown${id}`) : `C${id}`, hex }));
};
const socket = net.connect(port, host);
const decoder = new FrameDecoder();
let phase = 'connecting', walkInterval = 300, walkCounter = 0, talkCounter = 0;
const write = body => { const b = Buffer.from(body); record('c2s', b); socket.write(Buffer.from(encodeFrame(new Uint8Array(b)))); };
const sendPacket = packet => { write(Buffer.from(encodeClientFrame(packet)).subarray(2)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = message => console.log(`[prehoo-sweep] ${message}`);

async function run() {
  for (let i = 0; phase !== 'playing'; i++) { if (i > 300) throw new Error(`never reached playing (phase ${phase})`); await sleep(100); }
  await sleep(1500);
  for (const step of script) {
    const at = step.indexOf(':'), name = at < 0 ? step : step.slice(0, at), rest = at < 0 ? '' : step.slice(at + 1);
    if (name === 'wait') await sleep(Number(rest));
    else if (name === 'walk') { sendPacket({ id: C.Walk, heading: Number(rest), counter: ++walkCounter }); await sleep(walkInterval + 80); }
    else if (name === 'say') { sendPacket({ id: C.Talk, message: rest, counter: ++talkCounter }); await sleep(900); }
    else if (name === 'pkt') { sendPacket(JSON.parse(rest)); await sleep(900); }
    else if (name === 'raw') { write(Buffer.from(rest, 'hex')); await sleep(900); }
    else throw new Error(`unknown step ${step}`);
  }
  await sleep(1500);
  socket.end();
}
socket.on('data', bytes => {
  for (const body of decoder.push(new Uint8Array(bytes))) {
    const buffer = Buffer.from(body); record('s2c', buffer);
    let packet, trailing;
    try { ({ packet, trailing } = decodeServerFrame(body)); } catch (error) { problems.push({ id: buffer.readInt16LE(0), hex: buffer.toString('hex'), error: error.message }); continue; }
    if ('unknown' in packet) { problems.push({ id: packet.id, hex: buffer.toString('hex'), error: 'no codec' }); continue; }
    if (trailing.length) {
      const extra = Buffer.from(trailing).toString('hex');
      // The pinned server's WriteConsoleMsg(PrepareMessageLocaleMsg(...)): an empty ConsoleMsg after a LocaleMsg is expected, not a codec bug.
      if (!(packet.id === 141 && /^250000[0-9a-f]{2}$/.test(extra))) problems.push({ id: packet.id, hex: buffer.toString('hex'), error: `${trailing.length} trailing bytes ${extra}` });
      else concatenated++;
    }
    if (packet.id === 1) { sendPacket(args.create ? { id: SC.CreateAccount, email, password } : { id: C.LoginAccount, email, password }); phase = 'account'; }
    else if (packet.id === 199) {
      const first = packet.characters[0];
      if (first) sendPacket({ id: C.LoginExistingChar, charId: first.id, name: first.name });
      else if (args.char) sendPacket({ id: SC.LoginNewChar, name: args.char, race: 1, gender: 1, characterClass: 3, head: 7, home: 1 });
      else throw new Error('account has no character; pass --char Name');
      phase = 'login';
    }
    else if (packet.id === 158) walkInterval = packet.walk;
    else if (packet.id === 2) { phase = 'playing'; log('logged in'); }
  }
});
socket.on('close', () => {
  if (!lines.length) { log('no frames: the server never answered; nothing written'); process.exit(2); }
  fs.mkdirSync(out.replace(/[^/]+$/, ''), { recursive: true }); fs.writeFileSync(out, `${lines.join('\n')}\n`);
  log(`wrote ${lines.length} frames to ${out}; ${concatenated} LocaleMsg+empty ConsoleMsg frame(s); ${problems.length} frame(s) our codecs reject`);
  for (const p of problems) log(`  id=${p.id} ${names.get(p.id) ?? ''}: ${p.error} :: ${p.hex}`);
  process.exit(0);
});
socket.on('error', error => { log(`error ${error.message}`); process.exit(1); });
setTimeout(() => { log('timeout'); socket.destroy(); }, Number(args.timeout ?? 120_000));
run().catch(error => { log(String(error)); socket.destroy(); });
