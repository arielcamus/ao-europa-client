import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, request } from 'node:http';
import type { Server } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_IMAGE_BYTES, RateLimiter, bugReportOptionsFromEnv, createBugReportHandler, issueContent, pushPending, pushToGitHub, redact, validateReport,
} from '../../../tools/bug-reports.mjs';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
const pngUrl = `data:image/png;base64,${PNG.toString('base64')}`;
const report = (over: Record<string, unknown> = {}) => ({
  schema: 1, sessionId: 'abcdef12-3456', createdAt: '2026-11-22T09:00:00.000Z', text: 'Me trabé en la puerta', expected: 'pasar', phase: 'playing',
  character: { name: 'Aotest', level: 5, className: 'Mago', map: 751, x: 50, y: 60, hp: 10, maxHp: 20, evil: 'x' },
  client: { commit: 'abc123' }, environment: { userAgent: 'UA', viewport: { width: 1440, height: 900 }, devicePixelRatio: 2 }, stats: { fps: 60 },
  openWindows: ['options'], chat: ['hola'], console: [{ at: 't', level: 'warn', text: 'x' }], protocol: [{ at: '2026-11-22T09:00:00.100Z', dir: 'in', id: 1, name: 'Connected' }],
  errors: [], extra: 'dropped', ...over,
});

describe('RateLimiter', () => {
  it('allows `limit` hits per window per key and says when to retry', () => {
    let now = 0;
    const limiter = new RateLimiter({ limit: 2, windowMs: 1000, now: () => now });
    limiter.record('a'); limiter.record('a');
    expect(limiter.check('a')).toEqual({ ok: false, retryAfterMs: 1000 });
    expect(limiter.check('b')).toEqual({ ok: true });
    now = 600; expect(limiter.check("a")).toEqual({ ok: false, retryAfterMs: 400 });
    now = 1001; expect(limiter.check('a')).toEqual({ ok: true });
  });
});

describe('validateReport', () => {
  it('accepts a report, keeps known fields only and decodes the screenshot', () => {
    const result = validateReport(report({ screenshot: pngUrl, screenshotInfo: { width: 4, height: 2 } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report).not.toHaveProperty('extra');
    expect(result.report.character).not.toHaveProperty('evil');
    expect(result.report.character).toMatchObject({ name: 'Aotest', level: 5, map: 751 });
    expect(result.image).toMatchObject({ ext: 'png', type: 'image/png' });
    expect(result.image!.buffer.equals(PNG)).toBe(true);
    expect(result.report.screenshotInfo).toEqual({ width: 4, height: 2, type: 'image/png', bytes: PNG.length });
  });
  it('rejects malformed reports with a reason', () => {
    const bad = (over: Record<string, unknown>) => validateReport(report(over));
    expect(validateReport(null)).toMatchObject({ ok: false, status: 400 });
    expect(bad({ schema: 2 })).toMatchObject({ ok: false, error: 'unsupported schema' });
    expect(bad({ sessionId: 'x' })).toMatchObject({ ok: false, error: 'invalid sessionId' });
    expect(bad({ text: '   ' })).toMatchObject({ ok: false, error: 'text is required' });
    expect(bad({ screenshot: 'data:image/gif;base64,AAAA' })).toMatchObject({ ok: false, status: 415 });
    expect(bad({ screenshot: `data:image/png;base64,${Buffer.from('not a png at all').toString('base64')}` })).toMatchObject({ ok: false, status: 415 });
    expect(bad({ screenshot: `data:image/png;base64,${Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]).toString('base64')}` })).toMatchObject({ ok: false, status: 413 });
  });
  it('redacts again on the server and bounds the lists', () => {
    const result = validateReport(report({ text: 'mi mail es x@y.com password=abc', chat: Array.from({ length: 1000 }, (_, i) => `l${i}`) }));
    if (!result.ok) throw new Error(result.error);
    expect(result.report.text).toBe('mi mail es [email] password=[redactado]');
    expect(result.report.chat).toHaveLength(250);
    expect(redact('Bearer abcdefghij123')).toBe('Bearer [redactado]');
  });
});

describe('options', () => {
  it('GitHub is on only with both a token and a repo; the repo must be owner/name', () => {
    expect(bugReportOptionsFromEnv({ AO_BUG_REPORT_DIR: '/tmp/x' })).toMatchObject({ dir: '/tmp/x', github: undefined, ipLimit: { limit: 5 }, sessionLimit: { limit: 3 } });
    expect(bugReportOptionsFromEnv({ AO_BUG_REPORT_GITHUB_TOKEN: 't' }).github).toBeUndefined();
    expect(bugReportOptionsFromEnv({ AO_BUG_REPORT_GITHUB_TOKEN: 't', AO_BUG_REPORT_GITHUB_REPO: 'o/r' }).github).toMatchObject({ repo: 'o/r', branch: 'bug-reports', label: 'bug-report' });
    expect(() => bugReportOptionsFromEnv({ AO_BUG_REPORT_GITHUB_REPO: 'nope' })).toThrow();
  });
});

/** A fake GitHub API: records calls, answers the git-data, contents and issues endpoints. */
function fakeGitHub(options: { branchExists?: boolean; failIssue?: boolean } = {}) {
  const calls: { method: string; path: string; body: Record<string, unknown> | undefined; auth: string | null }[] = [];
  const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ method: init.method, path, body, auth: init.headers.Authorization ?? null });
    const json = (status: number, value: unknown) => ({ status, text: async () => JSON.stringify(value) });
    if (path.endsWith('/git/ref/heads/bug-reports')) return options.branchExists ? json(200, { object: { sha: 'x' } }) : json(404, { message: 'Not Found' });
    if (path.endsWith('/git/trees')) return json(201, { sha: 'tree1' });
    if (path.endsWith('/git/commits')) return json(201, { sha: 'commit1' });
    if (path.endsWith('/git/refs')) return json(201, {});
    if (path.includes('/contents/')) return json(201, {});
    if (path.endsWith('/issues')) return options.failIssue ? json(403, { message: 'Resource not accessible by integration' }) : json(201, { number: 42, html_url: 'https://github.com/o/r/issues/42' });
    return json(404, { message: 'unexpected' });
  };
  return { calls, fetchImpl };
}

