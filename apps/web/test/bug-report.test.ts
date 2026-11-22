import { describe, expect, it } from 'vitest';
import * as protocol from '@ao/protocol';
import { ClientPacketId, ServerPacketId, NpcsServerPacketId, SessionClientPacketId } from '@ao/protocol';
import { LIMITS, REDACTED, Ring, buildBugReport, clip, consoleText, packetNameTable, redact, reportTitle } from '../src/bug-report-data.js';
import type { ReportInput } from '../src/bug-report-data.js';

describe('redact', () => {
  it('removes the known secrets wherever they appear, case-insensitively', () => {
    expect(redact('mi clave es Hunter22 y HUNTER22', ['hunter22'])).toBe(`mi clave es ${REDACTED} y ${REDACTED}`);
    expect(redact('pass a.b+c(1)?', ['a.b+c(1)?'])).toBe(`pass ${REDACTED}`); // regex characters are literal
  });
  it('ignores secrets shorter than 3 characters (they would shred ordinary text)', () => {
    expect(redact('a bad day', ['a'])).toBe('a bad day');
  });
  it('removes e-mail addresses, credential pairs, bearer and known-format tokens', () => {
    expect(redact('soy aotest@local.test')).toBe('soy [email]');
    expect(redact('password=hunter2 token: abc clave="x y"')).toBe(`password=${REDACTED} token: ${REDACTED} clave=${REDACTED}`);
    expect(redact('contraseña: secreta')).toBe(`contraseña: ${REDACTED}`);
    expect(redact('Authorization: Bearer abcdefghijklmnop')).toContain(REDACTED);
    expect(redact('Authorization: Bearer abcdefghijklmnop')).not.toContain('abcdefghijklmnop');
    expect(redact('key ghp_0123456789abcdefghijABCDEFGHIJ')).toBe(`key ${REDACTED}`);
    expect(redact('jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4')).toBe(`jwt ${REDACTED}`);
  });
  it('removes the password argument of /PARTICIPAR and leaves ordinary game text alone', () => {
    expect(redact('/PARTICIPAR 3 misala')).toBe(`/PARTICIPAR 3 ${REDACTED}`);
    expect(redact('/PARTICIPAR 3')).toBe('/PARTICIPAR 3');
    expect(redact('Has ganado 120 puntos de experiencia.')).toBe('Has ganado 120 puntos de experiencia.');
  });
});

describe('Ring', () => {
  it('keeps the last N items, oldest first', () => {
    const ring = new Ring<number>(3);
    for (let i = 1; i <= 7; i++) ring.push(i);
    expect(ring.values()).toEqual([5, 6, 7]);
    expect(ring.length).toBe(3);
    ring.clear(); ring.push(9);
    expect(ring.values()).toEqual([9]);
  });
});

describe('packetNameTable', () => {
  const name = packetNameTable(protocol as unknown as Record<string, unknown>);
  it('names server and client packets from every id table of the protocol', () => {
    expect(name('in', ServerPacketId.Connected)).toBe('Connected');
    expect(name('in', NpcsServerPacketId.LocaleMsg)).toBe('LocaleMsg');
    expect(name('out', ClientPacketId.LoginAccount)).toBe('LoginAccount');
    expect(name('out', SessionClientPacketId.CreateAccount)).toBe('CreateAccount');
    expect(name('in', 65000)).toBe('#65000');
  });
});

const base = (over: Partial<ReportInput> = {}): ReportInput => ({
  sessionId: 'abcdef12-3456', text: '  Me trabé en la puerta\nsegunda línea ', expected: '', screenshot: undefined,
  character: { name: 'Aotest', level: 5, className: 'Mago', map: 751, x: 50, y: 60, hp: 10, maxHp: 20 },
  phase: 'playing', client: { commit: 'abc123', assetVersion: 'v1' }, environment: { userAgent: 'UA' }, stats: { fps: 60 }, openWindows: ['options'],
  chat: [], console: [], protocol: [], errors: [], secrets: ['aotest@local.test', 'aotestpw1'], timeOrigin: Date.UTC(2026, 10, 22, 9, 0, 0), now: 1500,
  packetName: (dir, id) => `${dir}-${id}`, ...over,
});

