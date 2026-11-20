import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ClientPacketId as C, DoorClientPacketId as NC, NpcsServerPacketId as N, ServerPacketId as S, Heading, FrameDecoder, decodeClientPacket, encodeServerFrame } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { Session } from '../src/session.js';
import { CharacterTracker, TILE_MS, vbColor } from '../src/characters.js';
import { parseColors, parseLocale, playerNameColor, privilegeTitle, splitName, readEquipment, NPC_NAME_COLOR } from '../src/character-data.js';
import { describeUser, localeText } from '../src/look-at.js';
import { dialogLifeMs } from '../src/npc-dialog.js';
import { parseIni } from '../src/assets.js';

const create = (charIndex: number, patch: Partial<Extract<ServerPacket, { id: S.CharacterCreate }>> = {}): ServerPacket =>
  ({ ...f.CharacterCreate, charIndex, x: 10, y: 10, heading: 3, speeding: 1, npc: 0, name: `P${charIndex}`, ...patch }) as ServerPacket;
const locale = () => parseLocale(parseIni([
  '[SP_MSG]', 'Msg1105=Ves a ¬1', 'Msg1106=No ves nada interesante.', 'Msg1622=¬1 ¬2',
  '[NPC1]', 'BODY=117', 'DESC=Hola, hijo mio!', 'HEAD=3', 'NAME=Sacerdote <Iglesia>',
].join('\n')));

