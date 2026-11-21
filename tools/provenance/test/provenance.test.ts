import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { consumedFiles, readLock, readManifest, sha256, verifyAssets } from '../provenance.mjs';
// @ts-expect-error plain ESM script without types
import { checkIntegrity, findPath, gapIds, loadDataSet, newGaps } from '../../data-integrity/integrity.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'ao-provenance-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const put = (root: string, rel: string, body: string | Uint8Array) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), body);
};

describe('provenance lock (synthetic tree)', () => {
  const root = join(tmp, 'tree');
  put(root, 'Dat/npcs.dat', '[NPC1]\r\nBody=1\r\n');
  put(root, 'init/cuerpos.dat', '[BODY1]\r\nWalk1=1\r\n');
  put(root, 'Graficos/1.png', new Uint8Array([1, 2, 3]));
  put(root, 'tools/not-consumed.exe', 'x');
  const manifestText = () => consumedFiles(root).map((rel: string) => `${sha256(join(root, rel))}  ${rel}`).join('\n') + '\n';
  const lock = { patches: { active: [] as { path: string; sha256: string }[] } };

  it('hashes exactly the consumed files: the client allowlist plus Dat/', () => {
    expect(consumedFiles(root)).toEqual(['Dat/npcs.dat', 'Graficos/1.png', 'init/cuerpos.dat']);
  });

  it('passes on the pinned bytes, fails on a changed file, an unpinned file and a missing file', () => {
    const manifest = readManifest(manifestText());
    expect(verifyAssets(root, { manifest, lock }).ok).toBe(true);
    put(root, 'Dat/npcs.dat', '[NPC1]\r\nBody=6243\r\n');
    put(root, 'OGG/1.ogg', 'post-pin sound');
    const r = verifyAssets(root, { manifest, lock });
    expect(r.ok).toBe(false);
    expect(r.mismatched.map((m: { path: string }) => m.path)).toEqual(['Dat/npcs.dat']);
    expect(r.unpinned).toEqual(['OGG/1.ogg']);
    rmSync(join(root, 'OGG'), { recursive: true });
    rmSync(join(root, 'init/cuerpos.dat'));
    expect(verifyAssets(root, { manifest, lock }).missing).toEqual(['init/cuerpos.dat']);
    put(root, 'init/cuerpos.dat', '[BODY1]\r\nWalk1=1\r\n');
  });

  it('accepts a changed file only when its exact hash is an active patch in the lock', () => {
    const manifest = readManifest(manifestText().replace(/^\w+(?= {2}Dat\/npcs\.dat)/m, '0'.repeat(64)));
    expect(verifyAssets(root, { manifest, lock }).ok).toBe(false);
    const patched = { patches: { active: [{ path: 'Dat/npcs.dat', sha256: sha256(join(root, 'Dat/npcs.dat')) }] } };
    const r = verifyAssets(root, { manifest, lock: patched });
    expect(r.ok).toBe(true);
    expect(r.patched).toEqual(['Dat/npcs.dat']);
  });
});