describe('pushToGitHub', () => {
  it('creates the orphan branch once, uploads the picture and the JSON, opens a labelled issue that links both', async () => {
    const gh = fakeGitHub();
    const checked = validateReport(report({ screenshot: pngUrl }));
    if (!checked.ok) throw new Error(checked.error);
    const config = { token: 'secret-token', repo: 'o/r', branch: 'bug-reports', label: 'bug-report', apiUrl: 'https://api.github.test' };
    const issue = await pushToGitHub(config, '20261122-090000-abcdef', checked.report, checked.image, gh.fetchImpl);
    expect(issue).toEqual({ number: 42, url: 'https://github.com/o/r/issues/42' });
    expect(gh.calls.map(c => `${c.method} ${c.path}`)).toEqual([
      'GET /repos/o/r/git/ref/heads/bug-reports', 'POST /repos/o/r/git/trees', 'POST /repos/o/r/git/commits', 'POST /repos/o/r/git/refs',
      'PUT /repos/o/r/contents/reports/2026-11/20261122-090000-abcdef.png', 'PUT /repos/o/r/contents/reports/2026-11/20261122-090000-abcdef.json', 'POST /repos/o/r/issues',
    ]);
    expect(gh.calls.every(c => c.auth === 'Bearer secret-token')).toBe(true);
    expect(gh.calls[2]!.body!.parents).toEqual([]);
    expect(gh.calls[4]!.body).toMatchObject({ branch: 'bug-reports', content: PNG.toString('base64') });
    const created = gh.calls.at(-1)!.body!;
    expect(created.labels).toEqual(['bug-report']);
    expect(created.title).toBe('[bug] Me trabé en la puerta · Aotest · mapa 751');
    expect(created.body).toContain('![captura](https://github.com/o/r/blob/bug-reports/reports/2026-11/20261122-090000-abcdef.png?raw=true)');
    expect(created.body).toContain('[JSON completo](https://github.com/o/r/blob/bug-reports/reports/2026-11/20261122-090000-abcdef.json)');
  });
  it('skips the branch setup when it exists, and a failure message never carries the token', async () => {
    const gh = fakeGitHub({ branchExists: true, failIssue: true });
    const checked = validateReport(report());
    if (!checked.ok) throw new Error(checked.error);
    const config = { token: 'secret-token', repo: 'o/r', branch: 'bug-reports', label: 'bug-report', apiUrl: 'https://api.github.test' };
    const error = await pushToGitHub(config, '20261122-090000-abcdef', checked.report, undefined, gh.fetchImpl).catch((e: Error) => e);
    expect(String(error)).toBe('Error: create issue: HTTP 403 Resource not accessible by integration');
    expect(gh.calls.map(c => c.method + ' ' + c.path.split('/').slice(-2).join('/'))).toEqual(['GET heads/bug-reports', 'PUT 2026-11/20261122-090000-abcdef.json', 'POST r/issues']);
  });
});

describe('issueContent', () => {
  it('neutralises @mentions and code fences from the player text', () => {
    const checked = validateReport(report({ text: 'hola @arielcamus ```rm -rf```', chat: ['@todos ```'] }));
    if (!checked.ok) throw new Error(checked.error);
    const { body, title } = issueContent(checked.report, 'id1');
    expect(body).not.toMatch(/@arielcamus/);
    expect(body).toContain('@​arielcamus');
    expect(body).not.toContain('```rm');
    expect(title.startsWith('[bug] hola @​arielcamus')).toBe(true);
  });
});

