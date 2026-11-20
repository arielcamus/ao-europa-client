// AGPL-3.0-or-later. Records a scripted session against the real VB6 server as a conformance fixture (docs/CONFORMANCE.md).
// Usage: node tools/conformance/vb6-record.mjs <scenario.mjs> <out.jsonl>   env (required): AO_EMAIL AO_PASSWORD AO_CHAR_ID AO_CHAR; optional AO_HOST AO_PORT AO_ASSETS
import net from 'node:net';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { REDACT, bodyHex, clientNames, frame, i32, str } from './wire.mjs';
const serverNames = JSON.parse(fs.readFileSync(new URL('./server-packet-names.json', import.meta.url), 'utf8'));

export class Recorder {
  constructor(host, port) { this.t0 = Date.now(); this.records = []; this.waiters = []; this.buf = Buffer.alloc(0); this.socket = net.connect(port, host);
    this.socket.on('data', d => this.onData(d)); this.socket.on('error', e => { this.error = e; }); }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt16LE(0); if (this.buf.length < 2 + len) break;
      const id = this.buf.readInt16LE(2), body = this.buf.subarray(4, 2 + len); this.buf = this.buf.subarray(2 + len);
      const r = { t_ms: Date.now() - this.t0, dir: 's2c', id, name: serverNames[id] ?? `Unknown${id}`, hex: bodyHex(id, body) };
      this.records.push(r); this.waiters = this.waiters.filter(w => !w(r));
    }
  }
  /** Records `hex` = full frame body incl. the 2-byte LE id. Credentials-carrying packets (304, 305) are recorded with an EMPTY payload. */
  send(id, body = []) { const kept = REDACT.has(id) ? [] : body;
    this.records.push({ t_ms: Date.now() - this.t0, dir: 'c2s', id, name: clientNames[id] ?? `Unknown${id}`, hex: bodyHex(id, Buffer.from(kept)) }); this.socket.write(frame(id, body)); }
  wait(pred, ms = 20000) { const hit = this.records.slice(this.mark ?? 0).find(pred); if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => { const timer = setTimeout(() => rej(new Error('timeout')), ms); this.waiters.push(r => (pred(r) ? (clearTimeout(timer), res(r), true) : false)); }); }
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  save(path) { fs.writeFileSync(path, this.records.map(r => JSON.stringify(r)).join('\n') + '\n'); }
  close() { this.socket.destroy(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , scenario, out] = process.argv;
  for (const name of ['AO_EMAIL', 'AO_PASSWORD', 'AO_CHAR_ID', 'AO_CHAR']) if (!process.env[name]) throw new Error(`Set ${name} (no defaults: use a throw-away @local.test account)`);
  const rec = new Recorder(process.env.AO_HOST ?? '127.0.0.1', Number(process.env.AO_PORT ?? 7667));
  const { default: run } = await import(pathToFileURL(scenario).href);
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { rec.save(out); console.log(`interrupted; saved ${rec.records.length} packets to ${out}`); process.exit(1); });
  try {
    await rec.wait(r => r.id === 1);
    rec.send(305, [...str(process.env.AO_EMAIL), ...str(process.env.AO_PASSWORD)]);
    await rec.wait(r => r.id === 199);
    rec.send(73, [...i32(Number(process.env.AO_CHAR_ID)), ...str(process.env.AO_CHAR)]);
    await rec.wait(r => r.id === 2); await rec.sleep(1500);
    await run(rec);
  } finally { rec.save(out); rec.close(); console.log(`saved ${rec.records.length} packets to ${out}`); }
}
