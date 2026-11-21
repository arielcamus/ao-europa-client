import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setWireProfile } from '@ao/protocol';
import { ChatLocale } from '../src/chat-locale.js';
import { Session } from '../src/session.js';

/*
 * Ariel, 21 Nov 21:05, live play site: /EST disconnected him with "Packet id=141: 3 trailing bytes in one-message frame". The pinned VB6
 * client (619e69d HandleIncomingData) never closes on a malformed message: it logs "unhandled or too many bytes; K extra bytes found" and
 * drains them, and a read past the end is caught by the handler's own error handler. The session now does the same.
 */
const framed = (body: Uint8Array) => Uint8Array.from([body.length & 255, body.length >> 8, ...body]);
const fromHex = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));

function replay(file: string) {
  let now = 0;
  const logged: string[] = [];
  const session = new Session({ email: 'a', password: 'b' }, () => {}, () => now);
  session.logDecodeProblem = message => logged.push(message);
  const locale = new ChatLocale();
  locale.load(['[SP_MSG]', 'Msg1295=Estadisticas de: ¬1', 'Msg1857=Nivel: ¬1  EXP: ¬2/¬3', 'Msg1858=Salud: ¬1/¬2  Mana: ¬3/¬4  Vitalidad: ¬5/¬6', 'Msg1860=Menor Golpe/Mayor Golpe: ¬1/¬2'].join('\n'));
  session.ui.chat.locale = locale;
  const rows = readFileSync(new URL(`../../../tests/fixtures/vb6/prehoo-sweep/${file}`, import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l) as { t_ms: number; dir: string; hex: string });
  for (const row of rows.filter(r => r.dir === 's2c')) { now = row.t_ms; session.receive(framed(fromHex(row.hex))); }
  return { session, logged };
}

beforeEach(() => setWireProfile('prehoo'));
afterEach(() => setWireProfile('live'));

describe('decode problems are logged and survived, as in the pinned client', () => {
  it('the real /EST recording plays through: every stats line reaches the console and the session stays open', () => {
    const { session, logged } = replay('est-request-stats.jsonl');
    expect(session.phase).toBe('playing');
    const text = session.ui.messages.map(m => m.text);
    expect(text).toContain('Nivel: 1  EXP: 0/500');
    expect(text.some(t => t.startsWith('Salud: 20/20'))).toBe(true);
    // The three LocaleMsg frames that carry the pinned server's empty ConsoleMsg are logged, never printed as a blank line.
    expect(session.decodeProblems).toEqual(Array.from({ length: 3 }, () => ({ id: 141, problem: 'Server message ID: 141 too many bytes; 4 extra bytes found' })));
    expect(logged.every(line => line.includes('(extra 250000'))).toBe(true);
    const level = text.indexOf('Nivel: 1  EXP: 0/500');
    expect(text[level + 1]).toMatch(/^Salud: /); // no blank line from the drained ConsoleMsg in between
  });
  it('a frame a codec cannot read is skipped and the next frame is still handled', () => {
    const { session } = replay('est-request-stats.jsonl');
    const before = session.ui.messages.length;
    session.receive(Uint8Array.from([...framed(fromHex('8d004107')), ...framed(fromHex('250002686900'))]));
    expect(session.phase).toBe('playing');
    expect(session.decodeProblems.at(-1)).toMatchObject({ id: 141 });
    expect(session.ui.messages.slice(before).map(m => m.text)).toEqual(['hi']);
  });
});