describe('POST /api/bug-report', () => {
  let server: Server, base = '', dir = '';
  const logs: string[] = [];
  const gh = fakeGitHub();
  let handler: ReturnType<typeof createBugReportHandler>;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ao-bug-reports-'));
    const options = { ...bugReportOptionsFromEnv({ AO_BUG_REPORT_DIR: dir, AO_BUG_REPORT_IP_LIMIT: '4', AO_BUG_REPORT_SESSION_LIMIT: '2' }), github: { token: 't', repo: 'o/r', branch: 'bug-reports', label: 'bug-report', apiUrl: 'https://api.github.test' } };
    handler = createBugReportHandler(options, { log: line => logs.push(line), fetchImpl: gh.fetchImpl as never });
    server = createServer((req, res) => { void handler(req, res, () => { res.writeHead(404); res.end('next'); }); });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise(done => server.close(done)); rmSync(dir, { recursive: true, force: true }); });
  const post = (body: string, headers: Record<string, string> = { 'Content-Type': 'application/json' }) => fetch(`${base}/api/bug-report`, { method: 'POST', headers, body });

  it('passes other paths on and refuses other methods and content types', async () => {
    expect(await (await fetch(`${base}/other`)).text()).toBe('next');
    expect((await fetch(`${base}/api/bug-report`)).status).toBe(405);
    expect((await post('{}', { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await post('{nope')).status).toBe(400);
    expect((await post(JSON.stringify(report({ text: '' })))).status).toBe(400);
  });
  it('refuses a body over the limit with 413, from the declared length or while reading', async () => {
    // Declared: answered before a byte of the body is read (the connection closes, so a client still writing may see EPIPE instead).
    const status = await new Promise<number>((done, failed) => {
      const req = request(`${base}/api/bug-report`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(4 * 1024 * 1024) } }, res => { res.resume(); done(res.statusCode ?? 0); });
      req.on('error', failed); req.flushHeaders();
    });
    expect(status).toBe(413);
    // Chunked (no length): counted while reading.
    const big = 'y'.repeat(3.2 * 1024 * 1024);
    const chunked = await new Promise<number>((done, failed) => {
      const req = request(`${base}/api/bug-report`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, res => { res.resume(); done(res.statusCode ?? 0); });
      req.on('error', failed); req.end(JSON.stringify(report({ chat: [big] })));
    });
    expect(chunked).toBe(413);
  });
  it('stores the JSON and the picture, answers 201 with the id, then opens the issue', async () => {
    const response = await post(JSON.stringify(report({ screenshot: pngUrl })));
    expect(response.status).toBe(201);
    const { id, github } = await response.json() as { id: string; github: string };
    expect(id).toMatch(/^\d{8}-\d{6}-[0-9a-f]{6}$/);
    expect(github).toBe('queued');
    const stored = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
    expect(stored).toMatchObject({ id, text: 'Me trabé en la puerta', screenshotFile: `${id}.png`, character: { name: 'Aotest' } });
    expect(stored).not.toHaveProperty('screenshot');
    expect(readFileSync(join(dir, `${id}.png`)).equals(PNG)).toBe(true);
    await handler.pending;
    expect(JSON.parse(readFileSync(join(dir, `${id}.github.json`), 'utf8'))).toMatchObject({ number: 42 });
    expect(logs.some(line => line.includes(`${id} -> issue #42`))).toBe(true);
  });
  it('limits each page session, then each IP', async () => {
    expect((await post(JSON.stringify(report()))).status).toBe(201); // session abcdef12-3456: second report
    const limited = await post(JSON.stringify(report()));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await post(JSON.stringify(report({ sessionId: 'other-session-1' })))).status).toBe(201); // IP: third and fourth
    expect((await post(JSON.stringify(report({ sessionId: 'other-session-2' })))).status).toBe(201);
    expect((await post(JSON.stringify(report({ sessionId: 'other-session-3' })))).status).toBe(429);
    await handler.pending;
  });
  it('pushPending retries only the reports without an issue', async () => {
    const files = readdirSync(dir).filter(name => name.endsWith('.github.json'));
    rmSync(join(dir, files[0]!)); // as if that push had failed before writing its outcome
    const again = fakeGitHub({ branchExists: true });
    const pushed = await pushPending({ dir, github: { token: 't', repo: 'o/r', branch: 'bug-reports', label: 'bug-report', apiUrl: 'https://api.github.test' } } as never, { log: () => undefined, fetchImpl: again.fetchImpl as never });
    expect(pushed).toBe(1);
    expect(again.calls.filter(c => c.path.endsWith('/issues'))).toHaveLength(1);
  });
});
