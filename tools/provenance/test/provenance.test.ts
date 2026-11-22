import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { consumedFiles, hashMismatch, lockProblems, MODES, readLock, readManifest, sha256, verifyAssets } from '../provenance.mjs';
// @ts-expect-error plain ESM script without types
import { buildPatched } from '../../data-patches/build-patched.mjs';
// @ts-expect-error plain ESM script without types
import { checkIntegrity, gapIds, loadDataSet, newGaps } from '../../data-integrity/integrity.mjs';

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

  it('--verify-pin rejects an active patch; --verify-patched requires every one', () => {
    const manifest = readManifest(manifestText());
    const npcs = sha256(join(root, 'Dat/npcs.dat'));
    const lockWith = (out: string) => ({ patches: { active: [{ path: 'Dat/npcs.dat', base: npcs, sha256: out }] } });
    // pristine tree: fine for 'any' and 'pin', but the patched copy must carry the patch
    expect(verifyAssets(root, { manifest, lock: lockWith('f'.repeat(64)), mode: 'pin' }).ok).toBe(true);
    const unpatched = verifyAssets(root, { manifest, lock: lockWith('f'.repeat(64)), mode: 'patched' });
    expect([unpatched.ok, unpatched.unpatched]).toEqual([false, ['Dat/npcs.dat']]);
    put(root, 'Dat/npcs.dat', '[NPC1]\r\nBody=1\r\nDesc=patched\r\n');
    const lock = lockWith(sha256(join(root, 'Dat/npcs.dat')));
    expect(verifyAssets(root, { manifest, lock }).ok).toBe(true);
    expect(verifyAssets(root, { manifest, lock, mode: 'patched' }).ok).toBe(true);
    expect(verifyAssets(root, { manifest, lock, mode: 'pin' }).mismatched.map((m: { path: string }) => m.path)).toEqual(['Dat/npcs.dat']);
    put(root, 'Dat/npcs.dat', '[NPC1]\r\nBody=1\r\n');
  });

  it('flags a lock entry whose base is not the pinned hash, or whose script is missing', () => {
    const manifest = readManifest(manifestText());
    const npcs = sha256(join(root, 'Dat/npcs.dat'));
    const script = 'tools/data-patches/apply-newbie-patches.py';
    const lock = (p: object) => ({ patches: { recipe: [{ script }], active: [{ path: 'Dat/npcs.dat', base: npcs, sha256: 'a'.repeat(64), script, ...p }] } });
    expect(lockProblems(lock({}), manifest)).toEqual([]);
    expect(lockProblems(lock({ base: 'b'.repeat(64) }), manifest)[0]).toMatch(/is not the pinned/);
    expect(lockProblems(lock({ script: 'tools/data-patches/nope.py' }), manifest).join()).toMatch(/not found/);
    expect(lockProblems(lock({ path: 'Dat/other.dat' }), manifest)[0]).toMatch(/not a pinned file/);
  });
});

describe('tooling edges (#115)', () => {
  it('a hash problem shows both hashes in full and where they part', () => {
    const a = 'ab'.repeat(32), b = 'ab'.repeat(16) + 'cd' + 'ab'.repeat(15);
    expect(hashMismatch(a, b)).toBe(`${a} vs ${b} (first difference at hex digit 33)`);
  });

  it('build-patched --only-patched keeps whole paths when --pin ends in a slash', () => {
    const pin = join(tmp, 'slash-pin');
    put(pin, 'Dat/npcs.dat', '[NPC1]\r\nBody=1\r\n');
    const base = sha256(join(pin, 'Dat/npcs.dat'));
    const lock = { patches: { recipe: [], active: [{ path: 'Dat/npcs.dat', base, sha256: base }] } };
    const out = join(tmp, 'slash-out');
    const r = buildPatched({ pin: pin + '/', out, onlyPatched: true, lock, log: () => {} });
    expect(r.problems).toEqual([]);
    expect(existsSync(join(out, 'Dat/npcs.dat'))).toBe(true);
  });

  it('provenance.mjs rejects an unknown mode instead of running --verify', () => {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('../provenance.mjs', import.meta.url)), '--verfy-pin', tmp], { encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/unknown mode "--verfy-pin"/);
    expect(Object.keys(MODES)).toEqual(['--verify', '--verify-pin', '--verify-patched', '--write']);
  });
});

describe('the committed lock', () => {
  it('every active patch starts from the pinned file and names a script of patches.recipe', () => {
    expect(lockProblems()).toEqual([]);
    const lock = readLock();
    expect(lock.patches.active.map((p: { path: string }) => p.path)).toEqual([
      'Dat/Ciudades.Dat', 'Dat/Motd.ini', 'Dat/npcs.dat', 'Dat/Quests.DAT', 'Mapas/Mapa64.csm', 'init/sp_localindex.dat',
      'interface/es_mapa2.bmp', 'interface/en_mapa2.bmp',
    ]);
  });

  it('names no HOO-era source: every pin predates 2026-08-12 and nothing points at Recursos 1b50fd6 or later', () => {
    const lock = readLock();
    for (const u of Object.values(lock.upstreams) as { pin: { date: string } }[]) expect(u.pin.date < lock.hooStart.date).toBe(true);
    const sources = JSON.stringify([lock.patches.recipe, lock.patches.active]);
    expect(sources).not.toMatch(/1b50fd6|89615f3|hoo-/i);
  });
});

