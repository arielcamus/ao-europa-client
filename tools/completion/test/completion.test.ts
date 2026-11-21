import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { outputs, ptStats, load } from '../build.mjs';

describe('completion checklist', () => {
  it('docs/COMPLETION.md and docs/PLAYTHROUGH.md are up to date (run node tools/completion/build.mjs)', () => {
    for (const [file, md] of outputs() as [string, string][]) expect(readFileSync(file, 'utf8'), file).toBe(md);
  });

  it('every playthrough step is complete and ids are unique', () => {
    const { pt } = load();
    const ids = new Set<string>();
    for (const c of pt.categories) for (const s of c.steps) {
      expect(ids.has(s.id), `duplicate ${s.id}`).toBe(false);
      ids.add(s.id);
      for (const k of ['step', 'expected', 'source', 'how']) expect(String(s[k] ?? '').length, `${s.id}.${k}`).toBeGreaterThan(0);
      expect(['auto', 'manual']).toContain(s.mode);
      expect(['untested', 'recorded', 'in flight', 'passing', 'passing (hand-merged)', 'failing', 'blocked']).toContain(s.status);
    }
    expect(ptStats(pt).total).toBe(ids.size);
  });
});