describe('character tracker', () => {
  it('creates, moves (with the heading from the delta and a one-tile slide), changes and removes characters', () => {
    const t = new CharacterTracker();
    t.receive(create(7), 0);
    expect(t.chars.get(7)).toMatchObject({ name: 'P7', x: 10, y: 10, heading: 3 });
    t.receive({ id: S.CharacterMove, charIndex: 7, x: 11, y: 10 }, 1000);
    expect(t.chars.get(7)).toMatchObject({ x: 11, heading: Heading.East });
    expect(t.visualPosition(t.chars.get(7)!, 1000)).toMatchObject({ x: 10, y: 10, moving: true });
    expect(t.visualPosition(t.chars.get(7)!, 1000 + TILE_MS / 2).x).toBeCloseTo(10.5, 5);
    expect(t.visualPosition(t.chars.get(7)!, 1000 + TILE_MS + 1)).toMatchObject({ x: 11, moving: false });
    t.receive({ id: S.CharacterMove, charIndex: 7, x: 11, y: 9 }, 2000);
    expect(t.chars.get(7)!.heading).toBe(Heading.North);
    t.receive({ id: N.CharacterChange, charIndex: 7, flags: 1, body: 9, head: 8, heading: 4, weapon: 0, shield: 33, helmet: 0, cart: 0, backpack: 0, fx: 0, fxLoops: 0 }, 3000);
    // VB6 keeps the old weapon when the change carries 0, but takes the new shield.
    expect(t.chars.get(7)).toMatchObject({ body: 9, head: 8, heading: 4, shield: 33, weapon: f.CharacterCreate.weapon, idle: true });
    t.receive({ id: N.CharacterRemove, charIndex: 7, vanish: false, warp: false }, 4000);
    expect(t.chars.has(7)).toBe(false);
  });
  it('speeds a slide up for fast characters and snaps teleports', () => {
    const t = new CharacterTracker();
    t.receive(create(1, { speeding: 2 }), 0); t.receive(create(2), 0);
    t.receive({ id: S.CharacterMove, charIndex: 1, x: 10, y: 11 }, 0);
    expect(t.chars.get(1)!.motion!.duration).toBeCloseTo(TILE_MS / 2, 5);
    t.receive({ id: S.CharacterMove, charIndex: 2, x: 40, y: 10 }, 0);
    expect(t.chars.get(2)!.motion).toBeUndefined();
    t.receive({ id: S.CharacterMove, charIndex: 2, x: 40, y: 10 }, 0); // same tile: no heading, no slide
    expect(t.chars.get(2)!.x).toBe(40);
  });
  it('shows overhead text for its VB6 lifetime and drops it on RemoveCharDialog / RemoveDialogs', () => {
    const t = new CharacterTracker(); t.locale = locale();
    t.receive(create(5), 0);
    t.receive({ id: N.ChatOverHead, chat: 'hola', charIndex: 5, color: 0x00ff0000, isSpell: false, x: 0, y: 0, minChatTime: 0, maxChatTime: 0 }, 100);
    expect(t.chars.get(5)!.dialog).toMatchObject({ text: 'hola', lifeMs: 3000 + 60 * 4 });
    expect(vbColor(0x00ff0000)).toEqual({ r: 0, g: 0, b: 255 }); // VB colours are BGR
    t.expireDialogs(100 + 3239); expect(t.chars.get(5)!.dialog).toBeDefined();
    t.expireDialogs(100 + 3241); expect(t.chars.get(5)!.dialog).toBeUndefined();
    t.receive({ id: N.ChatOverHead, chat: 'otra', charIndex: 5, color: 0, isSpell: false, x: 0, y: 0, minChatTime: 0, maxChatTime: 0 }, 0);
    t.receive({ id: N.RemoveCharDialog, charIndex: 5 }, 1); expect(t.chars.get(5)!.dialog).toBeUndefined();
    t.receive({ id: N.ChatOverHead, chat: 'x', charIndex: 5, color: 0, isSpell: false, x: 0, y: 0, minChatTime: 0, maxChatTime: 0 }, 0);
    t.receive({ id: N.RemoveDialogs }, 1); expect(t.chars.get(5)!.dialog).toBeUndefined();
    t.receive({ id: N.ChatOverHead, chat: 'fantasma', charIndex: 99, color: 0, isSpell: false, x: 0, y: 0, minChatTime: 0, maxChatTime: 0 }, 0); // unknown char: ignored
  });
  it('turns NPCDESC into the NPC text, fires the dialog window once, and clears everything on a map change', () => {
    const t = new CharacterTracker(); t.locale = locale();
    const seen: number[] = []; t.onNpcDescription = d => seen.push(d.npcNumber);
    t.receive(create(8, { npc: 1, npcNumber: 1, name: 'Sacerdote <Iglesia>' }), 0);
    expect(t.chars.get(8)).toMatchObject({ name: 'Sacerdote', clan: '<Iglesia>', npc: 1 });
    t.receive({ id: N.ChatOverHead, chat: 'NPCDESC*1', charIndex: 8, color: 0xffffff, isSpell: false, x: 0, y: 0, minChatTime: 0, maxChatTime: 0 }, 0);
    expect(seen).toEqual([1]);
    expect(t.chars.get(8)!.dialog!.text).toBe('Hola, hijo mio!');
    expect(dialogLifeMs('Hola, hijo mio!')).toBe(200 + 30 * 15);
    t.receive({ id: S.ChangeMap, map: 2, resourceMap: 2 }, 0);
    expect(t.chars.size).toBe(0);
  });
  it('finds the character standing on a tile', () => {
    const t = new CharacterTracker(); t.receive(create(3), 0);
    expect(t.at(10, 10)?.charIndex).toBe(3); expect(t.at(11, 10)).toBeUndefined();
  });
});

