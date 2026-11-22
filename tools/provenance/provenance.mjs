#!/usr/bin/env node
// AGPL-3.0-or-later. Pre-HOO provenance lock for the local assets (AO_ASSETS, a Recursos-shaped tree).
// Every file we consume (the client's tools/local-assets.mjs allowlist plus the server's whole Dat/) must hash to the pinned
// Recursos commit (tools/provenance/recursos-pin.sha256) or to an active patch in sources.lock.json. A consumed file that is not
// in the pin at all (HOO-era OGG/, new wav, new Dat files) fails too.
// An active patch is a recipe, not an exception: { path, base, sha256, script, doc, reason }, where base is the pinned hash and sha256
// the output of the script run on the pinned file (tools/data-patches/build-patched.mjs replays them; the test checks the hashes).
//   node tools/provenance/provenance.mjs --verify <root>          pin or active patch per file: exit 0 ok, 1 mismatch, 2 skipped (no root)
//   node tools/provenance/provenance.mjs --verify-pin <root>      untouched pin only: every active patch counts as a change
//   node tools/provenance/provenance.mjs --verify-patched <root>  the built copy: every active patch must be applied
//   node tools/provenance/provenance.mjs --write <root>           rewrite the manifest from a tree already verified against the pin commit
// Any other first argument exits 2 with the list of modes.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED_ASSETS } from '../local-assets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LOCK_PATH = join(HERE, 'sources.lock.json');
export const MANIFEST_PATH = join(HERE, 'recursos-pin.sha256');
/** Folders the client treats as optional (no minimap / silent client without them): a missing pinned file there is a warning. */
const OPTIONAL = /^(minimapas|ogg|wav|mp3)\//i;

export const isConsumed = path => ALLOWED_ASSETS.test(path) || /^Dat\//i.test(path);

export function consumedFiles(root) {
  const out = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      if (name === '.git') continue;
      const full = join(dir, name);
      const rel = relative(root, full).split(sep).join('/');
      if (statSync(full).isDirectory()) walk(full);
      else if (isConsumed(rel)) out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

export const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

export function readManifest(text = readFileSync(MANIFEST_PATH, 'utf8')) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (m) map.set(m[2].toLowerCase(), { path: m[2], sha256: m[1] });
  }
  return map;
}

export const readLock = (path = LOCK_PATH) => JSON.parse(readFileSync(path, 'utf8'));

/** Two hashes for a problem message: both in full plus the first hex digit where they part (1-based), so a near-miss is visible. */
export function hashMismatch(actual, expected) {
  const a = String(actual ?? 'none'), e = String(expected ?? 'none');
  let i = 0;
  while (i < a.length && i < e.length && a[i] === e[i]) i++;
  return `${a} vs ${e} (first difference at hex digit ${i + 1})`;
}

/** Problems in the lock itself: an active patch whose base is not the pinned hash, a path outside the pin, a missing script or hash. */
export function lockProblems(lock = readLock(), manifest = readManifest(), repoRoot = join(HERE, '..', '..')) {
  const out = [];
  for (const p of lock.patches?.active ?? []) {
    const pinned = manifest.get(p.path.toLowerCase());
    if (!pinned) out.push(`${p.path}: not a pinned file`);
    else if (p.base !== pinned.sha256) out.push(`${p.path}: base is not the pinned hash: ${hashMismatch(p.base, pinned.sha256)}`);
    if (!/^[0-9a-f]{64}$/.test(p.sha256 ?? '')) out.push(`${p.path}: no output sha256`);
    if (!p.script || !existsSync(join(repoRoot, p.script))) out.push(`${p.path}: script ${p.script} not found`);
    if (!(lock.patches.recipe ?? []).some(step => step.script === p.script)) out.push(`${p.path}: script ${p.script} is not in patches.recipe`);
  }
  return out;
}

/**
 * Compare the consumed files under `root` with the pinned manifest.
 * mode 'any' (default): each file is pinned or an active patch. 'pin': active patches count as changes. 'patched': every active
 * patch must be applied (a pristine file is listed in `unpatched`).
 * Returns { ok, checked, mismatched: [{ path, expected, actual }], unpinned, missing, missingOptional, patched, unpatched }.
 */
