// AGPL-3.0-or-later. WP-D end-to-end playthrough against the REAL VB6 server (docs/PLAYTHROUGH.md). Run: pnpm playthrough
// (AO_ASSETS=~/Projects/ao-reference/Recursos-prehoo, AO_SERVER_HOST/AO_SERVER_PORT, AO_STEPS=ACC-,MOV- to filter). Writes
// tools/completion/playthrough-report.json, which tools/completion/build.mjs reads.
import { test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Sess } from '../../../tools/playthrough/session.js';
import { runSteps, writeReport, Blocked } from '../../../tools/playthrough/harness.js';
import type { Env } from '../../../tools/playthrough/harness.js';
import { registerAll } from '../../../tools/playthrough/steps/index.js';

const GM = { email: process.env.AO_GM_EMAIL ?? 'aotest@local.test', password: process.env.AO_GM_PASSWORD ?? 'aotestpw1', char: process.env.AO_GM_CHAR ?? 'Aotest' };
const FALLBACK = { email: process.env.AO_FALLBACK_EMAIL ?? 'aotest@local.test', password: process.env.AO_FALLBACK_PASSWORD ?? 'aotestpw1', char: process.env.AO_FALLBACK_CHAR ?? 'Aotesta' };
const letters = (n: number) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');

test('playthrough', async ({ page, baseURL }) => {
  const t0 = Date.now();
  const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
  const only = process.env.AO_STEPS?.split(',').filter(Boolean);
  // 1. own account + character (the server bug: creation sometimes never answers; retry up to 3 times, report).
  const CACHE = 'artifacts/playthrough/account.json';
  let email = `playthrough${Date.now()}@local.test`, password = 'playthroughpw1';
  const creation = { attempts: 0, ok: false, errors: [] as string[], reused: false };
  let player: Sess | undefined, charName = '';
  // A character created by an earlier run is reused when AO_REUSE=1 (creation is the slow, intermittent part); ACC-03..06 then say "not fresh".
  if (process.env.AO_REUSE === '1' && existsSync(CACHE)) {
    const saved = JSON.parse(readFileSync(CACHE, 'utf8'));
    const s = await Sess.open();
    try { await s.loginAccount(saved.email, saved.password); const c = s.characters.find(c => c.name === saved.charName)!; await s.loginChar(c.id, c.name); player = s; email = saved.email; password = saved.password; charName = saved.charName; creation.reused = true; }
    catch (e) { creation.errors.push(`reuse failed: ${e}`); s.close(); }
  }
  const maxAttempts = Number(process.env.AO_CREATE_ATTEMPTS ?? 3);
  for (let i = 0; i < maxAttempts && !player; i++) {
    creation.attempts++;
    const s = await Sess.open();
    try {
      if (i === 0) await s.createAccount(email, password); else await s.loginAccount(email, password);
      charName = `Pt${letters(7)}`;
      const r = await s.createChar({ name: charName, race: 1, gender: 1, characterClass: 1, head: 1, home: Number(process.env.AO_HOME ?? 2) }); // Nix: the city picker's 2nd entry (ACC-04)
      if (r.ok) { creation.ok = true; player = s; mkdirSync('artifacts/playthrough', { recursive: true }); writeFileSync(CACHE, JSON.stringify({ email, password, charName })); } else { creation.errors.push(r.error); s.close(); await s.sleep(3000); }
    } catch (e) { creation.errors.push(String(e)); s.close(); }
  }
  log(`creation: ${creation.ok ? 'ok' : 'FAILED'} after ${creation.attempts} attempt(s) ${creation.errors.join(' | ')}`);
  let acct = { email, password };
  if (!player) { // fallback: an existing test character
    acct = FALLBACK; charName = FALLBACK.char;
    player = await Sess.open(); await player.loginAccount(FALLBACK.email, FALLBACK.password);
    const c = player.characters.find(c => c.name === FALLBACK.char)!; await player.loginChar(c.id, c.name);
  }
  // GM helper session: the first free character of the GM account (Aotest is shared with other agents; a login collision just tries the next).
  let gm!: Sess, gmName = '';
  for (let round = 0; round < 3 && !gm; round++) for (const name of [GM.char, 'Aotesta', 'Winapplicant']) {
    if (name === charName || gm) continue;
    const s = await Sess.open();
    try { await s.loginAccount(GM.email, GM.password); const c = s.characters.find(c => c.name === name); if (!c) { s.close(); continue; } await s.loginChar(c.id, c.name); if (!s.isGM) { s.close(); continue; } gm = s; gmName = name; log(`GM session: ${name}`); }
    catch (e) { log(`GM ${name} unavailable (${round}): ${e}`); s.close(); await s.sleep(4000); }
  }
  if (!gm) { // GM-dependent steps become BLOCKED, the rest still run
    log('NO GM character available (Aotest is held by another agent?): GM-dependent steps will be blocked');
    gm = new Proxy({} as Sess, { get: () => { throw new Blocked('needs the GM helper character (Aotest), which was held by another session for the whole run; re-run when it is free'); } });
  }
  const env: Env = {
    email: acct.email, password: acct.password, charName, playerFresh: creation.ok && !creation.reused, own: creation.ok || creation.reused, gm, player, page, webBase: baseURL!, creation,
    shared: {}, fixtureDir: 'tests/fixtures/vb6/playthrough', shots: 'artifacts/screenshots',
    gmName,
    async relogin(which = 'player') {
      const old = which === 'gm' ? env.gm : env.player, [mail, pw, name] = which === 'gm' ? [GM.email, GM.password, env.gmName] : [env.email, env.password, env.charName];
      old.close(); await old.sleep(3000);
      let last: unknown;
      for (let i = 0; i < 4; i++) {
        const s = await Sess.open();
        try { await s.loginAccount(mail, pw); const c = s.characters.find(c => c.name === name)!; await s.loginChar(c.id, c.name); if (which === 'gm') env.gm = s; else env.player = s; return; }
        catch (e) { last = e; s.close(); await old.sleep(5000); }
      }
      throw last;
    },
  };
  registerAll();
  let results;
  try { results = await runSteps(env, only, log); }
  finally { env.player.close(); gm.close(); }
  writeReport(results, { account: creation.reused ? 'reused' : creation.ok ? 'fresh' : 'fallback', character: charName, creation, wallClockSeconds: Math.round((Date.now() - t0) / 1000) }, 'tools/completion/playthrough-report.json');
  log(`done: ${results.filter(r => r.outcome === 'pass').length} pass, ${results.filter(r => r.outcome === 'fail').length} fail, ${results.filter(r => r.outcome === 'blocked').length} blocked`);
});
