// AGPL-3.0-or-later. See ../../../LICENSE.
/*
 * The in-game bug reporter's data side (docs/BUG-REPORTS.md): fixed-size ring buffers for what happened just before the report, the
 * redaction every string goes through, and the payload the browser POSTs to /api/bug-report. Pure: no DOM, no network, unit tested.
 *
 * Privacy by construction: the protocol trace keeps packet ids only (never a payload, so a login packet is a name and a time); the
 * account e-mail and password are never read into the report, and the strings that do go in (the player's text, chat and console
 * lines, error messages) are redacted against the known secrets and credential-like patterns before they leave the page.
 */

/** A ring that keeps the last `size` items. */
export class Ring<T> {
  private readonly items: T[] = [];
  private start = 0;
  constructor(readonly size: number) {}
  push(item: T) {
    if (this.items.length < this.size) this.items.push(item);
    else { this.items[this.start] = item; this.start = (this.start + 1) % this.size; }
  }
  /** Oldest first. */
  values(): T[] { return [...this.items.slice(this.start), ...this.items.slice(0, this.start)]; }
  get length() { return this.items.length; }
  clear() { this.items.length = 0; this.start = 0; }
}

export const REDACTED = '[redactado]';
// Bounded (local part <= 64, domain <= 255): the unbounded form was quadratic on a long run with no `@` (same as tools/bug-reports.mjs).
const EMAIL = /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,255}\.[A-Z]{2,}/gi;
/** key=value / key: value where the key names a credential (English and Spanish). */
const CREDENTIAL_PAIR = /\b(pass(?:word|wd)?|contrase(?:ñ|n)a|clave|pin|token|secret|api[_-]?key|auth(?:orization)?|session(?:id)?|cookie)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi;
const BEARER = /\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
/** GitHub, Slack, AWS, OpenAI/Anthropic-style keys and JWTs. */
const KNOWN_TOKENS = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g;
/** Chat commands whose arguments are a password: /PARTICIPAR (or /PARTICIPATE) <sala> <clave> (extras-commands.ts), anywhere in a line. */
const PASSWORD_COMMANDS = /(\/PARTICIP(?:AR|ATE)\s+\S+\s+)(\S+)/gi;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Remove secrets from one string: every exact occurrence of a known secret (the account e-mail and password of this page), then any
 * e-mail address, credential pair, bearer/known-format token and the password argument of /PARTICIPAR.
 */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 3) continue; // a one- or two-character "secret" would shred ordinary text
    out = out.replace(new RegExp(escapeRegExp(secret), 'gi'), REDACTED);
  }
  return out
    .replace(KNOWN_TOKENS, REDACTED)
    .replace(BEARER, (_, kind: string) => `${kind} ${REDACTED}`)
    .replace(CREDENTIAL_PAIR, (_, key: string, sep: string) => `${key}${sep}${REDACTED}`)
    .replace(EMAIL, '[email]')
    .replace(PASSWORD_COMMANDS, (_, head: string) => `${head}${REDACTED}`);
}

export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export type TraceDirection = 'in' | 'out';
export interface TraceEvent { t: number; dir: TraceDirection; id: number }
export interface ConsoleEntry { t: number; level: string; text: string }
export interface ErrorEntry { t: number; kind: 'error' | 'rejection' | 'report'; message: string; stack?: string }

/** Sizes of the rings and of the strings in them; the server enforces the same ceilings (tools/bug-reports.mjs). */
export const LIMITS = { chat: 200, console: 200, protocol: 300, errors: 50, text: 4000, expected: 2000, line: 1000, stack: 2000 } as const;

export interface CharacterInfo {
  name: string; level?: number | undefined; className?: string | undefined; map?: number | undefined; resourceMap?: number | undefined; mapName?: string | undefined;
  x?: number | undefined; y?: number | undefined; hp?: number | undefined; maxHp?: number | undefined; mana?: number | undefined; maxMana?: number | undefined;
  dead?: boolean | undefined; privileges?: number | undefined;
}
export interface ScreenshotInfo { dataUrl: string; width: number; height: number; type: 'image/png' | 'image/jpeg'; bytes: number }

export interface ReportInput {
  sessionId: string;
  text: string;
  expected: string;
  screenshot: ScreenshotInfo | undefined;
  character: CharacterInfo | undefined;
  /** The page's phase: login, account, playing... */
  phase: string;
  client: Record<string, string | number | boolean | undefined>;
  environment: Record<string, unknown>;
  stats: Record<string, unknown>;
  openWindows: readonly string[];
  chat: readonly string[];
  console: readonly ConsoleEntry[];
  protocol: readonly TraceEvent[];
  errors: readonly ErrorEntry[];
  /** Exact strings that must never leave the page (the account e-mail and password). */
  secrets: readonly string[];
  /** performance.timeOrigin: the trace times are performance.now() values. */
  timeOrigin: number;
  now: number;
  packetName: (dir: TraceDirection, id: number) => string;
}