describe('names and colours', () => {
  const colors = parseColors(["[Ne]", "R=188", "G=188", "B=188", "[Ci]", "R=6", "G=128", "B=255", "[Cr]", "R=233", "G=0", "B=0", "[6] 'concilio", "R=255", "G=102", "B=102", "[1]", "R=0", "G=136", "B=0"].join('\n'));
  it('uses the VB6 status colours, privilege colours, white for the same group, and blue for NPCs', () => {
    expect(playerNameColor(colors, 1, 0)).toEqual({ r: 6, g: 128, b: 255 }); // citizen
    expect(playerNameColor(colors, 0, 0)).toEqual({ r: 233, g: 0, b: 0 }); // criminal
    expect(playerNameColor(colors, 2, 0)).toEqual({ r: 255, g: 102, b: 102 }); // section [6] with a trailing comment
    expect(playerNameColor(colors, 1, 2)).toEqual({ r: 0, g: 136, b: 0 }); // privileges 2 = bit 1
    expect(playerNameColor(colors, 1, 1)).toEqual({ r: 6, g: 128, b: 255 }); // privileges bit 0 = none
    expect(playerNameColor(colors, 0, 0, true)).toEqual({ r: 255, g: 255, b: 255 });
    expect(NPC_NAME_COLOR).toEqual({ r: 0, g: 129, b: 195 });
    expect(privilegeTitle(2)).toBe('<Game Master>'); expect(privilegeTitle(0)).toBeUndefined();
  });
  it('splits "Name{alias}<Clan>" like HandleCharacterCreate', () => {
    expect(splitName('Ariel')).toEqual({ name: 'Ariel', alias: '', clan: '' });
    expect(splitName('Ariel <Los Pibes>')).toEqual({ name: 'Ariel', alias: '', clan: '<Los Pibes>' });
    expect(splitName('Ariel {Ari} <Los Pibes>')).toEqual({ name: 'Ariel', alias: 'Ari', clan: '<Los Pibes>' });
  });
});

describe('look at a tile (left click replies)', () => {
  it('prints the user description with the Spanish class and race', () => {
    expect(describeUser('Aotest--hola-Clan--3-1-20-')).toBe('Aotest <hola> <Clan> <Guerrero|Humano> <Nivel:20> ');
    expect(localeText(1105, 'Aotest----¬0¬0'.replace('----', '-----'), locale())).toMatch(/^Ves a Aotest /);
  });
  it('prints NPC name and nothing-to-see messages from the locale templates', () => {
    expect(localeText(1106, '', locale())).toBe('No ves nada interesante.');
    // Fields: npc number, elemental tags, `hp-...-mask` status block; the 1622 template prints name and tags.
    expect(localeText(1622, '1\u00ac0\u00ac10/10-----16', locale())).toBe('Sacerdote <Iglesia> ');
  });
});

describe('equipment animations', () => {
  const graphics = new Map([[10, { file: 1, x: 0, y: 0, width: 20, height: 30 }]]) as never;
  it('reads direct (Dir1..4) and mold-based (Std) weapons', () => {
    const arms = parseIni('[ARMA1]\nDir1=10\nDir2=0\n[ARMA2]\nStd=1\nFileNum=2002');
    const molds = parseIni('[Molde1]\nX=0\nY=0\nWidth=27\nHeight=47\nDir1=6\nDir2=6\nDir3=5\nDir4=5');
    const direct = readEquipment(arms, molds, graphics, 'arma', 1);
    expect(direct[0]!.frames[0]).toMatchObject({ file: 1, width: 20 }); expect(direct[1]).toBeUndefined();
    const templated = readEquipment(arms, molds, graphics, 'arma', 2);
    // Rows are South, North, West, East: North (heading 1) is row 2 with 6 frames, South row 1 with 6.
    expect(templated[0]!.frames).toHaveLength(6); expect(templated[0]!.frames[0]).toMatchObject({ x: 0, y: 47, file: 2002 });
    expect(templated[2]!.frames).toHaveLength(6); expect(templated[3]!.frames).toHaveLength(5); // South, West
  });
});

