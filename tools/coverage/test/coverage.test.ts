import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { computeCoverage, parseEnums, discoverRefs, renderMarkdown } from '../build-map.mjs';

interface Pkt { key: string; name: string; covered: boolean; merged: boolean; branches: string[]; codecFiles: string[]; package: string }
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const refs = discoverRefs();
const cov = computeCoverage({ refs });

describe('feature coverage map', () => {
  it('scans only the checked-out tree, never other branches or PRs', () => {
    expect(refs.map((r: { name: string }) => r.name)).toEqual(['main']);
  });

  it('docs/COVERAGE.md and docs/coverage.json are up to date with the checked-out tree', () => {
    const md = readFileSync(join(ROOT, 'docs', 'COVERAGE.md'), 'utf8');
    const json = readFileSync(join(ROOT, 'docs', 'coverage.json'), 'utf8');
    expect(md, 'run node tools/coverage/build-map.mjs').toBe(renderMarkdown(cov) + '\n');
    expect(json, 'run node tools/coverage/build-map.mjs').toBe(JSON.stringify(cov, null, 1) + '\n');
  });

  it('reads the VB6 enums from the cached snapshot', () => {
    const e = parseEnums();
    const byName = (d: 's2c' | 'c2s', n: string) => e[d].find((p: { name: string }) => p.name === n)?.id;
    expect(byName('s2c', 'Connected')).toBe(1);
    expect(byName('s2c', 'ChangeMap')).toBe(30);
    expect(byName('c2s', 'Walk')).toBe(78);
    expect(byName('c2s', 'LoginAccount')).toBe(305);
    expect(e.s2c.length + e.c2s.length).toBe(cov.headline.packets);
  });

  it('every packet listed as covered has a codec registered in a codec table', () => {
    for (const p of cov.packets as Pkt[]) {
      if (!p.covered) continue;
      expect(p.codecFiles.length, `${p.key} ${p.name} is covered but has no codec file`).toBeGreaterThan(0);
      expect(p.merged || p.branches.length > 0, `${p.key} covered with no ref`).toBe(true);
    }
  });

  it('the scan found no id/name mismatches, undeclared ids, ids without codecs or unclassified packets', () => {
    expect(cov.problems).toEqual([]);
  });

  it('claims in the committed docs/coverage.json still hold (rot check)', () => {
    const file = join(ROOT, 'docs', 'coverage.json');
    if (!existsSync(file)) return;
    const committed = JSON.parse(readFileSync(file, 'utf8'));
    const present = new Set(refs.map((r: { name: string }) => r.name));
    const now = new Map((cov.packets as Pkt[]).map((p) => [p.key, p]));
    for (const old of committed.packets as Pkt[]) {
      const cur = now.get(old.key)!;
      if (old.merged) expect(cur.merged, `${old.key} ${old.name} was merged on main and lost its codec`).toBe(true);
      for (const b of old.branches) if (present.has(b)) expect(cur.branches.includes(b) || cur.merged, `${old.key} ${old.name} lost its codec on ${b}`).toBe(true);
    }
  });

  it('puts every packet and form in exactly one work package', () => {
    const ids = new Set(cov.workPackages.map((w: { id: string }) => w.id));
    for (const p of cov.packets as Pkt[]) expect(ids.has(p.package), p.key).toBe(true);
    const seen = new Set<string>();
    for (const w of cov.workPackages as { packetIds: string[]; forms: string[] }[]) for (const k of [...w.packetIds, ...w.forms]) { expect(seen.has(k), `${k} is in two packages`).toBe(false); seen.add(k); }
  });

  it('lists a duplicate only when two or more branches carry the codec', () => {
    for (const d of cov.duplicates as { branches: string[] }[]) expect(d.branches.length).toBeGreaterThan(1);
  });
});
