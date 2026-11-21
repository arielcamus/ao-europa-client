// Records the classic server's answer to LoginNewChar (char-create, 21 Nov 2026) as a jsonl fixture.
// Usage: AO_EMAIL=... AO_PASSWORD=... node tools/real-server/char-create-record.mjs <name> <race> <gender> <class> <head> <home> <create|login> <out.jsonl>
// The account packet body (email, password) is redacted in the output, like the core-session fixtures.
import net from 'node:net';
import { writeFileSync } from 'node:fs';
const need = key => process.env[key] ?? (() => { throw new Error(`Set ${key}`); })();
const email = need('AO_EMAIL'), password = need('AO_PASSWORD');
const [name, race, gender, cls, head, home, mode, out] = process.argv.slice(2);
const varint = n => { const o = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; o.push(b); } while (n); return o; };
const str = s => { const b = [...Buffer.from(s, 'utf8')]; return [...varint(b.length), ...b]; };
const frame = (id, body) => { const len = body.length + 2; return Buffer.from([len & 255, len >> 8, id & 255, id >> 8, ...body]); };
const lines = [], t0 = Date.now(), hex = (id, body) => Buffer.concat([Buffer.from([id & 255, id >> 8]), body]).toString('hex');
const note = (dir, id, name, h) => lines.push(JSON.stringify({ t_ms: Date.now() - t0, dir, id, name, hex: h }));
const s = net.connect(Number(process.env.AO_PORT ?? 7667), process.env.AO_HOST ?? '127.0.0.1');
let buf = Buffer.alloc(0), stage = 0;
const send = (id, label, body, shown = Buffer.from(body)) => { s.write(frame(id, body)); note('c2s', id, label, hex(id, shown)); };
s.on('data', d => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 4) {
    const len = buf.readUInt16LE(0); if (buf.length < 2 + len) break;
    const id = buf.readInt16LE(2), body = buf.subarray(4, 2 + len); buf = buf.subarray(2 + len);
    note('s2c', id, '', hex(id, body));
    if (id === 1 && stage === 0) { stage = 1; send(mode === 'login' ? 305 : 304, mode === 'login' ? 'LoginAccount' : 'CreateAccount', [...str(email), ...str(password)], Buffer.alloc(0)); }
    if (id === 199 && stage === 1) { stage = 2; send(74, 'LoginNewChar', [...str(name), ...[race, gender, cls, head, home].flatMap(v => varint(Number(v)))]); }
  }
});
const finish = why => { console.log(`# ${why}`); writeFileSync(out, lines.join('\n') + '\n'); console.log(lines.map(l => l.slice(0, 160)).join('\n')); process.exit(0); };
s.on('close', () => finish('socket closed by the server'));
s.on('error', e => finish(`socket error ${e.message}`));
setTimeout(() => { s.destroy(); finish('no answer in 12 s: the client closed the socket'); }, 12000);