describe('buildBugReport', () => {
  it('trims the text, stamps the time and names the protocol events (ids and times only)', () => {
    const report = buildBugReport(base({ protocol: [{ t: 1000, dir: 'out', id: 2 }, { t: 1200, dir: 'in', id: 1 }] }));
    expect(report.schema).toBe(1);
    expect(report.text).toBe('Me trabé en la puerta\nsegunda línea');
    expect(report.createdAt).toBe('2026-11-22T09:00:01.500Z');
    expect(report.protocol).toEqual([{ at: '2026-11-22T09:00:01.000Z', dir: 'out', id: 2, name: 'out-2' }, { at: '2026-11-22T09:00:01.200Z', dir: 'in', id: 1, name: 'in-1' }]);
    expect(report.character).toMatchObject({ name: 'Aotest', level: 5, map: 751 });
    expect(report.screenshot).toBeUndefined();
  });
  it('never carries the account e-mail or password, from any string', () => {
    const report = buildBugReport(base({
      text: 'entré con aotest@local.test y aotestpw1',
      expected: 'que AOTESTPW1 funcione',
      chat: ['Bienvenido aotestpw1'], console: [{ t: 1, level: 'warn', text: 'login aotest@local.test failed' }],
      errors: [{ t: 2, kind: 'error', message: 'boom aotestpw1', stack: 'at x (aotestpw1)' }],
      environment: { note: 'aotestpw1', nested: { deeper: ['aotest@local.test'] } },
    }));
    const json = JSON.stringify(report);
    expect(json).not.toMatch(/aotestpw1/i);
    expect(json).not.toContain('aotest@local.test');
    expect(report.text).toBe(`entré con ${REDACTED} y ${REDACTED}`);
  });
  it('cuts the rings and long strings to their limits', () => {
    const many = Array.from({ length: 500 }, (_, i) => `línea ${i}`);
    const report = buildBugReport(base({
      chat: many, console: many.map((text, t) => ({ t, level: 'log', text })), protocol: many.map((_, t) => ({ t, dir: 'in' as const, id: t })),
      errors: many.map((message, t) => ({ t, kind: 'error' as const, message })), text: 'x'.repeat(10_000),
    }));
    expect(report.chat).toHaveLength(LIMITS.chat);
    expect(report.chat.at(-1)).toBe('línea 499');
    expect(report.console).toHaveLength(LIMITS.console);
    expect(report.protocol).toHaveLength(LIMITS.protocol);
    expect(report.errors).toHaveLength(LIMITS.errors);
    expect(report.text.length).toBe(LIMITS.text);
  });
  it('attaches the screenshot only when one is given', () => {
    const report = buildBugReport(base({ screenshot: { dataUrl: 'data:image/png;base64,AAAA', width: 10, height: 5, type: 'image/png', bytes: 3 } }));
    expect(report.screenshot).toBe('data:image/png;base64,AAAA');
    expect(report.screenshotInfo).toEqual({ width: 10, height: 5, type: 'image/png', bytes: 3 });
  });
  it('works outside the world (no character)', () => {
    expect(buildBugReport(base({ character: undefined, phase: 'login' })).character).toBeNull();
  });
});

describe('helpers', () => {
  it('reportTitle takes the first non-empty line, the character and the map', () => {
    expect(reportTitle('\n  No puedo abrir el banco \nmás', { name: 'Aotest', map: 1 })).toBe('No puedo abrir el banco · Aotest · mapa 1');
    expect(reportTitle('', undefined)).toBe('Sin descripción');
  });
  it('consoleText prints errors and objects', () => {
    expect(consoleText(['a', 1, { b: 2 }, new TypeError('x')])).toBe('a 1 {"b":2} TypeError: x');
    expect(clip('abcdef', 4)).toBe('abc…');
  });
});
