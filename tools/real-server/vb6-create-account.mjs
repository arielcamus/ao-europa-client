// Creates a local test account + character on the classic VB6 server (PYMMO=0 flow):
// CreateAccount(304: email:s, password:s) then LoginNewChar(74: name:s, race:v, gender:v, class:v, head:v, home:v).
// Usage: AO_EMAIL=... AO_PASSWORD=... AO_CHAR=... node tools/real-server/vb6-create-account.mjs
import net from 'node:net';
const [host, port] = [process.env.AO_HOST ?? '127.0.0.1', Number(process.env.AO_PORT ?? 7667)];
const need = key => process.env[key] ?? (() => { throw new Error(`Set ${key}`); })(); // no defaults: never fall back to a shared test account
const email = need('AO_EMAIL'), password = need('AO_PASSWORD'), name = need('AO_CHAR');
const varint = n => { const o = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; o.push(b); } while (n); return o; };
const str = s => { const b = [...Buffer.from(s, 'utf8')]; return [...varint(b.length), ...b]; };
const frame = (id, body) => { const len = body.length + 2; return Buffer.from([len & 255, len >> 8, id & 255, id >> 8, ...body]); };
const s = net.connect(port, host);
const log = m => console.log(`[create ${new Date().toISOString()}] ${m}`);
const ids = [];
let buf = Buffer.alloc(0), stage = 0;
s.on('connect', () => log('connected'));
s.on('data', d => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 4) {
    const len = buf.readUInt16LE(0); if (buf.length < 2 + len) break;
    const id = buf.readInt16LE(2); const body = buf.subarray(4, 2 + len); buf = buf.subarray(2 + len);
    ids.push(id); if (id !== 1 && id !== 199) log(`id ${id} body=${body.toString('hex')} text=${body.toString('latin1').replace(/[^ -~]/g,'.')}`);
    if (id === 73) log(`ErrorMsg: ${body.subarray(1).toString('latin1')}`);
    if (id === 1 && stage === 0) { stage = 1; s.write(frame(304, [...str(email), ...str(password)])); log('sent CreateAccount'); }
    if (id === 199 && stage === 1) { stage = 2; s.write(frame(74, [...str(name), 1, 1, 3, ...varint(1), 1])); log('AccountCharacterList (empty) -> sent LoginNewChar'); }
  }
});
s.on('close', () => { log(`closed; packet ids: ${ids.join(',')}`); process.exit(0); });
s.on('error', e => { log(`error ${e.message}`); process.exit(1); });
setTimeout(() => { log(`done; packet ids: ${ids.join(',')}`); s.destroy(); }, 8000);
