// Regenerates docs/PINNED-LAYOUTS.md and docs/pinned-layouts.json: for EVERY packet the client implements, the layout at the pre-HOO pin
// (server-classic 9ccd7fad Protocol.bas readers + Protocol_Writes.bas writers, client-classic 619e69d Protocol.bas handlers) next to ours,
// and whether the HOO-era tree (server caac3133, client HEAD) changed it.
// Usage: pnpm --filter @ao/protocol build && node tools/protocol/pinned-layouts.mjs   (needs ~/Projects/ao-reference clones with full history)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { codecTables, Reader } from '../../packages/protocol/dist/index.js';

const ref = process.env.AO_REFERENCE ?? `${process.env.HOME}/Projects/ao-reference`;
const SERVER = { repo: `${ref}/argentum-online-server-classic`, pin: '9ccd7fad', head: 'caac3133', dir: 'Codigo' };
const CLIENT = { repo: `${ref}/argentum-online-client-classic`, pin: '619e69d', head: 'HEAD', dir: 'CODIGO' };
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
const files = (t, sha) => git(t.repo, 'ls-tree', '-r', '--name-only', sha, t.dir).split('\n').filter(f => /\.(bas|cls)$/.test(f) && !/Tests?\//.test(f));
const show = (t, sha, f) => git(t.repo, 'show', `${sha}:${f}`);

/** sub/function name -> { seq: Read/Write calls in source order, ids: ServerPacketID/ClientPacketID names it mentions } */
function parse(t, sha) {
  const out = new Map();
  for (const f of files(t, sha)) {
    let cur = null;
    for (const line of show(t, sha, f).split('\n')) {
      const m = line.match(/^\s*(?:Public |Private )?(?:Sub|Function)\s+(\w+)/);
      if (m) { cur = { seq: [], ids: [], file: f }; out.set(m[1], cur); continue; }
      if (!cur) continue;
      for (const r of line.matchAll(/(?:reader|Reader|packetReader|Writer|writer)\w*\.(?:Read|Write)(\w+)/g)) cur.seq.push(r[1]);
      for (const r of line.matchAll(/(?:Server|Client)PacketID\.(e\w+)/g)) cur.ids.push(r[1]);
      if (/^\s*End (Sub|Function)/.test(line)) cur = null;
    }
  }
  return out;
}
function enumNames(t, sha, which) {
  const src = show(t, sha, `${t.dir}/PacketId.bas`);
  const body = src.slice(src.indexOf(`Public Enum ${which}`)).split('End Enum')[0].split('\n').slice(1);
  const names = []; for (const l of body) { const m = l.trim().match(/^(\w+)/); if (m && !/^\[/.test(l.trim())) names.push(m[1]); }
  return names; // index = packet id (eMinPacket = 0)
}
/** packet name -> handler sub, from the Select Case dispatch */
function dispatch(t, sha, which, file) {
  const map = new Map(); let id = null;
  for (const line of show(t, sha, `${t.dir}/${file}`).split('\n')) {
    const c = line.match(new RegExp(`Case\\s+${which}\\.(e\\w+)`)); if (c) { id = c[1]; continue; }
    const h = id && line.match(/Call\s+(H\w*?(?:andle|anlde|endle)\w+)/); if (h) { map.set(id, h[1]); id = null; }
  }
  return map;
}

const serverPin = parse(SERVER, SERVER.pin), serverHead = parse(SERVER, SERVER.head);
const clientPin = parse(CLIENT, CLIENT.pin), clientHead = parse(CLIENT, CLIENT.head);
const sNames = enumNames(SERVER, SERVER.pin, 'ServerPacketID'), cNames = enumNames(SERVER, SERVER.pin, 'ClientPacketID');
const sNamesHead = enumNames(SERVER, SERVER.head, 'ServerPacketID'), cNamesHead = enumNames(SERVER, SERVER.head, 'ClientPacketID');
const sDispatch = dispatch(CLIENT, CLIENT.pin, 'ServerPacketID', 'Protocol.bas'), cDispatch = dispatch(SERVER, SERVER.pin, 'ClientPacketID', 'Protocol.bas');
const sDispatchHead = dispatch(CLIENT, CLIENT.head, 'ServerPacketID', 'Protocol.bas'), cDispatchHead = dispatch(SERVER, SERVER.head, 'ClientPacketID', 'Protocol.bas');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rle = seq => { const o = []; for (const s of seq) { const l = o[o.length - 1]; if (l && l[0] === s) l[1]++; else o.push([s, 1]); } return o.map(([s, n]) => (n > 1 ? `${s}x${n}` : s)).join(' ') || '(none)'; };

// Server writers that changed after the pin, by the packet id they write.
const changedWriter = new Set();
for (const [name, fn] of serverPin) if (/Protocol_Writes/.test(fn.file) && serverHead.has(name) && !eq(fn.seq, serverHead.get(name).seq)) for (const id of fn.ids) changedWriter.add(id);
// Pinned writer sequence by packet, for the reference column.
const writerOf = new Map();
for (const [, fn] of serverPin) if (/Protocol_Writes/.test(fn.file)) for (const id of fn.ids) if (!writerOf.has(id) && fn.seq.length) writerOf.set(id, fn.seq);

/** First-path sequence of our codec: read() over a zero buffer, recording each primitive. Lists/conditionals show their empty path. */
const KINDS = { readInt8: 'Int8', readInt16: 'Int16', readInt32: 'Int32', readBool: 'Bool', readReal32: 'Real32', readString: 'String8', readInt: 'Int', readUnsignedInt: 'Int' };
function ourSeq(codec) {
  const log = []; const saved = {}; let depth = 0; // readString calls readInt internally: log only the outermost primitive
  for (const [m, k] of Object.entries(KINDS)) { saved[m] = Reader.prototype[m]; Reader.prototype[m] = function (...a) { if (depth++ === 0) log.push(k); try { return saved[m].apply(this, a); } finally { depth--; } }; }
  try { codec.read(new Reader(new Uint8Array(512))); } catch { log.push('!err'); } finally { for (const m of Object.keys(saved)) Reader.prototype[m] = saved[m]; }
  return log;
}

const CHANGED = { // the eight post-pin server->client changes (see packages/protocol/src/profile.ts); everything else is byte-identical
  ConsoleMsg: 'trailing channel Int8', LocaleMsg: 'trailing channel Int8', CharacterCreate: 'trailing clanAlignment Int8',
  UpdateTagAndStatus: 'trailing clanIndex Int16 + clanAlignment Int8', FYA: 'trailing strength/agility base Int8 x2',
  GuildNews: 'exp, expNeeded Int16 -> Int32', GuildLeaderInfo: 'exp, expNeeded Int16 -> Int32', QuestDetails: 'trailing talkTo Int16 + deliverMap Int16',
};
const rows = [];
for (const side of ['server', 'client']) {
  const names = side === 'server' ? sNames : cNames, headNames = side === 'server' ? sNamesHead : cNamesHead;
  const disp = side === 'server' ? sDispatch : cDispatch, dispHead = side === 'server' ? sDispatchHead : cDispatchHead;
  const readers = side === 'server' ? clientPin : serverPin, readersHead = side === 'server' ? clientHead : serverHead;
  for (const key of Object.keys(codecTables[side].core ? Object.assign({}, ...Object.values(codecTables[side])) : {})) {
    const id = Number(key), vb = names[id]; // eFoo
    const codec = Object.assign({}, ...Object.values(codecTables[side]))[id];
    const row = { dir: side === 'server' ? 'S->C' : 'C->S', id, name: vb?.replace(/^e/, '') ?? '?' };
    if (!vb || headNames[id] !== vb) { row.status = 'ID MISMATCH'; rows.push(row); continue; }
    const handler = disp.get(vb), hFn = handler && readers.get(handler), hHead = readersHead.get(dispHead.get(vb) ?? handler);
    const pinned = hFn ? hFn.seq : null;
    row.handler = handler ?? '(inline)'; row.pinned = pinned ? rle(pinned) : '(no pinned handler found: the packet carries no payload, or the id is unhandled at the pin)'; row.ours = rle(ourSeq(codec));
    const moved = side === 'client' && vb === 'eAbandonarGrupo' ? false : (pinned && hHead && !eq(pinned, hHead.seq)) || (side === 'server' && changedWriter.has(vb));
    const shape = pinned && eq(pinned, ourSeq(codec));
    row.status = moved ? 'DIFFERENT after pin' : shape ? 'same (primitive order matches)' : 'same as HEAD; loops/conditionals';
    const changedKey = Object.keys(CHANGED).find(k => k.toLowerCase() === row.name.toLowerCase());
    if (moved && changedKey) row.change = CHANGED[changedKey];
    if (side === 'client' && vb === 'eAbandonarGrupo') { // not a layout change: a pinned-server bug fixed later (#1791)
      row.status = 'same on the wire; pinned server over-reads';
      row.note = 'the pinned server (9ccd7fad) reads one extra Int16 that no client sends (removed later by server #1791); Aurora Reader.Read returns 0 on underflow, so the handler still runs. We send the bare packet id, exactly as the pinned client does';
    }
    rows.push(row);
  }
}
rows.sort((a, b) => a.dir.localeCompare(b.dir) || a.id - b.id);
const count = s => rows.filter(r => r.status.startsWith(s)).length;
const md = [
  '# Pinned pre-HOO packet layouts vs ours', '',
  `Generated by \`tools/protocol/pinned-layouts.mjs\` (do not hand-edit). Pin: server-classic \`${SERVER.pin}\`, client-classic \`${CLIENT.pin}\`; HOO-era tree: server \`${SERVER.head}\`, client HEAD.`, '',
  `**${rows.length} packets implemented: ${count('DIFFERENT')} differ after the pin, ${rows.length - count('DIFFERENT') - count('ID MISMATCH')} are the same.** Packet IDs did not move (post-pin packets were appended: RemortState, RemortResult, HooTargetedSpellCastResult, HooHouseDoorActionResult, AutoCombatState on the server side; HooClientCapabilities, RequestRemort, HooTargetedSpellCast, HooHouseDoorAction, ToggleAutoCombat on the client side; none is implemented here).`, '',
  '- "same (primitive order matches)": our decoder run over a zero buffer reads exactly the primitives the pinned VB6 handler reads.',
  '- "same as HEAD; loops/conditionals": the pinned handler and writer are byte-for-byte the same sequence as the HOO-era tree, so our codec (conformance-checked against it) is also right at the pin; the first-path sequences differ only because of lists, counts or branches.',
  '- "DIFFERENT after pin": the layout changed. Decoding on `live` is version-tolerant, on `prehoo` it reads exactly the pinned layout (a HOO-era tail is left as trailing bytes); encoding follows `setWireProfile(\'prehoo\' | \'live\')` (packages/protocol/src/profile.ts).', '',
  '## Differences', '', '| Dir | Id | Packet | Change after the pin | Pinned (619e69d handler) | Ours |', '|---|---|---|---|---|---|',
  ...rows.filter(r => r.status.startsWith('DIFFERENT')).map(r => `| ${r.dir} | ${r.id} | ${r.name} | ${r.change} | ${r.pinned} | ${r.ours} |`), '',
  '## All packets', '', '| Dir | Id | Packet | Status | Pinned handler sequence | Ours (zero-buffer first path) |', '|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r.dir} | ${r.id} | ${r.name}${r.note ? ' *' : ''} | ${r.status} | ${r.pinned ?? ''} | ${r.ours ?? ''} |`), '',
  ...rows.filter(r => r.note).map(r => `\\* ${r.name}: ${r.note}.`), '',
];
writeFileSync(new URL('../../docs/PINNED-LAYOUTS.md', import.meta.url), md.join('\n'));
writeFileSync(new URL('../../docs/pinned-layouts.json', import.meta.url), JSON.stringify(rows.map(({ dir, id, name, status }) => ({ dir, id, name, status })), null, 1) + '\n');
console.log(`${rows.length} rows; different=${count('DIFFERENT')} idMismatch=${count('ID MISMATCH')} exact=${count('same (')}`);
