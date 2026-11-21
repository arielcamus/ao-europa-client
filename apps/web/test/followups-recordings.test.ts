import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GmClientPacketId as G, SkillsClientPacketId as SK, StatusServerPacketId as SS, encodeClientFrame } from '@ao/protocol';
import { Session } from '../src/session.js';

// Real recordings against the pinned pre-HOO server (9ccd7fad), tools/conformance/scenario-followups.mjs (#43, #44).
type Line = { t_ms: number; dir: 's2c' | 'c2s'; id: number; hex: string };
const load = (name: string) => readFileSync(new URL(`../../../tests/fixtures/vb6/followups/${name}.jsonl`, import.meta.url), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Line);
const replay = (lines: Line[], each?: (line: Line, session: Session) => void) => {
  const session = new Session({ email: 'x', password: 'y' }, () => undefined, () => 5000);
  for (const line of lines.filter(l => l.dir === 's2c')) {
    const body = Buffer.from(line.hex, 'hex'); session.receive(new Uint8Array([body.length & 255, body.length >> 8, ...body]));
    each?.(line, session);
  }
  return session;
};
const clientHex = (lines: Line[], id: number) => lines.filter(l => l.dir === 'c2s' && l.id === id).map(l => l.hex);

describe('replay of a real GM /ESTUPIDO, /NOESTUPIDO (tests/fixtures/vb6/followups/gm-make-dumb.jsonl)', () => {
  it('HandleMakeDumb sends Dumb to the named user and HandleMakeDumbNoMore DumbNoMore: the client is dumb in between, free after', () => {
    const lines = load('gm-make-dumb');
    let dumbAfterDumb: boolean | undefined;
    const session = replay(lines, (line, s) => { if (line.id === SS.Dumb) dumbAfterDumb = s.status.dumb; });
    expect(dumbAfterDumb).toBe(true);
    expect(session.status.dumb).toBe(false);
    // The web client's /ESTUPIDO and /NOESTUPIDO codecs write exactly what the recorder sent and the server acted on.
    const web = (id: number) => Buffer.from(encodeClientFrame({ id, userName: 'Aotest' } as never).subarray(2)).toString('hex');
    expect(clientHex(lines, G.MakeDumb)).toEqual([web(G.MakeDumb)]);
    expect(clientHex(lines, G.MakeDumbNoMore)).toEqual([web(G.MakeDumbNoMore)]);
  });
});

describe('replay of a real trainer list (tests/fixtures/vb6/followups/trainer-list.jsonl)', () => {
  it('a GM-spawned Entrenador (NPC 649): LeftClick one tile above selects it, TrainList answers its five creatures, /RMATA removes it', () => {
    const lines = load('trainer-list');
    const session = replay(lines);
    expect(session.skills.trainerCreatures).toEqual(['Murcielago', 'Lobo', 'Serpiente', 'Escorpion', 'Goblin']);
    expect(clientHex(lines, SK.TrainList)).toEqual(['2e00']);
    expect([...session.tracker.chars.values()].some(c => c.npcNumber === 649)).toBe(false); // removed again (only the NPC this run spawned)
  });
});

describe('replay of a real Pirata travel form (tests/fixtures/vb6/followups/pirata-viajar-form.jsonl)', () => {
  it('a Pirata NPC (NpcType 10) answers a click on its tile with ViajarForm; outside Transporter NPCs the server sends no destinations', () => {
    const lines = load('pirata-viajar-form');
    const session = replay(lines);
    expect(session.travel.destinations).toEqual([]); // MODULO_NPCs only fills TransportCity* for NpcType 26; FrmViajes opens empty
    expect(session.travel.viajarInterface).toBe(0);
    expect(lines.filter(l => l.dir === 's2c' && l.id === 147).map(l => l.hex)).toEqual(['93000000']); // ViajarForm: count 0, Interface 0
  });
});