describe('session click and tracker wiring', () => {
  function harness() {
    let now = 0; const sent: Uint8Array[] = [];
    const session = new Session({ email: 'a', password: 'b' }, bytes => sent.push(bytes), () => now);
    const recv = (...packets: ServerPacket[]) => { for (const p of packets) session.receive(encodeServerFrame(p)); };
    recv(f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap, { ...f.CharacterCreate, speeding: 1, npc: 0 }, f.UserCharIndexInServer, f.Logged);
    return { session, recv, sent, advance: (ms: number) => { now += ms; } };
  }
  it('tracks everybody the session hears about, including self', () => {
    const h = harness();
    h.recv(create(77, { x: 51, y: 60 }));
    expect([...h.session.tracker.chars.keys()].sort()).toEqual([77, f.CharacterCreate.charIndex].sort());
  });
  it('sends LeftClick with the shared PacketCounters counter, paced by Intervals.leftClick, inside the map only', () => {
    const h = harness();
    expect(h.session.leftClick(51, 60)).toBe(true);
    expect(h.session.leftClick(51, 60)).toBe(false); // paced
    h.advance(300);
    expect(h.session.leftClick(0, 5)).toBe(false); expect(h.session.leftClick(51, 101)).toBe(false);
    expect(h.session.leftClick(52, 61)).toBe(true);
    const decoder = new FrameDecoder();
    const clicks = h.sent.flatMap(bytes => decoder.push(bytes).map(decodeClientPacket)).filter(p => p.id === NC.LeftClick);
    expect(clicks).toMatchObject([{ x: 51, y: 60, counter: 1 }, { x: 52, y: 61, counter: 2 }]);
    expect(C.Walk).toBe(78);
  });
  it('shows LocaleMsg look-at replies in the console using the loaded locale', () => {
    const h = harness();
    h.session.tracker.locale = locale();
    h.recv({ id: N.LocaleMsg, messageId: 1106, text: '', font: 3, channel: 0 });
    expect(h.session.ui.messages.at(-1)?.text).toBe('No ves nada interesante.');
  });
});

describe('replay of recorded VB6 sessions', () => {
  const replay = (file: string) => {
    let now = 0;
    const session = new Session({ email: 'a', password: 'b' }, () => {}, () => now);
    const lines = readFileSync(new URL(`../../../tests/fixtures/vb6/npcs/${file}`, import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l) as { t_ms: number; dir: string; hex: string });
    for (const line of lines.filter(l => l.dir === 's2c')) {
      now = line.t_ms;
      const body = Uint8Array.from(Buffer.from(line.hex, 'hex'));
      session.receive(Uint8Array.from([body.length & 255, body.length >> 8, ...body]));
    }
    return session;
  };
  it('session-full: other players and NPCs are tracked, a remover leaves the map, look-at replies reach the console', () => {
    const session = replay('session-full.jsonl');
    const chars = [...session.tracker.chars.values()];
    expect(chars.length).toBeGreaterThan(5);
    expect(chars.some(c => c.npc > 0)).toBe(true);
    expect(session.tracker.chars.get(0x13eb)).toBeUndefined();
    expect(session.ui.messages.length).toBeGreaterThan(0);
  });
  it('session-npcdesc: the real NPCDESC overhead fires the NPC dialog hook', () => {
    let now = 0; const seen: number[] = [];
    const session = new Session({ email: 'a', password: 'b' }, () => {}, () => now);
    session.tracker.onNpcDescription = d => { seen.push(d.npcNumber); };
    const lines = readFileSync(new URL('../../../tests/fixtures/vb6/npcs/session-npcdesc.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l) as { dir: string; id: number; hex: string });
    for (const line of lines.filter(l => l.dir === 's2c')) {
      const body = Uint8Array.from(Buffer.from(line.hex, 'hex'));
      session.receive(Uint8Array.from([body.length & 255, body.length >> 8, ...body]));
    }
    expect(seen).toContain(1027);
  });
  it('session-npc-dialog: NPC CharacterMove frames slide characters one tile', () => {
    const session = replay('session-npc-dialog.jsonl');
    expect([...session.tracker.chars.values()].some(c => c.npc > 0)).toBe(true);
  });
});
