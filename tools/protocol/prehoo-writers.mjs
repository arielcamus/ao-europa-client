// Regenerates packages/protocol/test/prehoo-writers.json: every server->client WRITER at the pre-HOO pin (server-classic 9ccd7fad
// Protocol_Writes.bas), as the primitive sequence it writes after the packet id. Straight-line writers become a byte-level conformance test
// (packages/protocol/test/prehoo-writers.test.ts synthesises the frame and decodes it with our codec under the 'prehoo' profile);
// writers with loops or branches carry their source lines and are covered by real recordings instead.
// Usage: node tools/protocol/prehoo-writers.mjs   (needs ~/Projects/ao-reference/argentum-online-server-classic with history)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const ref = process.env.AO_REFERENCE ?? `${process.env.HOME}/Projects/ao-reference`;
const repo = `${ref}/argentum-online-server-classic`, pin = '9ccd7fad';
const src = execFileSync('git', ['-C', repo, 'show', `${pin}:Codigo/Protocol_Writes.bas`], { encoding: 'latin1', maxBuffer: 1 << 26 }).replace(/\r/g, '');
const ids = (() => {
  const text = execFileSync('git', ['-C', repo, 'show', `${pin}:Codigo/PacketId.bas`], { encoding: 'latin1' }).replace(/\r/g, '');
  const body = text.slice(text.indexOf('Public Enum ServerPacketID')).split('End Enum')[0].split('\n').slice(1);
  const out = new Map(); let i = 0;
  for (const l of body) { const m = l.split("'")[0].trim().match(/^(\w+)/); if (m && !l.trim().startsWith('#')) out.set(m[1], i++); }
  return out;
})();

const CONTROL = /^\s*(For |Next\b|Do\b|Loop\b|If |ElseIf |Else\b|End If|Select Case|Case |End Select|While |Wend\b|With |End With)/;
const writers = [];
let cur = null;
for (const raw of src.split('\n')) {
  const line = raw.replace(/'.*$/, '');
  const m = raw.match(/^\s*(?:Public |Private )?(?:Sub|Function)\s+(\w+)/);
  if (m) { cur = { fn: m[1], packets: [], seq: [], control: false, lines: [] }; continue; }
  if (!cur) continue;
  if (/^\s*End (Sub|Function)/.test(raw)) { if (cur.packets.length) writers.push(cur); cur = null; continue; }
  if (/^\s*Exit (Sub|Function)/.test(line) || /_Err:\s*$/.test(line) || /^\s*ErrHandler:/.test(line)) { cur.stop = true; continue; }
  if (cur.stop || /On Error/.test(line)) continue;
  const id = line.match(/Writer\.WriteInt16\s*\(?\s*ServerPacketID\.(e\w+)/);
  if (id) { cur.packets.push({ name: id[1].replace(/^e/, ''), id: ids.get(id[1]) }); continue; }
  const w = [...line.matchAll(/Writer\.Write(\w+)/g)].map(x => x[1]);
  if (CONTROL.test(line)) { cur.control = true; cur.lines.push(line.trim()); continue; }
  if (w.length) { cur.seq.push(...w); cur.lines.push(line.trim()); }
  else if (/\w+\.Write\w+|Call \w+\(/.test(line) && cur.packets.length) cur.lines.push(line.trim());
}
const out = writers.map(({ fn, packets, seq, control, lines }) => ({
  fn, packets, seq, straight: !control && packets.length === 1, ...(control || packets.length !== 1 ? { lines } : {}),
}));
writeFileSync(new URL('../../packages/protocol/test/prehoo-writers.json', import.meta.url), `${JSON.stringify({ pin, generatedBy: 'tools/protocol/prehoo-writers.mjs', writers: out }, null, 1)}\n`);
console.log(`${out.length} writers, ${out.filter(w => w.straight).length} straight-line`);
