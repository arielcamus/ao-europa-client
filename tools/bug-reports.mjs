// AGPL-3.0-or-later. The server side of the in-game bug reporter (docs/BUG-REPORTS.md): POST /api/bug-report on the dev-web server.
//
// Every report is validated, redacted again (the browser already redacted; this is the second belt), rate limited per IP and per page
// session, and stored as <id>.json (+ <id>.png / .jpg) under AO_BUG_REPORT_DIR, outside the repository. When a GitHub token and repo
// are configured the report also becomes an issue: the screenshot and the full JSON are committed to a branch of that repo
// (`bug-reports` by default, created as an orphan branch on first use) and the issue links them. The token stays in this process.
// GitHub is best effort: a failure is logged, written next to the report as <id>.github.json {error} and retried on the next start
// (or `node tools/bug-reports.mjs push-pending`); the local copy is always the record.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ROUTE = '/api/bug-report';
export const DEFAULT_DIR = join(homedir(), '.ao-client', 'bug-reports');
/** The decoded screenshot (the browser keeps it under 900 KB; JPEG fallback). */
export const MAX_IMAGE_BYTES = 1536 * 1024;
/** The whole JSON body: the base64 screenshot plus the logs. */
export const MAX_BODY_BYTES = 3 * 1024 * 1024;
/** Ceilings per list and per string; a little above the browser's own (bug-report-data.ts LIMITS) so a normal report is never cut. */
export const LIMITS = { chat: 250, console: 250, protocol: 400, errors: 100, windows: 50, text: 4000, expected: 2000, line: 2000, stack: 4000 };
const ID = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

/** Configuration from the environment. GitHub is on only when both the token and the repo are set. */
export function bugReportOptionsFromEnv(env = process.env) {
  const number = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);
  const token = env.AO_BUG_REPORT_GITHUB_TOKEN ?? '', repo = env.AO_BUG_REPORT_GITHUB_REPO ?? '';
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('AO_BUG_REPORT_GITHUB_REPO must be owner/name');
  return {
    dir: resolve(env.AO_BUG_REPORT_DIR || DEFAULT_DIR),
    ipLimit: { limit: number(env.AO_BUG_REPORT_IP_LIMIT, 5), windowMs: 60 * 60 * 1000 },
    sessionLimit: { limit: number(env.AO_BUG_REPORT_SESSION_LIMIT, 3), windowMs: 10 * 60 * 1000 },
    trustProxy: env.AO_BUG_REPORT_TRUST_PROXY === '1',
    github: token && repo ? { token, repo, branch: env.AO_BUG_REPORT_GITHUB_BRANCH || 'bug-reports', label: env.AO_BUG_REPORT_GITHUB_LABEL || 'bug-report', apiUrl: env.AO_BUG_REPORT_GITHUB_API || 'https://api.github.com' } : undefined,
  };
}

/** A sliding-window counter per key. */
export class RateLimiter {
  constructor({ limit, windowMs, now = () => Date.now() }) { this.limit = limit; this.windowMs = windowMs; this.now = now; this.hits = new Map(); }
  recent(key) {
    const since = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter(t => t > since);
    if (list.length) this.hits.set(key, list); else this.hits.delete(key);
    return list;
  }
  /** { ok: true } or { ok: false, retryAfterMs } without counting. */
  check(key) {
    const list = this.recent(key);
    return list.length < this.limit ? { ok: true } : { ok: false, retryAfterMs: Math.max(1, list[0] + this.windowMs - this.now()) };
  }
  record(key) { const list = this.recent(key); const at = this.now(); list.push(at); this.hits.set(key, list); return at; }
  /** Take back one hit (a reserved slot whose request failed). */
  release(key, at) { const list = this.hits.get(key); const i = list ? list.indexOf(at) : -1; if (i >= 0) list.splice(i, 1); }
}