export interface BugReportPayload {
  schema: 1;
  sessionId: string;
  createdAt: string;
  text: string;
  expected: string;
  phase: string;
  screenshot?: string;
  screenshotInfo?: { width: number; height: number; type: string; bytes: number };
  character: CharacterInfo | null;
  client: Record<string, string | number | boolean | undefined>;
  environment: Record<string, unknown>;
  stats: Record<string, unknown>;
  openWindows: string[];
  chat: string[];
  console: { at: string; level: string; text: string }[];
  protocol: { at: string; dir: TraceDirection; id: number; name: string }[];
  errors: { at: string; kind: string; message: string; stack?: string }[];
}

const iso = (origin: number, t: number) => new Date(origin + t).toISOString();

/** Redact a nested value's strings (environment and stats come from the page; nothing in them should be secret, this is the belt). */
function redactDeep(value: unknown, secrets: readonly string[], depth = 0): unknown {
  if (typeof value === 'string') return clip(redact(value, secrets), LIMITS.line);
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redactDeep(item, secrets, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, secrets, depth + 1)]));
}

/** The JSON body of POST /api/bug-report. Every free string is redacted and clipped; the rings are cut to their limits. */
export function buildBugReport(input: ReportInput): BugReportPayload {
  const secrets = input.secrets.filter(secret => secret.length >= 3);
  const r = (text: string, max: number) => clip(redact(text, secrets), max);
  const payload: BugReportPayload = {
    schema: 1,
    sessionId: input.sessionId,
    createdAt: new Date(input.timeOrigin + input.now).toISOString(),
    text: r(input.text.trim(), LIMITS.text),
    expected: r(input.expected.trim(), LIMITS.expected),
    phase: input.phase,
    character: input.character ? { ...input.character, name: r(input.character.name, 64), ...(input.character.mapName !== undefined ? { mapName: r(input.character.mapName, 100) } : {}) } : null,
    client: redactDeep(input.client, secrets) as BugReportPayload['client'],
    environment: redactDeep(input.environment, secrets) as Record<string, unknown>,
    stats: redactDeep(input.stats, secrets) as Record<string, unknown>,
    openWindows: input.openWindows.slice(0, 50).map(id => clip(id, 64)),
    chat: input.chat.slice(-LIMITS.chat).map(line => r(line, LIMITS.line)),
    console: input.console.slice(-LIMITS.console).map(entry => ({ at: iso(input.timeOrigin, entry.t), level: entry.level, text: r(entry.text, LIMITS.line) })),
    protocol: input.protocol.slice(-LIMITS.protocol).map(event => ({ at: iso(input.timeOrigin, event.t), dir: event.dir, id: event.id, name: input.packetName(event.dir, event.id) })),
    errors: input.errors.slice(-LIMITS.errors).map(entry => ({
      at: iso(input.timeOrigin, entry.t), kind: entry.kind, message: r(entry.message, LIMITS.line), ...(entry.stack ? { stack: r(entry.stack, LIMITS.stack) } : {}),
    })),
  };
  if (input.screenshot) {
    payload.screenshot = input.screenshot.dataUrl;
    payload.screenshotInfo = { width: input.screenshot.width, height: input.screenshot.height, type: input.screenshot.type, bytes: input.screenshot.bytes };
  }
  return payload;
}

/**
 * Packet names for the trace, from the protocol's id tables (every `*ServerPacketId` / `*ClientPacketId` export: the TS enums and the
 * `as const` objects). Ids are unique per direction (one codec per id, the load guard checks it).
 */
export function packetNameTable(protocol: Record<string, unknown>): (dir: TraceDirection, id: number) => string {
  const names = { in: new Map<number, string>(), out: new Map<number, string>() };
  for (const [exportName, table] of Object.entries(protocol)) {
    const dir: TraceDirection | undefined = exportName.endsWith('ServerPacketId') ? 'in' : exportName.endsWith('ClientPacketId') ? 'out' : undefined;
    if (!dir || !table || typeof table !== 'object') continue;
    for (const [name, id] of Object.entries(table)) if (typeof id === 'number' && !names[dir].has(id)) names[dir].set(id, name);
  }
  return (dir, id) => names[dir].get(id) ?? `#${id}`;
}

/** A printable line for one console.* argument list. */
export function consoleText(args: readonly unknown[]): string {
  return args.map(arg => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    try { return JSON.stringify(arg) ?? String(arg); } catch { return String(arg); }
  }).join(' ');
}

/** The issue/summary title the server uses too: first line of the text, the character and the map. */
export function reportTitle(text: string, character: CharacterInfo | null | undefined): string {
  const first = clip((text.split(/\r?\n/).find(line => line.trim() !== '') ?? 'Sin descripción').trim(), 80);
  const where = character ? ` · ${character.name}${character.map !== undefined ? ` · mapa ${character.map}` : ''}` : '';
  return `${first}${where}`;
}
