#!/usr/bin/env node
// AGPL-3.0-or-later. Builds the patched asset tree from the untouched pre-HOO pin by replaying tools/provenance/sources.lock.json
// patches.recipe (the tools/data-patches/*.py scripts, in order), then checks every output hash against patches.active.
// The pin is never written: the output is a copy (an APFS clone on macOS, so it costs no disk space).
//   node tools/data-patches/build-patched.mjs --pin <pinned Recursos tree> --out <new dir> [--inputs <dir>] [--only-patched]
//   --inputs        folder holding extra pre-HOO inputs a step needs (the 043cdf20 world-2 pictures); otherwise downloaded
//   --only-patched  copy only the files the patches touch (for the test; the result is not a usable asset tree)
// Exit 0 when the output matches the lock, 1 otherwise.
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLock, readManifest, sha256, verifyAssets } from '../provenance/provenance.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** `rel` under `root` with the on-disk case of every segment (Recursos mixes Dat/DAT, Mapa64/mapa64). */
export function resolveCase(root, rel) {
  let dir = root;
  for (const part of rel.split('/')) {
    const hit = existsSync(dir) ? readdirSync(dir).find(name => name.toLowerCase() === part.toLowerCase()) : undefined;
    dir = join(dir, hit ?? part);
  }
  return dir;
}

export function buildPatched({ pin, out, inputs, onlyPatched = false, lock = readLock(), manifest = readManifest(), log = console.log }) {
  const active = lock.patches?.active ?? [];
  const problems = [];
  if (existsSync(out)) throw new Error(`${out} exists; the build writes a fresh tree`);
  if (onlyPatched) {
    for (const p of active) {
      const src = resolveCase(pin, p.path);
      if (!existsSync(src)) { problems.push(`${p.path}: missing in the pin`); continue; }
      if (sha256(src) !== p.base) problems.push(`${p.path}: the pin's file is not the pinned base ${p.base.slice(0, 12)}`);
      const dest = join(out, src.slice(pin.length + 1));
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
  } else {
    const pinCheck = verifyAssets(pin, { manifest, lock, mode: 'pin' });
    if (!pinCheck.ok) throw new Error(`${pin} is not the untouched pin: ${pinCheck.mismatched.length} changed, ${pinCheck.unpinned.length} not in the pin, ${pinCheck.missing.length} missing (run provenance.mjs --verify-pin)`);
    // -c: APFS clone (copy on write). Elsewhere a plain recursive copy.
    const clone = spawnSync('cp', ['-cR', pin, out], { stdio: 'inherit' });
    if (clone.status !== 0) cpSync(pin, out, { recursive: true });
  }
  if (problems.length) return { ok: false, problems };
  for (const step of lock.patches?.recipe ?? []) {
    const args = step.args.map(a => a.replaceAll('{root}', out));
    if (step.inputsFlag && inputs) args.push(step.inputsFlag, inputs);
    const run = spawnSync('python3', [join(REPO, step.script), ...args], { encoding: 'utf8' });
    const lines = (run.stdout ?? '').trim().split('\n').filter(Boolean);
    log(`${step.script} (${step.doc}): ${lines.length === 1 ? lines[0] : `${lines.length} edits`}`);
    if (run.status !== 0) { problems.push(`${step.script} exited ${run.status}: ${(run.stderr ?? '').trim()}`); return { ok: false, problems }; }
  }
  const outputs = active.map(p => {
    const file = resolveCase(out, p.path);
    const actual = existsSync(file) ? sha256(file) : 'missing';
    if (actual !== p.sha256) problems.push(`${p.path}: built ${actual.slice(0, 12)}, the lock expects ${p.sha256.slice(0, 12)}`);
    return { path: p.path, sha256: actual };
  });
  let verify;
  if (!onlyPatched) {
    verify = verifyAssets(out, { manifest, lock, mode: 'patched' });
    if (!verify.ok) problems.push(`--verify-patched: ${verify.mismatched.length} changed, ${verify.unpatched.length} not patched, ${verify.unpinned.length} not in the pin, ${verify.missing.length} missing`);
  }
  return { ok: !problems.length, problems, outputs, verify };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const pin = opt('--pin'), out = opt('--out');
  if (!pin || !out) { console.error('usage: build-patched.mjs --pin <pinned tree> --out <new dir> [--inputs <dir>] [--only-patched]'); process.exit(2); }
  const r = buildPatched({ pin, out, inputs: opt('--inputs'), onlyPatched: argv.includes('--only-patched') });
  for (const o of r.outputs ?? []) console.log(`${o.sha256}  ${o.path}`);
  for (const p of r.problems) console.log(`PROBLEM: ${p}`);
  console.log(r.ok ? `ok: ${out} = pin + ${(r.outputs ?? []).length} active patches, every hash as locked` : 'FAILED');
  process.exit(r.ok ? 0 : 1);
}