// Same patterns as the browser (apps/web/src/bug-report-data.ts redact), minus the per-page secrets the server never knows.
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CREDENTIAL_PAIR = /\b(pass(?:word|wd)?|contrase(?:ñ|n)a|clave|pin|token|secret|api[_-]?key|auth(?:orization)?|session(?:id)?|cookie)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi;
const BEARER = /\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KNOWN_TOKENS = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g;
const PASSWORD_COMMANDS = /(\/PARTICIP(?:AR|ATE)\s+\S+\s+)(\S+)/gi;
export function redact(text) {
  return text.replace(KNOWN_TOKENS, '[redactado]').replace(BEARER, (_, kind) => `${kind} [redactado]`)
    .replace(CREDENTIAL_PAIR, (_, key, sep) => `${key}${sep}[redactado]`).replace(EMAIL, '[email]').replace(PASSWORD_COMMANDS, (_, head) => `${head}[redactado]`);
}
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const cleanString = (value, max) => (typeof value === 'string' ? clip(redact(value), max) : undefined);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** Free-form objects from the page (client, environment, stats): strings redacted and clipped, bounded depth, keys and list lengths. */
function sanitizeDeep(value, depth = 0) {
  if (typeof value === 'string') return clip(redact(value), LIMITS.line);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean' || value === null) return value;
  if (depth >= 4 || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeDeep(item, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 64).map(([key, item]) => [clip(key, 64), sanitizeDeep(item, depth + 1)]));
}
const list = (value, max, map) => (Array.isArray(value) ? value.slice(-max).map(map).filter(item => item !== undefined) : []);

const CHARACTER_NUMBERS = ['level', 'map', 'resourceMap', 'x', 'y', 'hp', 'maxHp', 'mana', 'maxMana', 'privileges'];
const IMAGE = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * Check a parsed body. Returns { ok: true, report, image } (image: { buffer, ext, type } or undefined) or { ok: false, status, error }.
 * Unknown fields are dropped; every string is redacted and clipped.
 */
export function validateReport(body) {
  const fail = (error, status = 400) => ({ ok: false, status, error });
  if (!isObject(body)) return fail('body must be a JSON object');
  if (body.schema !== 1) return fail('unsupported schema');
  if (typeof body.sessionId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(body.sessionId)) return fail('invalid sessionId');
  if (typeof body.text !== 'string' || body.text.trim() === '') return fail('text is required');
  if (body.text.length > LIMITS.text * 2) return fail('text too long', 413);
  if (body.expected !== undefined && typeof body.expected !== 'string') return fail('invalid expected');
  let image;
  if (body.screenshot !== undefined) {
    const match = typeof body.screenshot === 'string' ? IMAGE.exec(body.screenshot) : null;
    if (!match) return fail('screenshot must be a PNG or JPEG data URL', 415);
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > MAX_IMAGE_BYTES) return fail('screenshot too large', 413);
    const png = buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if ((match[1] === 'png' && !png) || (match[1] === 'jpeg' && !jpeg)) return fail('screenshot is not the image it claims to be', 415);
    image = { buffer, ext: match[1] === 'png' ? 'png' : 'jpg', type: `image/${match[1]}` };
  }
  let character = null;
  if (isObject(body.character)) {
    character = { name: cleanString(body.character.name, 64) ?? '' };
    for (const key of CHARACTER_NUMBERS) { const value = finite(body.character[key]); if (value !== undefined) character[key] = value; }
    for (const key of ['className', 'mapName']) { const value = cleanString(body.character[key], 100); if (value !== undefined) character[key] = value; }
    if (typeof body.character.dead === 'boolean') character.dead = body.character.dead;
  }
  const at = value => cleanString(value, 40) ?? '';
  const report = {
    schema: 1,
    sessionId: body.sessionId,
    createdAt: at(body.createdAt),
    text: clip(redact(body.text.trim()), LIMITS.text),
    expected: clip(redact((body.expected ?? '').trim()), LIMITS.expected),
    phase: cleanString(body.phase, 32) ?? '',
    character,
    client: isObject(body.client) ? sanitizeDeep(body.client) : {},
    environment: isObject(body.environment) ? sanitizeDeep(body.environment) : {},
    stats: isObject(body.stats) ? sanitizeDeep(body.stats) : {},
    openWindows: list(body.openWindows, LIMITS.windows, item => cleanString(item, 64)),
    chat: list(body.chat, LIMITS.chat, item => cleanString(item, LIMITS.line)),
    console: list(body.console, LIMITS.console, item => (isObject(item) ? { at: at(item.at), level: cleanString(item.level, 10) ?? 'log', text: cleanString(item.text, LIMITS.line) ?? '' } : undefined)),
    protocol: list(body.protocol, LIMITS.protocol, item => (isObject(item) && (item.dir === 'in' || item.dir === 'out') && Number.isInteger(item.id)
      ? { at: at(item.at), dir: item.dir, id: item.id, name: cleanString(item.name, 64) ?? `#${item.id}` } : undefined)),
    errors: list(body.errors, LIMITS.errors, item => (isObject(item) ? {
      at: at(item.at), kind: cleanString(item.kind, 16) ?? 'error', message: cleanString(item.message, LIMITS.line) ?? '',
      ...(typeof item.stack === 'string' ? { stack: cleanString(item.stack, LIMITS.stack) } : {}),
    } : undefined)),
  };
  if (image && isObject(body.screenshotInfo)) report.screenshotInfo = { width: finite(body.screenshotInfo.width), height: finite(body.screenshotInfo.height), type: image.type, bytes: image.buffer.length };
  return { ok: true, report, image };
}

