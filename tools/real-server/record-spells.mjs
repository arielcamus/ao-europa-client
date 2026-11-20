// Records one scripted spell session against the classic VB6 server as a fixture (JSONL, one frame body per line).
// Usage: AO_EMAIL=spells@local.test AO_PASSWORD=... node tools/real-server/record-spells.mjs <out.jsonl> '<steps json>'
// Steps: {"wait":ms} {"cast":slot} {"click":[x,y]} {"info":slot} {"move":[up,slot]}. The account must already
// exist (tools/real-server/vb6-create-account.mjs creates one; the spells tests used class 1, Mage).
// Fixture line: {"t_ms":<ms since connect>,"dir":"c2s"|"s2c","id":<int>,"name":"...","hex":"<frame body hex, id first>"}
import net from 'node:net';
import fs from 'node:fs';
const [out, stepsJson = '[]'] = process.argv.slice(2);
if (!out) throw new Error('usage: record-spells.mjs <out.jsonl> [steps json]');
const steps = JSON.parse(stepsJson);
const host = process.env.AO_HOST ?? '127.0.0.1', port = Number(process.env.AO_PORT ?? 7667);
const email = process.env.AO_EMAIL ?? 'spells@local.test', password = process.env.AO_PASSWORD ?? 'spellspw1';
const MAGIC = 1; // e_Skill.Magia
const varint = n => { const o = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; o.push(b); } while (n); return o; };
const str = s => { const b = [...Buffer.from(s, 'utf8')]; return [...varint(b.length), ...b]; };
const i32 = n => { const b = Buffer.alloc(4); b.writeInt32LE(n); return [...b]; };
const frame = (id, body) => { const len = body.length + 2; return Buffer.from([len & 255, len >> 8, id & 255, id >> 8, ...body]); };
fs.writeFileSync(out, '');
const t0 = Date.now(); let buf = Buffer.alloc(0), stage = 0;
const rec = (dir, id, name, body) => fs.appendFileSync(out, JSON.stringify({ t_ms: Date.now() - t0, dir, id, name, hex: Buffer.concat([Buffer.from([id & 255, id >> 8]), Buffer.from(dir === 'c2s' && (id === 304 || id === 305) ? [] : body)]).toString('hex') }) /* credentials redacted (docs/CONFORMANCE.md) */ + '\n');
const s = net.connect(port, host);
const send = (id, name, body) => { rec('c2s', id, name, body); s.write(frame(id, body)); };
const counters = { cast: 0, work: 0 };
s.on('data', d => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 4) {
    const len = buf.readUInt16LE(0); if (buf.length < 2 + len) break;
    const id = buf.readInt16LE(2), body = buf.subarray(4, 2 + len); buf = buf.subarray(2 + len);
    rec('s2c', id, `S${id}`, body);
    if (id === 1 && stage === 0) { stage = 1; send(305, 'LoginAccount', [...str(email), ...str(password)]); }
    if (id === 199 && stage === 1) { // count:v, id:v, name:s of the first character
      stage = 2; let o = 0;
      const rv = () => { let r = 0, sh = 0, b; do { b = body[o++]; r |= (b & 127) << sh; sh += 7; } while (b & 128); return r; };
      rv(); const charId = rv(), n = rv();
      send(73, 'LoginExistingChar', [...i32(charId), ...str(body.subarray(o, o + n).toString())]);
    }
    if (id === 2) void run();
  }
});
async function run() {
  await new Promise(r => setTimeout(r, 3000));
  for (const a of steps) {
    if (a.wait) await new Promise(r => setTimeout(r, a.wait));
    if (a.cast) send(94, 'CastSpell', [a.cast, ...i32(++counters.cast)]);
    if (a.click) send(2, 'WorkLeftClick', [a.click[0], a.click[1], MAGIC, ...i32(++counters.work)]);
    if (a.info) send(4, 'SpellInfo', [a.info]);
    if (a.move) send(14, 'MoveSpell', [a.move[0] ? 1 : 0, a.move[1]]);
  }
  await new Promise(r => setTimeout(r, 3000)); s.destroy();
}
s.on('close', () => process.exit(0));
s.on('error', e => { console.error(e.message); process.exit(1); });
setTimeout(() => s.destroy(), 300_000);