describe('referential integrity (synthetic data set)', () => {
  // The shape of the 2026-10-10 Recursos npcs.dat: NPCs pointing at bodies the classic init/cuerpos.dat does not have.
  const root = join(tmp, 'data');
  put(root, 'init/cuerpos.dat', '[INIT]\r\nNumBodys=2\r\n[BODY1]\r\nWalk1=10\r\nWalk2=10\r\nWalk3=10\r\nWalk4=10\r\n[BODY2]\r\nStd=1\r\nFileNum=5\r\n');
  put(root, 'init/moldes.ini', '[MOLDE1]\r\nX=0\r\nY=0\r\nWidth=25\r\nHeight=45\r\nDir1=6\r\nDir2=6\r\nDir3=5\r\nDir4=5\r\n');
  const png = new Uint8Array(24); png.set([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 64, 0, 0, 0, 128]);
  put(root, 'Graficos/5.png', png); // a 64x128 PNG header is all the checker reads
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

  it('catches wrong item graphics: a sprite frame as inventory icon, a weapon anim beyond armas.dat, a graphic with no PNG', () => {
    // The 2026-10 obj.dat: "Escudo del Principiante" GrhIndex 3485 is a 26x46 cape frame; "Espada del Principiante" Anim 186 > NumArmas 184.
    put(root, 'init/graficos.ini', 'Grh10=1-5-0-0-32-32\r\nGrh11=1-5-32-0-32-32\r\nGrh12=1-5-0-32-26-46\r\nGrh13=1-9-0-0-32-32\r\n');
    put(root, 'init/armas.dat', '[INIT]\r\nNumArmas=1\r\n[ARMA1]\r\nDir1=10\r\nDir2=10\r\nDir3=10\r\nDir4=10\r\n');
    put(root, 'Dat/npcs.dat', '[NPC1]\r\nName=Sastre\r\nBody=1\r\n');
    put(root, 'Dat/obj.dat', '[OBJ1]\r\nName=Espada\r\nObjType=2\r\nGrhIndex=11\r\nAnim=1\r\n' +
      '[OBJ2]\r\nName=Espada del Principiante\r\nObjType=2\r\nGrhIndex=11\r\nAnim=186\r\n' +
      '[OBJ3]\r\nName=Escudo del Principiante\r\nObjType=16\r\nGrhIndex=12\r\n[OBJ4]\r\nName=Sin PNG\r\nObjType=11\r\nGrhIndex=13\r\n');
    const gaps = newGaps(checkIntegrity(loadDataSet(root)));
    expect(gaps['obj.weaponAnim']).toEqual([{ from: 'OBJ2', id: 186 }]);
    expect(gaps['obj.inventoryIcon']).toEqual([{ from: 'OBJ3', id: 3 }]);
    expect(gaps['obj.grhFile']).toEqual([{ from: 'OBJ4', id: 13 }]);
    expect(gaps['obj.weaponAnimGraphic']).toBeUndefined();
    put(root, 'Dat/obj.dat', '[OBJ1]\r\nName=Manzana\r\nGrhIndex=11\r\n[OBJ2]\r\n');
  });

  it('an empty object section counts as missing (the [OBJ1425] door case)', () => {
    put(root, 'Dat/npcs.dat', '[NPC1]\r\nName=Sastre\r\nBody=2\r\nObj1=2-10\r\n');
    expect(newGaps(checkIntegrity(loadDataSet(root)))['npc.shopObject']).toEqual([{ from: 'NPC1.obj1', id: 2 }]);
  });
});

const assets = process.env.AO_ASSETS && existsSync(process.env.AO_ASSETS) ? process.env.AO_ASSETS : '';
const pinned = process.env.AO_ASSETS_PIN && existsSync(process.env.AO_ASSETS_PIN) ? process.env.AO_ASSETS_PIN : '';
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
});

if (!pinned) {
  process.stderr.write('\n*** SKIPPED: no AO_ASSETS_PIN. Replaying patches.recipe on the untouched pin (the patched-copy hashes) did NOT run. ' +
    'Set AO_ASSETS_PIN to the untouched pre-HOO tree (provenance.mjs --verify-pin passes on it). ***\n\n');
}

describe.skipIf(!pinned)(`the patch recipe on AO_ASSETS_PIN${pinned ? '' : ' [skipped: no AO_ASSETS_PIN]'}`, () => {
  it('the scripts turn every pinned base into exactly the locked output', () => {
    const out = join(tmp, 'patched');
    // The world-2 pictures are an input, not derived from the pin: take them from AO_ASSETS only when it already holds the 043cdf20
    // bytes (hash-checked first, #115: AO_ASSETS may itself be the untouched pin), else let the script download them.
    const picture = readLock().patches.active.find((p: { path: string }) => p.path === 'interface/es_mapa2.bmp')!.sha256;
    const face = assets ? join(assets, 'interface') : '';
    const inputs = face && ['es_mapa2.bmp', 'en_mapa2.bmp'].every(n => existsSync(join(face, n)) && sha256(join(face, n)) === picture) ? face : undefined;
    const r = buildPatched({ pin: pinned, out, inputs, onlyPatched: true, log: () => {} });
    expect(r.problems).toEqual([]);
    expect(r.outputs.map((o: { sha256: string }) => o.sha256)).toEqual(readLock().patches.active.map((p: { sha256: string }) => p.sha256));
  }, 120_000);
});
