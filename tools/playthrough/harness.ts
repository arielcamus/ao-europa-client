// AGPL-3.0-or-later. Step runner + report for the playthrough harness (WP-D). A step is `step(id, async c => { ... })`: throw = fail,
// `c.blocked(reason)` = cannot be asserted on this server/data, return = pass. The report is the single input tools/completion/build.mjs reads.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { Sess, SERVER } from './session.js';
import type { Page } from '@playwright/test';

export type Outcome = 'pass' | 'fail' | 'blocked';
export interface StepResult { id: string; outcome: Outcome; detail: string; ms: number; evidence?: string; at?: string }
export class Blocked extends Error {}
export interface Env { relogin: (which?: 'player' | 'gm') => Promise<void>; gmName: string; email: string; password: string; charName: string; playerFresh: boolean; own: boolean; gm: Sess; player: Sess; page?: Page; webBase: string; creation: { attempts: number; ok: boolean; errors: string[] }; fixtureDir: string; shared: Record<string, unknown>; shots: string }
export interface Ctx extends Env {
  blocked(reason: string): never;
  note(text: string): void;
  eq<T>(actual: T, expected: T, what: string): void;
  ok(cond: unknown, what: string): void;
  near(actual: number, lo: number, hi: number, what: string): void;
  /** save a fixture jsonl of the player's wire since `from` under tests/fixtures/vb6/playthrough/ */
  fixture(name: string, sess: Sess, from: number): void;
}
export type Body = (c: Ctx) => Promise<void>;
export const registry: { id: string; body: Body }[] = [];
export const step = (id: string, body: Body) => registry.push({ id, body });

export function makeCtx(env: Env): { ctx: Ctx; notes: string[] } {
  const notes: string[] = [];
  const methods: Omit<Ctx, keyof Env> = {
    blocked(reason) { throw new Blocked(reason); },
    note(t) { notes.push(t); },
    eq(a, e, what) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${what}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); notes.push(`${what} = ${JSON.stringify(a)}`); },
    ok(c, what) { if (!c) throw new Error(`${what}: false`); notes.push(what); },
    near(a, lo, hi, what) { if (!(a >= lo && a <= hi)) throw new Error(`${what}: ${a} not in [${lo}, ${hi}]`); notes.push(`${what} = ${a}`); },
    fixture(name, s, from) {
      mkdirSync(env.fixtureDir, { recursive: true });
      writeFileSync(`${env.fixtureDir}/${name}.jsonl`, s.jsonl(from)); notes.push(`fixture ${name}`);
    },
  };
  const ctx = Object.assign(Object.create(env) as Env, methods) as Ctx;
  return { ctx, notes };
}

export async function runSteps(env: Env, only: string[] | undefined, log: (m: string) => void): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const { id, body } of registry) {
    if (only && !only.some(p => id.startsWith(p))) continue;
    for (const which of ['player', 'gm'] as const) { const sess = env[which]; let closed = false; try { closed = sess.closed; } catch { /* GM proxy */ } if (closed) { try { await env.relogin(which); log(`(re-logged in ${which})`); } catch (e) { log(`relogin ${which} failed: ${e}`); } } }
    const { ctx, notes } = makeCtx(env);
    const t = Date.now();
    let outcome: Outcome = 'pass', detail = '';
    try {
      await Promise.race([body(ctx), new Promise((_, rej) => setTimeout(() => rej(new Error('step timeout')), Number(process.env.AO_STEP_TIMEOUT_MS ?? 1_200_000)))]);
      detail = notes.join('; ');
    } catch (e) {
      if (e instanceof Blocked) { outcome = 'blocked'; detail = e.message; }
      else { outcome = 'fail'; detail = `${e instanceof Error ? e.message : String(e)}${notes.length ? ` [ok so far: ${notes.join('; ')}]` : ''}`; }
    }
    const r = { id, outcome, detail: detail.slice(0, 900), ms: Date.now() - t, at: new Date().toISOString() };
    results.push(r);
    log(`${outcome.toUpperCase().padEnd(7)} ${id} ${r.detail.slice(0, 160)}`);
  }
  return results;
}

export function writeReport(results: StepResult[], meta: Record<string, unknown>, path: string) {
  const prev: { results?: StepResult[] } = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  // A partial run (AO_STEPS) merges into the previous report; a full run replaces it.
  const merged = new Map((prev.results ?? []).map(r => [r.id, r]));
  for (const r of results) merged.set(r.id, r);
  const all = [...merged.values()];
  const count = (o: Outcome) => all.filter(r => r.outcome === o).length;
  mkdirSync(path.replace(/\/[^/]+$/, ''), { recursive: true });
  writeFileSync(path, JSON.stringify({ generated: new Date().toISOString(), server: `${SERVER.host}:${SERVER.port}`, ...meta, totals: { pass: count('pass'), fail: count('fail'), blocked: count('blocked') }, results: all }, null, 1) + '\n');
}