export function verifyAssets(root, { manifest = readManifest(), lock = readLock(), mode = 'any' } = {}) {
  const patches = new Map();
  if (mode !== 'pin') {
    for (const p of lock.patches?.active ?? []) {
      const key = p.path.toLowerCase();
      if (!patches.has(key)) patches.set(key, new Set());
      patches.get(key).add(p.sha256);
    }
  }
  const result = { ok: true, checked: 0, mismatched: [], unpinned: [], missing: [], missingOptional: [], patched: [], unpatched: [] };
  const seen = new Set();
  for (const rel of consumedFiles(root)) {
    const key = rel.toLowerCase();
    seen.add(key);
    const pinned = manifest.get(key);
    if (!pinned) { result.unpinned.push(rel); continue; }
    result.checked++;
    const actual = sha256(join(root, rel));
    if (actual === pinned.sha256) { if (mode === 'patched' && patches.has(key)) result.unpatched.push(rel); continue; }
    if (patches.get(key)?.has(actual)) { result.patched.push(rel); continue; }
    result.mismatched.push({ path: rel, expected: pinned.sha256, actual });
  }
  for (const [key, { path }] of manifest) {
    if (seen.has(key)) continue;
    (OPTIONAL.test(path) ? result.missingOptional : result.missing).push(path);
  }
  result.ok = !result.mismatched.length && !result.unpinned.length && !result.missing.length && !result.unpatched.length;
  return result;
}

export function writeManifest(root, path = MANIFEST_PATH) {
  const lines = consumedFiles(root).map(rel => `${sha256(join(root, rel))}  ${rel}`);
  writeFileSync(path, lines.join('\n') + '\n');
  return lines.length;
}

export function summarize(r, limit = 15) {
  const L = [`checked ${r.checked} pinned files: ${r.mismatched.length} changed, ${r.unpinned.length} not in the pin, ${r.missing.length} missing` +
    (r.patched.length ? `, ${r.patched.length} active patches applied` : '') + (r.unpatched.length ? `, ${r.unpatched.length} active patches NOT applied` : '') +
    (r.missingOptional.length ? `, ${r.missingOptional.length} optional files absent` : '')];
  for (const p of r.patched.slice(0, limit)) L.push(`  patched (lock patches.active): ${p}`);
  for (const p of r.unpatched.slice(0, limit)) L.push(`  not patched: ${p}`);
  for (const m of r.mismatched.slice(0, limit)) L.push(`  changed: ${m.path}`);
  for (const p of r.unpinned.slice(0, limit)) L.push(`  not in the pre-HOO pin: ${p}`);
  for (const p of r.missing.slice(0, limit)) L.push(`  missing: ${p}`);
  return L.join('\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
export const MODES = { '--verify': 'any', '--verify-pin': 'pin', '--verify-patched': 'patched', '--write': 'write' };

if (isMain) {
  const [mode, root = process.env.AO_ASSETS] = process.argv.slice(2);
  // An unknown mode (a typo of --verify-pin) must not quietly fall back to --verify.
  if (!Object.hasOwn(MODES, mode ?? '')) {
    console.error(`unknown mode ${JSON.stringify(mode ?? '')}; use one of ${Object.keys(MODES).join(', ')} followed by the Recursos dir`);
    process.exit(2);
  }
  if (!root || !existsSync(root)) {
    console.error('SKIPPED: no assets. Set AO_ASSETS (or pass a directory) to verify the pre-HOO pin; nothing was checked.');
    process.exit(2);
  }
  if (mode === '--write') console.log(`wrote ${writeManifest(root)} entries to ${relative(process.cwd(), MANIFEST_PATH)}`);
  else {
    const problems = lockProblems();
    for (const p of problems) console.log(`  lock: ${p}`);
    const r = verifyAssets(root, { mode: MODES[mode] });
    console.log(summarize(r, 40));
    process.exit(r.ok && !problems.length ? 0 : 1);
  }
}