describe('referential integrity (synthetic data set)', () => {
  // The shape of the 2026-10-10 Recursos npcs.dat: NPCs pointing at bodies the classic init/cuerpos.dat does not have.
  const root = join(tmp, 'data');
  put(root, 'init/cuerpos.dat', '[INIT]\r\nNumBodys=2\r\n[BODY1]\r\nWalk1=10\r\n[BODY2]\r\nStd=1\r\nFileNum=5\r\n');
  put(root, 'init/graficos.ini', 'Grh10=1-5-0-0-32-32\r\nGrh11=1-5-32-0-32-32\r\n');
  put(root, 'Dat/obj.dat', '[OBJ1]\r\nName=Manzana\r\nGrhIndex=11\r\n[OBJ2]\r\n');
  put(root, 'Dat/npcs.dat', '[NPC1]\r\nName=Sastre\r\nBody=2\r\nObj1=1-10\r\n');

  it('a consistent set has no dangling references', () => {
    const r = checkIntegrity(loadDataSet(root));
    expect(gapIds(r)).toEqual({});
    expect(r.checks['npc.body'].refs).toBe(1);
  });

  it('catches the invisible-NPC case: a body that cuerpos.dat does not define', () => {
    put(root, 'Dat/npcs.dat', '[NPC1]\r\nName=Gertha <Maestra Sastre>\r\nBody=6243\r\nObj1=1-10\r\n[NPC2]\r\nName=Ok\r\nBody=1\r\n');
    const r = checkIntegrity(loadDataSet(root));
    expect(newGaps(r)['npc.body']).toEqual([{ from: 'NPC1.body', id: 6243 }]);
    expect(newGaps(r, { 'npc.body': [6243] })).toEqual({}); // a baseline entry silences only that id
  });

  it('an empty object section counts as missing (the [OBJ1425] door case)', () => {
    put(root, 'Dat/npcs.dat', '[NPC1]\r\nName=Sastre\r\nBody=2\r\nObj1=2-10\r\n');
    expect(newGaps(checkIntegrity(loadDataSet(root)))['npc.shopObject']).toEqual([{ from: 'NPC1.obj1', id: 2 }]);
  });
});

const assets = process.env.AO_ASSETS && existsSync(process.env.AO_ASSETS) ? process.env.AO_ASSETS : '';
if (!assets) {
  process.stderr.write('\n*** SKIPPED: no assets. The pre-HOO provenance (sha256 lock) and the referential-integrity check of the real data set did NOT run. ' +
    'Set AO_ASSETS to a Recursos tree pinned per tools/provenance/sources.lock.json to run them. ***\n\n');
}

describe.skipIf(!assets)(`real assets under AO_ASSETS${assets ? '' : ' [skipped: no assets]'}`, () => {
  it('every consumed file matches the pre-HOO pin or an allowlisted patch', () => {
    const r = verifyAssets(assets);
    const summary = { changed: r.mismatched.map((m: { path: string }) => m.path).slice(0, 20), notInPin: r.unpinned.slice(0, 20), missing: r.missing.slice(0, 20) };
    expect(summary, 'AO_ASSETS is not the pre-HOO Recursos pin; see docs/PROVENANCE.md').toEqual({ changed: [], notInPin: [], missing: [] });
  }, 120_000);

  it('no dangling body/head/graphic/object/NPC/spell/quest id beyond the known upstream gaps', () => {
    const lock = readLock();
    const fresh = newGaps(checkIntegrity(loadDataSet(assets)), lock.knownGaps);
    const brief = Object.fromEntries(Object.entries(fresh).map(([k, v]) => [k, (v as { from: string; id: number }[]).slice(0, 5)]));
    expect(brief).toEqual({});
  }, 120_000);

  // Proof that the check catches the HOO-era data: point AO_HOO_NPCS at the 2026-10-10 npcs.dat (git show 1b50fd6:Dat/npcs.dat in
  // ao-org/Recursos). It is never committed here; the test swaps it into a temporary copy of the pinned Dat/.
  const hoo = process.env.AO_HOO_NPCS && existsSync(process.env.AO_HOO_NPCS) ? process.env.AO_HOO_NPCS : '';
  it.skipIf(!hoo)('the HOO-era npcs.dat fails the integrity check (AO_HOO_NPCS)', () => {
    const dat = join(tmp, 'hoo-dat');
    cpSync(findPath(assets, 'Dat'), dat, { recursive: true });
    copyFileSync(hoo, join(dat, 'npcs.dat'));
    const fresh = newGaps(checkIntegrity(loadDataSet(assets, { datDir: dat })), readLock().knownGaps);
    expect(fresh['npc.body']?.length ?? 0).toBeGreaterThan(500);
    expect(fresh['map.npc']?.length ?? 0).toBeGreaterThan(0);
    expect(readFileSync(join(dat, 'npcs.dat')).length).toBeGreaterThan(0);
  }, 120_000);
});
