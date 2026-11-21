#!/usr/bin/env node
// AGPL-3.0-or-later. Pre-HOO provenance lock for the local assets (AO_ASSETS, a Recursos-shaped tree).
// Every file we consume (the client's tools/local-assets.mjs allowlist plus the server's whole Dat/) must hash to the pinned
// Recursos commit (tools/provenance/recursos-pin.sha256) or to an active patch in sources.lock.json. A consumed file that is not
// in the pin at all (HOO-era OGG/, new wav, new Dat files) fails too.
//   node tools/provenance/provenance.mjs --verify <root>   exit 0 ok, 1 mismatch, 2 skipped (no root)
//   node tools/provenance/provenance.mjs --write <root>    rewrite the manifest from a tree already verified against the pin commit
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

/**
 * Compare the consumed files under `root` with the pinned manifest.
 * Returns { ok, checked, mismatched: [{ path, expected, actual }], unpinned: [path], missing: [path], missingOptional: [path], patched: [path] }.
 */
export function verifyAssets(root, { manifest = readManifest(), lock = readLock() } = {}) {
  const patches = new Map();
  for (const p of lock.patches?.active ?? []) {
    const key = p.path.toLowerCase();
    if (!patches.has(key)) patches.set(key, new Set());
    patches.get(key).add(p.sha256);
  }
  const result = { ok: true, checked: 0, mismatched: [], unpinned: [], missing: [], missingOptional: [], patched: [] };
  const seen = new Set();
  for (const rel of consumedFiles(root)) {
    const key = rel.toLowerCase();
    seen.add(key);
    const pinned = manifest.get(key);
    if (!pinned) { result.unpinned.push(rel); continue; }
    result.checked++;
    const actual = sha256(join(root, rel));
    if (actual === pinned.sha256) continue;
    if (patches.get(key)?.has(actual)) { result.patched.push(rel); continue; }
    result.mismatched.push({ path: rel, expected: pinned.sha256, actual });
  }
  for (const [key, { path }] of manifest) {
    if (seen.has(key)) continue;
    (OPTIONAL.test(path) ? result.missingOptional : result.missing).push(path);
  }
  result.ok = !result.mismatched.length && !result.unpinned.length && !result.missing.length;
  return result;
}

export function writeManifest(root, path = MANIFEST_PATH) {
  const lines = consumedFiles(root).map(rel => `${sha256(join(root, rel))}  ${rel}`);
  writeFileSync(path, lines.join('\n') + '\n');
  return lines.length;
}

export function summarize(r, limit = 15) {
  const L = [`checked ${r.checked} pinned files: ${r.mismatched.length} changed, ${r.unpinned.length} not in the pin, ${r.missing.length} missing` +
    (r.patched.length ? `, ${r.patched.length} allowlisted patches` : '') + (r.missingOptional.length ? `, ${r.missingOptional.length} optional files absent` : '')];
  for (const m of r.mismatched.slice(0, limit)) L.push(`  changed: ${m.path}`);
  for (const p of r.unpinned.slice(0, limit)) L.push(`  not in the pre-HOO pin: ${p}`);
  for (const p of r.missing.slice(0, limit)) L.push(`  missing: ${p}`);
  return L.join('\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const [mode, root = process.env.AO_ASSETS] = process.argv.slice(2);
  if (!root || !existsSync(root)) {
    console.error('SKIPPED: no assets. Set AO_ASSETS (or pass a directory) to verify the pre-HOO pin; nothing was checked.');
    process.exit(2);
  }
  if (mode === '--write') console.log(`wrote ${writeManifest(root)} entries to ${relative(process.cwd(), MANIFEST_PATH)}`);
  else {
    const r = verifyAssets(root);
    console.log(summarize(r, 40));
    process.exit(r.ok ? 0 : 1);
  }
}