/** First line of the text, the character and the map (the same as the browser's reportTitle). */
export function reportTitle(report) {
  const first = clip((report.text.split(/\r?\n/).find(line => line.trim() !== '') ?? 'Sin descripción').trim(), 80);
  const c = report.character;
  return `${first}${c && c.name ? ` · ${c.name}${c.map !== undefined ? ` · mapa ${c.map}` : ''}` : ''}`;
}

export function newReportId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

/** Write <id>.json (and the picture) under `dir`, readable only by this user. */
export async function storeReport(dir, report, image, { now = new Date(), userAgent } = {}) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const id = newReportId(now);
  const stored = { id, receivedAt: now.toISOString(), ...(userAgent ? { userAgentHeader: clip(String(userAgent), 300) } : {}), ...report };
  if (image) { stored.screenshotFile = `${id}.${image.ext}`; await writeFile(join(dir, stored.screenshotFile), image.buffer, { mode: 0o600 }); }
  const jsonPath = join(dir, `${id}.json`);
  await writeFile(jsonPath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  return { id, jsonPath, imagePath: image ? join(dir, stored.screenshotFile) : undefined, stored };
}

// ---- GitHub ---------------------------------------------------------------------------------------------------------------------
/** No @mention or code fence from a player's text reaches the issue as markup. */
const neutral = text => text.replace(/@(?=\w)/g, '@​').replace(/#(?=\d)/g, '#​').replace(/```/g, 'ʼʼʼ');
/** Player-controlled text outside a code fence: no HTML, links, images or other Markdown, and no line breaks inside a table cell. */
const inline = text => neutral(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_[\]()!#|~]/g, '\\$&');
const fence = lines => `\`\`\`\n${neutral(lines.join('\n'))}\n\`\`\``;
const quote = text => text.split(/\r?\n/).map(line => `> ${inline(line)}`).join('\n');
const MAX_ISSUE_BODY = 60000;

/** Title and Markdown body of the issue. `links`: { image, json } URLs (either may be missing). */
export function issueContent(report, id, links = {}) {
  const c = report.character, cl = report.client ?? {}, env = report.environment ?? {}, st = report.stats ?? {};
  const row = (name, value) => (value === undefined || value === '' ? '' : `| ${name} | ${inline(String(value).replace(/[\r\n]+/g, ' '))} |\n`);
  const fmt = (a, b) => (a === undefined ? undefined : `${a}${b !== undefined ? ` / ${b}` : ''}`);
  const viewport = isObject(env.viewport) ? `${env.viewport.width}x${env.viewport.height} @${env.devicePixelRatio ?? 1}x${env.screenScale ? `, escala ${env.screenScale}` : ''}` : undefined;
  const who = c ? [c.className, c.level !== undefined ? `nivel ${c.level}` : undefined].filter(Boolean).join(', ') : '';
  let body = `**Qué pasó**\n${quote(report.text)}\n\n`;
  if (report.expected) body += `**Qué esperaba**\n${quote(report.expected)}\n\n`;
  if (links.image) body += `![captura](${links.image})\n\n`;
  body += '| | |\n|---|---|\n'
    + row('Personaje', c ? `${c.name}${who ? ` (${who})` : ''}` : 'sin personaje (fuera del juego)')
    + row('Mapa', c && c.map !== undefined ? `${c.map}${c.mapName ? ` (${c.mapName})` : ''} @ ${c.x ?? '?'},${c.y ?? '?'}` : undefined)
    + row('HP / MP', c ? `${fmt(c.hp, c.maxHp) ?? '?'} · ${fmt(c.mana, c.maxMana) ?? '?'}${c.dead ? ' · muerto' : ''}` : undefined)
    + row('Fase', report.phase)
    + row('Cliente', [cl.commit, cl.branch, cl.mode, cl.wireProfile && `wire ${cl.wireProfile}`, cl.assetVersion && `assets ${cl.assetVersion}`].filter(Boolean).join(' · '))
    + row('Navegador', env.userAgent)
    + row('Pantalla', viewport)
    + row('FPS', st.fps)
    + row('Pasos', st.walksSent !== undefined ? `${st.walksSent} enviados, ${st.confirmedWalks} confirmados, ${st.correctedWalks} corregidos` : undefined)
    + row('Ventanas abiertas', (report.openWindows ?? []).join(', '));
  body += `\nReporte \`${id}\` · sesión \`${report.sessionId}\`${links.json ? ` · [JSON completo](${links.json})` : ''}\n`;
  const section = (title, lines) => (lines.length ? `\n<details><summary>${title}</summary>\n\n${fence(lines)}\n\n</details>\n` : '');
  body += section(`Errores (${report.errors.length})`, report.errors.map(e => `${e.at} ${e.kind}: ${e.message}${e.stack ? `\n${e.stack}` : ''}`));
  body += section('Consola del juego (últimas 40)', report.chat.slice(-40));
  body += section('Consola del navegador (últimas 40)', report.console.slice(-40).map(e => `${e.at} [${e.level}] ${e.text}`));
  body += section('Protocolo (últimos 80)', report.protocol.slice(-80).map(e => `${e.at.slice(11, 23)} ${e.dir === 'in' ? '<-' : '->'} ${e.name} (${e.id})`));
  if (body.length > MAX_ISSUE_BODY) body = `${body.slice(0, MAX_ISSUE_BODY)}\n\n…(recortado; ver el JSON completo)`;
  return { title: clip(`[bug] ${neutral(reportTitle(report))}`, 200), body };
}

async function gh(config, fetchImpl, method, path, body) {
  const response = await fetchImpl(`${config.apiUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ao-client-bug-reports', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: response.status, json };
}
/** An error whose message never carries the token (only the call and GitHub's own message). */
const ghError = (what, result) => new Error(`${what}: HTTP ${result.status}${result.json?.message ? ` ${result.json.message}` : ''}`);

/** The assets branch, created once as an orphan commit with a README so it shares no history with the code. */
async function ensureBranch(config, fetchImpl) {
  const ref = await gh(config, fetchImpl, 'GET', `/repos/${config.repo}/git/ref/heads/${encodeURIComponent(config.branch)}`);
  if (ref.status === 200) return;
  if (ref.status !== 404) throw ghError('read branch', ref);
  const tree = await gh(config, fetchImpl, 'POST', `/repos/${config.repo}/git/trees`, { tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: '# Bug reports\n\nScreenshots and full JSON of the in-game bug reports (docs/BUG-REPORTS.md). Written by the game server; do not merge.\n' }] });
  if (tree.status !== 201) throw ghError('create tree', tree);
  const commit = await gh(config, fetchImpl, 'POST', `/repos/${config.repo}/git/commits`, { message: 'bug-reports: start the branch', tree: tree.json.sha, parents: [] });
  if (commit.status !== 201) throw ghError('create commit', commit);
  const created = await gh(config, fetchImpl, 'POST', `/repos/${config.repo}/git/refs`, { ref: `refs/heads/${config.branch}`, sha: commit.json.sha });
  if (created.status !== 201 && created.status !== 422) throw ghError('create branch', created); // 422: another report created it first
}
async function putFile(config, fetchImpl, path, buffer, message) {
  const result = await gh(config, fetchImpl, 'PUT', `/repos/${config.repo}/contents/${path}`, { message, content: buffer.toString('base64'), branch: config.branch });
  if (result.status !== 201 && result.status !== 200) throw ghError(`upload ${path}`, result);
}

/**
 * Commit the picture and the JSON to the assets branch, then open the issue. Returns { number, url }.
 * The image link is github.com/<repo>/blob/<branch>/<path>?raw=true: in a private repo GitHub renders it for viewers who can read the repo.
 */
export async function pushToGitHub(config, id, stored, image, fetchImpl = fetch) {
  await ensureBranch(config, fetchImpl);
  const folder = `reports/${id.slice(0, 4)}-${id.slice(4, 6)}`;
  const blob = path => `https://github.com/${config.repo}/blob/${encodeURIComponent(config.branch)}/${path}`;
  const links = {};
  if (image) { const path = `${folder}/${id}.${image.ext}`; await putFile(config, fetchImpl, path, image.buffer, `bug report ${id}: screenshot`); links.image = `${blob(path)}?raw=true`; }
  const jsonPath = `${folder}/${id}.json`;
  await putFile(config, fetchImpl, jsonPath, Buffer.from(`${JSON.stringify(stored, null, 2)}\n`), `bug report ${id}: report`);
  links.json = blob(jsonPath);
  const { title, body } = issueContent(stored, id, links);
  const issue = await gh(config, fetchImpl, 'POST', `/repos/${config.repo}/issues`, { title, body, labels: [config.label] });
  if (issue.status !== 201) throw ghError('create issue', issue);
  return { number: issue.json.number, url: issue.json.html_url };
}

const sidecar = (dir, id) => join(dir, `${id}.github.json`);
const inFlight = new Set();
/** Push one stored report and record the outcome next to it. Never throws. */
async function pushStored(options, id, stored, image, log, fetchImpl) {
  if (inFlight.has(id)) return undefined;
  inFlight.add(id);
  try {
    const issue = await pushToGitHub(options.github, id, stored, image, fetchImpl);
    await writeFile(sidecar(options.dir, id), `${JSON.stringify({ ...issue, at: new Date().toISOString() })}\n`, { mode: 0o600 });
    log(`[bug-report] ${id} -> issue #${issue.number} ${issue.url}`);
    return issue;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(sidecar(options.dir, id), `${JSON.stringify({ error: message, at: new Date().toISOString() })}\n`, { mode: 0o600 }).catch(() => undefined);
    log(`[bug-report] GITHUB FAILED for ${id} (kept locally at ${join(options.dir, `${id}.json`)}; retried on the next start or with node tools/bug-reports.mjs push-pending): ${message}`);
    return undefined;
  } finally { inFlight.delete(id); }
}

/** Every stored report without an issue yet, oldest first. Returns how many were pushed. */
export async function pushPending(options, { log = console.log, fetchImpl = fetch } = {}) {
  if (!options.github) return 0;
  let names;
  try { names = await readdir(options.dir); } catch { return 0; }
  const done = new Set();
  for (const name of names) {
    if (!name.endsWith('.github.json')) continue;
    try { if (JSON.parse(await readFile(join(options.dir, name), 'utf8')).number) done.add(name.slice(0, -'.github.json'.length)); } catch { /* retry it */ }
  }
  let pushed = 0;
  for (const name of names.sort()) {
    const id = name.slice(0, -'.json'.length);
    if (!name.endsWith('.json') || name.endsWith('.github.json') || !ID.test(id) || done.has(id)) continue;
    let stored, image;
    try { // a truncated or hand-edited file must not stop the others (nor, at startup, the server)
      stored = JSON.parse(await readFile(join(options.dir, name), 'utf8'));
      const ext = stored.screenshotFile?.endsWith('.jpg') ? 'jpg' : 'png';
      image = stored.screenshotFile ? { buffer: await readFile(join(options.dir, `${id}.${ext}`)), ext, type: ext === 'png' ? 'image/png' : 'image/jpeg' } : undefined;
    } catch (error) { log(`[bug-report] GITHUB SKIPPED ${name}: unreadable (${error instanceof Error ? error.message : String(error)})`); continue; }
    if (await pushStored(options, id, stored, image, log, fetchImpl)) pushed++;
  }
  return pushed;
}

const STORE_FAILED = Symbol('store failed');
function clientIp(request, trustProxy) {
  // The LAST hop is the address our own proxy saw; earlier entries are whatever the client sent and can be forged.
  const forwarded = trustProxy ? (String(request.headers['x-forwarded-for'] ?? '').split(',').pop() ?? '').trim() : '';
  return forwarded || request.socket?.remoteAddress || 'unknown';
}
function reply(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
}
/** The body as a Buffer, or undefined once it passes `limit` (the caller answers 413). */
function readBody(request, limit) {
  return new Promise((done, failed) => {
    const chunks = []; let size = 0, over = false;
    request.on('data', chunk => { if (over) return; size += chunk.length; if (size > limit) { over = true; chunks.length = 0; } else chunks.push(chunk); });
    request.on('end', () => done(over ? undefined : Buffer.concat(chunks)));
    request.on('error', failed);
  });
}

/**
 * Connect-style middleware for POST /api/bug-report (dev-web.mjs mounts it in dev and preview). Options as bugReportOptionsFromEnv
 * returns them, plus `log`, `fetchImpl` and `now` for tests.
 */
export function createBugReportHandler(options, { log = console.log, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const ipLimiter = new RateLimiter({ ...options.ipLimit, now });
  const sessionLimiter = new RateLimiter({ ...options.sessionLimit, now });
  const tooMany = (response, retryAfterMs) => {
    const seconds = Math.ceil(retryAfterMs / 1000);
    reply(response, 429, { error: 'too many reports', retryAfterSeconds: seconds }, { 'Retry-After': String(seconds) });
  };
  const handle = async (request, response, next) => {
    if ((request.url ?? '').split('?')[0] !== ROUTE) { next?.(); return; }
    if (request.method !== 'POST') { reply(response, 405, { error: 'POST only' }, { Allow: 'POST' }); return; }
    if (!/^application\/json\b/i.test(String(request.headers['content-type'] ?? ''))) { reply(response, 415, { error: 'application/json only' }); return; }
    const ip = clientIp(request, options.trustProxy);
    const byIp = ipLimiter.check(ip);
    if (!byIp.ok) { request.resume(); tooMany(response, byIp.retryAfterMs); return; }
    // Take the slot now, before the body is read, so parallel requests cannot all pass the check. Every attempt counts (a malformed
    // 3 MB body costs this server as much as a good one) except one this server failed to store.
    const slot = ipLimiter.record(ip);
    let outcome;
    try { outcome = await accept(request, response); } finally { if (outcome === STORE_FAILED) ipLimiter.release(ip, slot); }
  };
  const accept = async (request, response) => {
    if (Number(request.headers['content-length'] ?? 0) > MAX_BODY_BYTES) { reply(response, 413, { error: 'report too large' }, { Connection: 'close' }); request.resume(); return; }
    let raw;
    try { raw = await readBody(request, MAX_BODY_BYTES); } catch { reply(response, 400, { error: 'unreadable body' }); return; }
    if (!raw) { reply(response, 413, { error: 'report too large' }, { Connection: 'close' }); return; }
    let parsed;
    try { parsed = JSON.parse(raw.toString('utf8')); } catch { reply(response, 400, { error: 'invalid JSON' }); return; }
    const checked = validateReport(parsed);
    if (!checked.ok) { reply(response, checked.status, { error: checked.error }); return; }
    const bySession = sessionLimiter.check(checked.report.sessionId);
    if (!bySession.ok) { tooMany(response, bySession.retryAfterMs); return; }
    let saved;
    try { saved = await storeReport(options.dir, checked.report, checked.image, { now: new Date(now()), userAgent: request.headers['user-agent'] }); } catch (error) {
      log(`[bug-report] STORE FAILED in ${options.dir}: ${error instanceof Error ? error.message : String(error)}`);
      reply(response, 500, { error: 'could not store the report' }); return STORE_FAILED;
    }
    sessionLimiter.record(checked.report.sessionId);
    log(`[bug-report] ${saved.id} stored at ${saved.jsonPath}: ${reportTitle(checked.report)}`);
    reply(response, 201, { id: saved.id, github: options.github ? 'queued' : 'off' });
    if (options.github) handler.pending = pushStored(options, saved.id, saved.stored, checked.image, log, fetchImpl);
  };
  // Nothing thrown in here may become an unhandled rejection (Node exits on those): answer 500 and log.
  const handler = (request, response, next) => handle(request, response, next).catch(error => {
    log(`[bug-report] handler error: ${error instanceof Error ? error.message : String(error)}`);
    if (!response.headersSent) reply(response, 500, { error: 'internal error' }); else response.end();
  });
  /** The last GitHub push started (tests await it). */
  handler.pending = undefined;
  return handler;
}

// `node tools/bug-reports.mjs push-pending`: retry every stored report that has no issue yet (needs the same env as the server).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = bugReportOptionsFromEnv();
  if (process.argv[2] !== 'push-pending') { console.log('usage: node tools/bug-reports.mjs push-pending'); process.exit(2); }
  if (!options.github) { console.error('Set AO_BUG_REPORT_GITHUB_TOKEN and AO_BUG_REPORT_GITHUB_REPO first.'); process.exit(1); }
  console.log(`${await pushPending(options)} report(s) pushed from ${options.dir}`);
}
