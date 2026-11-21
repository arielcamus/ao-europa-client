#!/usr/bin/env node
// Machine-checked feature coverage map: VB6 packets and forms vs our codecs, fixtures and UI.
// Reads the cached VB6 snapshot in tools/coverage/vb6-snapshot (no VM needed), scans the checked-out commit with git
// (add --include-branches to scan origin/main plus every origin/feat/* branch and open PRs), writes docs/COVERAGE.md and docs/coverage.json.
//   node tools/coverage/build-map.mjs            rebuild from the snapshot
//   node tools/coverage/build-map.mjs --include-branches   also scan origin/feat/* branches and PRs (not deterministic)
//   node tools/coverage/build-map.mjs --check    exit 1 if the committed outputs are stale or invalid
//   node tools/coverage/build-map.mjs --refresh-vb6   re-read the snapshot from the VM and the reference client
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS, PACKAGES, GROUP_PACKAGE, classifyPacket } from './classify.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SNAP = join(HERE, 'vb6-snapshot');

const git = (args, opts = {}) => {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'], ...opts }); }
  catch { return null; }
};

// ---------- VB6 snapshot ----------
const snap = (f) => readFileSync(join(SNAP, f), 'latin1').replace(/\r/g, '');

export function parseEnums(text = snap('PacketId.enums.bas')) {
  const out = { s2c: [], c2s: [] };
  let cur = null, id = 0, skipIf = false;
  for (let line of text.split('\n')) {
    line = line.replace(/'.*$/, '').trim();
    const en = line.match(/^Public Enum (Server|Client)PacketID/);
    if (en) { cur = en[1] === 'Server' ? out.s2c : out.c2s; id = 0; continue; }
    if (/^End Enum/.test(line)) { cur = null; continue; }
    if (!cur || !line || line.startsWith('#') || line.startsWith('[')) continue;
    const m = line.match(/^e([A-Za-z0-9_]+)/);
    if (!m) continue;
    const name = m[1][0].toUpperCase() + m[1].slice(1);
    if (name !== 'MinPacket' && name !== 'MaxPacket') cur.push({ id, name, raw: 'e' + m[1] });
    id++;
  }
  return out;
}

function dispatchMap(file, caseRe) {
  const map = new Map(); let pending = [];
  for (const line of snap(file).split('\n')) {
    const c = line.match(caseRe);
    if (c) { pending.push(c[1]); continue; }
    const h = line.match(/Call (Handle[A-Za-z0-9_]+)/);
    if (h && pending.length) { for (const p of pending) map.set(p, h[1]); pending = []; }
  }
  return map;
}
const lines = (f) => new Set(snap(f).split('\n').map((s) => s.trim()).filter(Boolean));

// ---------- our implementation ----------
// Default: the checked-out commit (HEAD) only, so the result is deterministic and the unit test on main never
// depends on unmerged branches. includeBranches (CLI --include-branches) adds origin/main, every origin/feat/*
// branch and open PR numbers, for humans building the cross-branch map.
export function discoverRefs({ includeBranches = false } = {}) {
  const out = [];
  if (!includeBranches) {
    out.push({ name: 'main', ref: 'HEAD', sha: null, pr: null });
    return out;
  }
  const main = git(['rev-parse', '--verify', '-q', 'origin/main']) ? 'origin/main' : 'HEAD';
  out.push({ name: 'main', ref: main });
  const feats = (git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/feat']) || '').split('\n').filter(Boolean).sort();
  for (const r of feats) out.push({ name: r.replace(/^origin\//, ''), ref: r });
  let prs = {};
  try {
    const j = JSON.parse(execFileSync('gh', ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,headRefName'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }));
    prs = Object.fromEntries(j.map((p) => [p.headRefName, p.number]));
  } catch { /* offline: no PR numbers */ }
  const known = JSON.parse(readFileSync(join(HERE, 'pr-numbers.json'), 'utf8'));
  for (const r of out) { r.sha = (git(['rev-parse', '--short', r.ref]) || '').trim(); r.pr = prs[r.name] ?? known[r.name] ?? null; }
  return out;
}

const TABLE_RE = /(?:export\s+)?(?:const\s+enum|enum|const)\s+(\w+)\s*(?::[^={]+)?=?\s*\{([^}]*)\}/g;

export function scanRef(ref) {
  const files = (git(['ls-tree', '-r', '--name-only', ref, 'packages/protocol/src']) || '').split('\n').filter((f) => f.endsWith('.ts'));
  const entries = new Map(); // "s2c:42" -> {name, table, tableFile}
  const registered = new Map(); // "Table.Name" -> Set(files)
  const srcs = {};
  for (const f of files) srcs[f] = git(['show', `${ref}:${f}`]) || '';
  for (const [f, src] of Object.entries(srcs)) {
    for (const m of src.matchAll(TABLE_RE)) {
      const table = m[1];
      const dir = /Server/.test(table) ? 's2c' : /Client/.test(table) ? 'c2s' : null;
      if (!dir || /Codec|Schema/i.test(table)) continue;
      for (const e of m[2].matchAll(/(\w+)\s*[:=]\s*(\d+)/g)) entries.set(`${dir}:${e[2]}`, { name: e[1], table, tableFile: f, dir, id: Number(e[2]) });
    }
    for (const m of src.matchAll(/\[\s*(\w+)\.(\w+)\s*\]\s*:/g)) {
      const k = `${m[1]}.${m[2]}`;
      if (!registered.has(k)) registered.set(k, new Set());
      registered.get(k).add(f);
    }
  }
  const out = new Map();
  for (const [key, e] of entries) {
    const codecFiles = [...(registered.get(`${e.table}.${e.name}`) || [])].sort();
    out.set(key, { ...e, codec: codecFiles.length > 0, codecFiles });
  }
  return out;
}

export function scanFixtures(ref) {
  const files = (git(['ls-tree', '-r', '--name-only', ref, 'tests/fixtures']) || '').split('\n').filter((f) => f.endsWith('.jsonl'));
  const seen = new Map(); // key -> Set(files)
  for (const f of files) {
    for (const line of (git(['show', `${ref}:${f}`]) || '').split('\n')) {
      if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (typeof j.id !== 'number' || (j.dir !== 's2c' && j.dir !== 'c2s')) continue;
      const k = `${j.dir}:${j.id}`;
      if (!seen.has(k)) seen.set(k, new Set());
      seen.get(k).add(f);
    }
  }
  return seen;
}

const fileExistsAt = (ref, path) => git(['cat-file', '-e', `${ref}:${path}`]) !== null;

// ---------- compute ----------
export function computeCoverage({ refs = discoverRefs() } = {}) {
  const enums = parseEnums();
  const clientDispatch = dispatchMap('client-dispatch.txt', /Case ServerPacketID\.(\w+)/);
  const serverDispatch = dispatchMap('server-dispatch.txt', /Case ClientPacketID\.(\w+)/);
  const clientWriters = lines('client-writers.txt');
  const serverWriters = lines('server-writers.txt');

  const aliases = JSON.parse(readFileSync(join(HERE, 'name-aliases.json'), 'utf8'));
  const main = refs.find((r) => r.name === 'main');
  const scans = Object.fromEntries(refs.map((r) => [r.name, scanRef(r.ref)]));
  const fixtures = Object.fromEntries(refs.map((r) => [r.name, scanFixtures(r.ref)]));
  const problems = [];

  const packets = [];
  for (const dir of ['s2c', 'c2s']) {
    for (const p of enums[dir]) {
      const key = `${dir}:${p.id}`;
      const { group, pkg, unclassified } = classifyPacket(p.name);
      const handler = dir === 's2c' ? clientDispatch.get(p.raw) : serverDispatch.get(p.raw);
      const writer = `Write${p.name}`;
      const hasWriter = (dir === 's2c' ? serverWriters : clientWriters).has(writer) || (dir === 's2c' ? serverWriters : clientWriters).has(`Write${p.raw.slice(1)}`);
      const onMain = scans.main?.get(key);
      const mainCodec = !!onMain?.codec;
      const branches = [];
      for (const r of refs) {
        if (r.name === 'main') continue;
        const e = scans[r.name].get(key);
        if (e?.codec && !mainCodec) branches.push(r.name);
      }
      const codecFiles = [];
      for (const r of refs) { const e = scans[r.name].get(key); if (e?.codec && (r.name === 'main' || !mainCodec)) for (const f of e.codecFiles) codecFiles.push(`${r.name}:${f}`); }
      const fx = new Set(); const fxRefs = [];
      for (const r of refs) { const s = fixtures[r.name].get(key); if (s) { fxRefs.push(r.name); for (const f of s) fx.add(f); } }
      let status = 'not started';
      if (mainCodec) status = 'merged'; else if (branches.length) status = `on ${branches.join(', ')}`;
      packets.push({
        key, id: p.id, name: p.name, direction: dir, handler: handler ? `${dir === 's2c' ? 'client' : 'server'} Protocol.bas:${handler}` : '(none in dispatcher)',
        writer: hasWriter ? `${dir === 's2c' ? 'server' : 'client'} Protocol_Writes.bas:${writer}` : null,
        group, package: pkg, status, covered: mainCodec || branches.length > 0, merged: mainCodec, branches,
        codecFiles, fixture: fx.size > 0, fixtureFiles: [...fx].sort(),
      });
      if (unclassified) problems.push(`unclassified packet ${key} ${p.name} (defaulted to core)`);
      // name check: what we call an id must match the VB6 name at that id
      for (const r of refs) {
        const e = scans[r.name].get(key);
        if (e && e.name.toLowerCase() !== p.name.toLowerCase() && aliases[key] !== e.name) problems.push(`name mismatch on ${r.name}: ${key} is ${p.name} in VB6 but ${e.name} in ${e.tableFile}`);
      }
    }
  }
  // ids our branches use that the VB6 enums do not have
  const vb6Keys = new Set(packets.map((p) => p.key));
  for (const r of refs) for (const [k, e] of scans[r.name]) if (!vb6Keys.has(k)) problems.push(`unknown id on ${r.name}: ${k} ${e.name}`);
  // declared ids without a codec registration
  for (const r of refs) for (const [k, e] of scans[r.name]) if (!e.codec) problems.push(`declared without codec on ${r.name}: ${k} ${e.name}`);

  // duplicates: same direction+id with a codec on more than one open branch (inherited-from-main entries do not count)
  const duplicates = packets.filter((p) => p.branches.length > 1).map((p) => ({ key: p.key, id: p.id, name: p.name, direction: p.direction, branches: p.branches }));
  // the same id on main and on a branch also counts, listed separately
  const mainOverlap = packets.filter((p) => p.merged).flatMap((p) => refs.filter((r) => r.name !== 'main' && scans[r.name].get(p.key)?.codec && !scans.main.get(p.key)?.codec).map((r) => ({ key: p.key, branch: r.name })));

  // forms
  const forms = JSON.parse(readFileSync(join(HERE, 'forms.json'), 'utf8'));
  const lineCounts = Object.fromEntries(snap('forms.txt').split('\n').filter(Boolean).map((l) => l.split(' ')));
  const refByName = Object.fromEntries(refs.map((r) => [r.name, r]));
  const outForms = forms.map((f) => {
    const evs = (f.evidence || []).map((e) => ({ ...e, ok: !!refByName[e.ref] && fileExistsAt(refByName[e.ref].ref, e.path) }));
    // evidence on a branch that was not scanned is not a problem in main-only mode
    for (const e of evs) if (!e.ok && refByName[e.ref]) problems.push(`form evidence missing: ${f.name} -> ${e.ref}:${e.path}`);
    const ok = evs.filter((e) => e.ok);
    const full = ok.filter((e) => !e.partial); const part = ok.filter((e) => e.partial);
    const pickMain = (a) => a.some((e) => e.ref === 'main');
    const refsOf = (a) => [...new Set(a.map((e) => e.ref).filter((x) => x !== 'main'))];
    let status = 'not started', covered = false, partial = false;
    if (full.length) { covered = true; status = pickMain(full) ? 'merged' : `on ${refsOf(full).join(', ')}`; }
    else if (part.length) { partial = true; status = (pickMain(part) ? 'merged (partial)' : `on ${refsOf(part).join(', ')} (partial)`); if (pickMain(part) && refsOf(part).length) status += ` + ${refsOf(part).join(', ')}`; }
    return { name: f.name, purpose: f.purpose, group: f.group, package: GROUP_PACKAGE[f.group], lines: Number(lineCounts[f.name] || 0), status, covered, partial, evidence: evs, missing: f.missing || null, partialNote: (evs.find((e) => e.partial && e.note) || {}).note || null };
  });

  // groups
  const groups = GROUPS.map(([id, title]) => {
    const ps = packets.filter((p) => p.group === id); const fs = outForms.filter((f) => f.group === id);
    const pc = ps.filter((p) => p.covered).length, pm = ps.filter((p) => p.merged).length;
    const fc = fs.filter((f) => f.covered).length, fp = fs.filter((f) => f.partial).length;
    const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
    return { id, title, packets: ps.length, packetsCovered: pc, packetsMerged: pm, packetsPct: pct(pc, ps.length), forms: fs.length, formsCovered: fc, formsPartial: fp, formsPct: pct(fc, fs.length) };
  });

  const tot = (a) => a.length;
  const headline = {
    packets: tot(packets), packetsCovered: packets.filter((p) => p.covered).length, packetsMerged: packets.filter((p) => p.merged).length,
    s2c: packets.filter((p) => p.direction === 's2c').length, c2s: packets.filter((p) => p.direction === 'c2s').length,
    s2cCovered: packets.filter((p) => p.direction === 's2c' && p.covered).length, c2sCovered: packets.filter((p) => p.direction === 'c2s' && p.covered).length,
    forms: outForms.length, formsCovered: outForms.filter((f) => f.covered).length, formsPartial: outForms.filter((f) => f.partial).length,
    fixturePackets: packets.filter((p) => p.fixture).length,
  };
  headline.packetsPct = Math.round((headline.packetsCovered / headline.packets) * 1000) / 10;
  headline.packetsMergedPct = Math.round((headline.packetsMerged / headline.packets) * 1000) / 10;
  headline.formsPct = Math.round((headline.formsCovered / headline.forms) * 1000) / 10;
  headline.formsStartedPct = Math.round(((headline.formsCovered + headline.formsPartial) / headline.forms) * 1000) / 10;

  const workPackages = PACKAGES.map(([id, title, scope]) => {
    const ps = packets.filter((p) => p.package === id && !p.covered), fs = outForms.filter((f) => f.package === id && !f.covered);
    return { id, title, scope, packetIds: ps.map((p) => `${p.direction}:${p.id}`), packetNames: ps.map((p) => `${p.direction === 's2c' ? 'S' : 'C'}${p.id} ${p.name}`), forms: fs.map((f) => f.name) };
  });

  return { refs: refs.map(({ name, ref, sha, pr }) => ({ name, ref, sha, pr })), headline, groups, packets, forms: outForms, duplicates, mainOverlap, workPackages, problems };
}

// ---------- render ----------
const pc = (v) => (v === null ? 'n/a' : `${v}%`);
export function renderMarkdown(c) {
  const h = c.headline; const L = [];
  L.push('# Feature coverage map: classic-UI client vs the original VB6 client', '');
  L.push('<!-- Generated by tools/coverage/build-map.mjs. Do not edit by hand; run `node tools/coverage/build-map.mjs`. -->', '');
  L.push('Sources of truth are code. VB6 packet ids and names: server `PacketId.bas` (PYMMO=0), cached in `tools/coverage/vb6-snapshot/`. Handlers come from the dispatcher `Select Case` of the receiving side (`Protocol.bas`). Forms: the 86 `frm*.frm`/`Menu*.frm` files of the classic client. Ours: `packages/protocol/src` and `tests/fixtures/vb6` on the scanned refs below (the checked-out commit by default; `--include-branches` adds every `origin/feat/*` branch).', '');
  L.push('A packet is **covered** when a codec is registered for it (`[Table.Name]:` in a codec table) on main or on an open branch. **merged** means on main. Fixture means a recorded VB6 frame for that id exists under `tests/fixtures/vb6` on some branch. Forms are covered only with evidence of a UI surface (file exists on the stated ref); a partial surface is shown as partial and not counted.', '');
  L.push('Scanned refs: ' + c.refs.map((r) => `\`${r.name}\`${r.pr ? ` (#${r.pr})` : ''}${r.sha ? ` @${r.sha}` : ''}`).join(', '), '');
  L.push('## Headline', '');
  L.push(`- **Packets covered (merged + open branches): ${h.packetsCovered} of ${h.packets} = ${pc(h.packetsPct)}.** Merged on main only: ${h.packetsMerged} = ${pc(h.packetsMergedPct)}.`);
  L.push(`  - Server to client: ${h.s2cCovered} of ${h.s2c}. Client to server: ${h.c2sCovered} of ${h.c2s}. Packets with a recorded VB6 fixture: ${h.fixturePackets}.`);
  L.push(`- **Forms covered: ${h.formsCovered} of ${h.forms} = ${pc(h.formsPct)}** (${h.formsPartial} more partially, ${pc(h.formsStartedPct)} started).`, '');
  L.push('## (c) Feature groups, ordered by player value', '');
  L.push('| # | Group | Packets covered | % | Merged | Forms covered | % | Partial forms |', '|---|---|---|---|---|---|---|---|');
  c.groups.forEach((g, i) => L.push(`| ${i + 1} | ${g.title} | ${g.packetsCovered}/${g.packets} | ${pc(g.packetsPct)} | ${g.packetsMerged} | ${g.formsCovered}/${g.forms} | ${pc(g.formsPct)} | ${g.formsPartial} |`));
  L.push('');
  L.push('## DUPLICATES', '');
  L.push('Packet ids (direction + id) with a codec on more than one open branch. Each branch carries its own copy of the codec, so the first merge wins and the rest must rebase onto it and delete theirs.', '');
  L.push('| Id | Direction | Name | Branches |', '|---|---|---|---|');
  for (const d of c.duplicates) L.push(`| ${d.id} | ${d.direction} | ${d.name} | ${d.branches.map((b) => `\`${b}\``).join(', ')} |`);
  L.push('', `Ids only: ${c.duplicates.map((d) => d.id).join(', ')}.`, '');
  if (c.problems.length) { L.push('## Problems found by the scan', ''); for (const p of c.problems) L.push(`- ${p}`); L.push(''); }
  L.push('## (b) VB6 forms', '');
  L.push('Status is evidence-based: `covered` means every file listed in `tools/coverage/forms.json` for the form exists on the scanned ref; `partial` says what is missing; `not started` carries a class (a player-facing, b account server / not in PYMMO=0, c AO20 premium or online extra, d never opened by the classic client).', '');
  L.push('| Form | Purpose | Group | Status | Implementation / what is missing |', '|---|---|---|---|---|');
  const order = new Map(GROUPS.map(([id], i) => [id, i]));
  const sortedForms = [...c.forms].sort((a, b) => order.get(a.group) - order.get(b.group) || a.name.localeCompare(b.name));
  for (const f of sortedForms) {
    const files = [...new Set(f.evidence.filter((e) => e.ok).map((e) => e.path.replace('apps/web/', '')))].join(', ');
    const note = f.missing ? `(${f.missing.class}) ${f.missing.note}` : f.partial && f.partialNote ? `${files}: ${f.partialNote}` : files;
    L.push(`| ${f.name} | ${f.purpose} | ${f.group} | ${f.status} | ${note} |`);
  }
  const missing = sortedForms.filter((f) => f.missing);
  const classes = [['a', 'Player-facing and worth building'], ['b', 'Needs a login/account server, not used with PYMMO=0'], ['c', 'AO20 premium / online extras (shop, marketplace, battlegrounds, transfer)'], ['d', 'Never opened by the classic client code (dead forms, nothing to build)']];
  const partials = sortedForms.filter((f) => f.partial && !f.covered);
  L.push('', '### Genuinely missing screens', '', `${missing.length + partials.filter((f) => f.name !== 'frmMain').length} forms have no complete screen yet.`, '');
  for (const [k, title] of classes) {
    const fs = missing.filter((f) => f.missing.class === k);
    L.push(`**(${k}) ${title}** (${fs.length})`, '', ...fs.map((f) => `- ${f.name}: ${f.missing.note}`), '');
  }
  L.push(`**Partial** (${partials.length})`, '', ...partials.map((f) => `- ${f.name}: ${f.partialNote}`), '');
  L.push('', '## (a) VB6 packets', '');
  for (const [dir, title] of [['s2c', 'Server to client'], ['c2s', 'Client to server']]) {
    L.push(`### ${title}`, '', '| Id | Name | VB6 handler | Group | Status | Codec file(s) | Fixture |', '|---|---|---|---|---|---|---|');
    for (const p of c.packets.filter((x) => x.direction === dir)) {
      L.push(`| ${p.id} | ${p.name} | ${p.handler} | ${p.group} | ${p.status} | ${p.codecFiles.length ? p.codecFiles.map((f) => `\`${f}\``).join('<br>') : ''} | ${p.fixture ? 'yes' : 'no'} |`);
    }
    L.push('');
  }
  L.push('## Next work packages', '');
  L.push('Disjoint by construction: every uncovered packet and form belongs to exactly one package (`tools/coverage/classify.mjs`). Packet ids are `S` = server to client, `C` = client to server. Start these on top of main. Build time for a package of this size is roughly 10 to 25 minutes of agent time each (our 26 Oct calibration); the wait column is review, merge order and a recorded fixture session.', '');
  for (const w of c.workPackages) {
    L.push(`### ${w.id}: ${w.title}`, '', `${w.scope}.`, '', `- Packets (${w.packetNames.length}): ${w.packetNames.length ? w.packetNames.join(', ') : 'none left'}`, `- Forms (${w.forms.length}): ${w.forms.length ? w.forms.join(', ') : 'none left'}`, '');
  }
  return L.join('\n');
}

// ---------- refresh from VM ----------
function refreshVb6() {
  const vm = join(ROOT, 'scripts', 'vm-ssh.sh');
  const ref = process.env.AO_REFERENCE || join(process.env.HOME, 'Projects/ao-reference/argentum-online-client-classic/CODIGO');
  const S = 'C:\\ao\\server\\Codigo';
  const ssh = (cmd) => execFileSync(vm, [cmd], { encoding: 'latin1', maxBuffer: 64 << 20 }).replace(/\r/g, '');
  const pid = ssh(`type ${S}\\PacketId.bas`); writeFileSync(join(SNAP, 'PacketId.enums.bas'), pid.slice(pid.indexOf('Public Enum ServerPacketID')), 'latin1');
  const sp = ssh(`type ${S}\\Protocol.bas`).split('\n'); const keep = [];
  sp.forEach((l, i) => { if (/Case ClientPacketID\./.test(l)) { keep.push(l.trim()); const n = sp.slice(i + 1, i + 4).find((x) => /Call Handle/.test(x)); if (n) keep.push(n.trim()); } });
  writeFileSync(join(SNAP, 'server-dispatch.txt'), keep.join('\n') + '\n', 'latin1');
  writeFileSync(join(SNAP, 'server-writers.txt'), [...new Set([...ssh(`type ${S}\\Protocol_Writes.bas`).matchAll(/Sub (Write\w+)/g)].map((m) => m[1]))].sort().join('\n') + '\n');
  const cp = readFileSync(join(ref, 'Protocol.bas'), 'latin1');
  writeFileSync(join(SNAP, 'client-dispatch.txt'), cp.split('\n').filter((l) => /Case ServerPacketID|Call Handle/.test(l)).map((l) => l.trim()).join('\n') + '\n', 'latin1');
  writeFileSync(join(SNAP, 'client-writers.txt'), [...new Set([...readFileSync(join(ref, 'Protocol_Writes.bas'), 'latin1').matchAll(/Sub (Write\w+)/g)].map((m) => m[1]))].sort().join('\n') + '\n');
  const fl = execFileSync('sh', ['-c', `cd "${ref}" && for f in *.frm; do echo "$(basename $f .frm) $(wc -l < $f | tr -d ' ')"; done`], { encoding: 'utf8' });
  writeFileSync(join(SNAP, 'forms.txt'), fl);
}

// ---------- CLI ----------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  if (process.argv.includes('--refresh-vb6')) refreshVb6();
  const c = computeCoverage({ refs: discoverRefs({ includeBranches: process.argv.includes('--include-branches') }) });
  const md = renderMarkdown(c);
  const docs = join(ROOT, 'docs'); mkdirSync(docs, { recursive: true });
  const json = JSON.stringify(c, null, 1) + '\n';
  if (process.argv.includes('--check')) {
    const same = existsSync(join(docs, 'COVERAGE.md')) && readFileSync(join(docs, 'COVERAGE.md'), 'utf8') === md + '\n' && readFileSync(join(docs, 'coverage.json'), 'utf8') === json;
    if (!same) { console.error('docs/COVERAGE.md or docs/coverage.json is stale; run node tools/coverage/build-map.mjs'); process.exit(1); }
  } else {
    writeFileSync(join(docs, 'COVERAGE.md'), md + '\n'); writeFileSync(join(docs, 'coverage.json'), json);
    console.log(`packets ${c.headline.packetsCovered}/${c.headline.packets} (${c.headline.packetsPct}%), merged ${c.headline.packetsMerged}; forms ${c.headline.formsCovered}/${c.headline.forms} (${c.headline.formsPct}%), partial ${c.headline.formsPartial}`);
    console.log('duplicates:', c.duplicates.map((d) => d.id).join(','));
    for (const p of c.problems) console.log('problem:', p);
  }
}
