import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CombatServerPacketId as CS, SkillsServerPacketId as SK, StatusServerPacketId as ST } from '@ao/protocol';
import { fxTables } from '../src/fx-world.js';
import type { Stream } from '../src/fx-particles.js';
import { ClientPacketId as C, DoorClientPacketId as NC, NpcsServerPacketId as N, ServerPacketId as S, Heading, FrameDecoder, decodeClientPacket, encodeServerFrame } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { ChatLocale } from '../src/chat-locale.js';
import { Session } from '../src/session.js';
import { CharacterTracker, TILE_MS, vbColor } from '../src/characters.js';
import { parseColors, playerNameColor, privilegeTitle, splitName, readEquipment, NPC_NAME_COLOR } from '../src/character-data.js';
import { describeUser } from '../src/look-at.js';
import { dialogLifeMs } from '../src/npc-dialog.js';
import { parseIni } from '../src/assets.js';

const create = (charIndex: number, patch: Partial<Extract<ServerPacket, { id: S.CharacterCreate }>> = {}): ServerPacket =>
  ({ ...f.CharacterCreate, charIndex, x: 10, y: 10, heading: 3, speeding: 1, npc: 0, name: `P${charIndex}`, ...patch }) as ServerPacket;

const chatLocale = () => { const l = new ChatLocale(); l.load([
  '[SP_MSG]', 'Msg1105=Ves a ¬1', 'Msg1106=No ves nada interesante.', 'Msg1622=¬1 ¬2',
  '[NPC1]', 'BODY=117', 'DESC=Hola, hijo mio!', 'HEAD=3', 'NAME=Sacerdote <Iglesia>',
].join('\n')); return l; };

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
  it('draws no overhead text of its own (ChatBubbles do) and ignores speech from unknown characters', () => {
    const t = new CharacterTracker();
    t.receive(create(5), 0);
    t.receive({ id: N.ChatOverHead, chat: 'hola', charIndex: 5, color: 0x00ff0000, isSpell: false, x: 0, y: 0, minChatTime: 0, maxChatTime: 0 }, 100);
    expect(t.chars.get(5)).not.toHaveProperty('dialog');
    expect(vbColor(0x00ff0000)).toEqual({ r: 0, g: 0, b: 255 }); // VB colours are BGR
  });
  it('fires the NPC dialog window once per NPCDESC, and clears everything on a map change', () => {
    const t = new CharacterTracker();
    const seen: number[] = []; t.onNpcDescription = d => seen.push(d.npcNumber);
    t.receive(create(8, { npc: 1, npcNumber: 1, name: 'Sacerdote <Iglesia>' }), 0);
    expect(t.chars.get(8)).toMatchObject({ name: 'Sacerdote', clan: '<Iglesia>', npc: 1 });
    t.receive({ id: N.ChatOverHead, chat: 'NPCDESC*1', charIndex: 8, color: 0xffffff, isSpell: false, x: 0, y: 0, minChatTime: 0, maxChatTime: 0 }, 0);
    expect(seen).toEqual([1]);
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
    expect(chatLocale().message(1105, 'Aotest----¬0¬0'.replace('----', '-----'))).toMatch(/^Ves a Aotest /);
  });
  it('prints NPC name and nothing-to-see messages from the locale templates', () => {
    expect(chatLocale().message(1106, '')).toBe('No ves nada interesante.');
    // Fields: npc number, elemental tags, `hp-...-mask` status block; the 1622 template prints name and tags.
    expect(chatLocale().message(1622, '1\u00ac0\u00ac10/10-----16')).toBe('Sacerdote <Iglesia> ');
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
    h.session.ui.chat.locale = chatLocale();
    h.recv({ id: N.LocaleMsg, messageId: 1106, text: '', font: 3, channel: 0 });
    expect(h.session.ui.messages.at(-1)?.text).toBe('No ves nada interesante.');
    h.recv({ id: N.LocaleMsg, messageId: 1622, text: '1¬¬100-1-1-1-1-16', font: 3, channel: 0 });
    expect(h.session.ui.messages.filter(m => m.font === 3).length).toBe(2); // one print per LocaleMsg
    expect(h.session.ui.messages.at(-1)?.text).toBe('Sacerdote <Iglesia> ') // the NPC number became its name;
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
    const now = 0; const seen: number[] = [];
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

// Ariel 21 Nov: creatures drawn behind a wall in the Newbie Dungeon always answered "Target inválido". Real creatures behind a wall
// target fine (live, map 37: WorkLeftClick on their tile -> Msg1622); the ones that fail are stale copies. The server sends a creature's
// step to the area it LEAVES and never a CharacterRemove (MoveNPCChar: ToNPCArea, then CheckUpdateNeededNpc). Recorded live on map 37:
// AreaChanged (75,78) -> area 60..95; a Murciélago (NPC 506) then stepped to (73,59). VB6 Char_Move_by_Pos erases it there.
describe('characters that step out of the area (Char_Move_by_Pos: If nY < MinLimiteY ... Then EraseChar)', () => {
  const area = { minX: 60, maxX: 95, minY: 60, maxY: 95 }; // CambioDeArea(75, 78)
  it('a step or a translate outside MinLimiteX..MaxLimiteY erases the character; inside it stays; the own character never goes', () => {
    const t = new CharacterTracker(); t.area = area; t.selfIndex = 1;
    t.receive(create(689, { npc: 1, npcNumber: 506, x: 73, y: 60 }), 0);
    t.receive({ id: S.CharacterMove, charIndex: 689, x: 73, y: 61 }, 100);
    expect(t.chars.get(689)).toMatchObject({ x: 73, y: 61 });
    t.receive({ id: S.CharacterMove, charIndex: 689, x: 73, y: 60 }, 200);
    const before = t.revision;
    t.receive({ id: S.CharacterMove, charIndex: 689, x: 73, y: 59 }, 300);
    expect(t.chars.has(689)).toBe(false); expect(t.revision).toBeGreaterThan(before);
    for (const [from, x, y] of [[{ x: 60, y: 70 }, 59, 70], [{ x: 95, y: 70 }, 96, 70], [{ x: 70, y: 95 }, 70, 96]] as const) {
      t.receive(create(700, { npc: 1, ...from }), 400);
      t.receive({ id: S.CharacterMove, charIndex: 700, x, y }, 500);
      expect(t.chars.has(700), `${x},${y}`).toBe(false);
    }
    t.receive(create(701, { npc: 1, x: 80, y: 70 }), 600);
    t.receive({ id: 45, charIndex: 701, x: 80, y: 40, time: 300 } as ServerPacket, 700); // CharacterTranslate
    expect(t.chars.has(701)).toBe(false);
    t.receive(create(1, { x: 60, y: 70 }), 800);
    t.receive({ id: S.CharacterMove, charIndex: 1, x: 59, y: 70 }, 900); // EraseChar exits for UserCharIndex
    expect(t.chars.get(1)).toMatchObject({ x: 59 });
  });
  it('before the first AreaChanged nothing is erased', () => {
    const t = new CharacterTracker();
    t.receive(create(5, { npc: 1, x: 73, y: 60 }), 0);
    t.receive({ id: S.CharacterMove, charIndex: 5, x: 73, y: 59 }, 100);
    expect(t.chars.get(5)).toMatchObject({ x: 73, y: 59 });
  });
  it('session: the creature that left is not kept as a ghost the player later walks up to (the "Target inválido" creatures)', () => {
    const now = 0;
    const session = new Session({ email: 'a', password: 'b' }, () => {}, () => now);
    const recv = (...packets: ServerPacket[]) => { for (const packet of packets) session.receive(encodeServerFrame(packet)); };
    recv(f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap, { ...f.CharacterCreate, x: 75, y: 78, speeding: 1 }, f.UserCharIndexInServer, f.Logged);
    recv({ id: 57, x: 75, y: 78 } as ServerPacket); // AreaChanged: area 60..95 x 60..95
    recv(create(689, { npc: 1, npcNumber: 506, x: 73, y: 60 }), { id: S.CharacterMove, charIndex: 689, x: 73, y: 59 });
    expect(session.tracker.chars.has(689)).toBe(false);
    // Before the fix the bat stayed frozen at (73,59): the next area north (36..71) keeps it and it is drawn where nothing is.
    recv({ id: 57, x: 74, y: 59 } as ServerPacket);
    expect(session.tracker.at(73, 59)).toBeUndefined();
    expect(session.tracker.chars.has(f.UserCharIndexInServer.charIndex)).toBe(true);
  });
});

// Review of #107: every erase (CharacterRemove, a step out of the area, CambioDeArea) clears what VB6 EraseChar clears: the character's
// FX (meditation aura included), particle groups, auras (ResetCharInfo), status and floating text. Re-entering must start clean.
describe('one removal path (TileEngine_Chars.EraseChar)', () => {
  const stream: Stream = { name: 't', numParticles: 2, x1: 0, y1: 0, x2: 0, y2: 0, angle: 0, vecX1: 0, vecX2: 0, vecY1: 0, vecY2: 0, life1: 5, life2: 5, friction: 2,
    spin: false, spinL: 0, spinH: 0, alphaBlend: true, gravity: false, gravStrength: 0, bounceStrength: 0, xMove: false, yMove: false,
    moveX1: 0, moveX2: 0, moveY1: 0, moveY2: 0, grhList: [100], tint: [{ r: 1, g: 1, b: 1 }, { r: 1, g: 1, b: 1 }, { r: 1, g: 1, b: 1 }, { r: 1, g: 1, b: 1 }],
    speed: 0.5, lifeCounter: -1, resize: false, resizeX: 0, resizeY: 0 };
  const BAT = 689;
  function playing() {
    fxTables.streams = Array.from({ length: 20 }, () => ({ ...stream }));
    let now = 0;
    const session = new Session({ email: 'a', password: 'b' }, () => {}, () => now);
    const recv = (...packets: ServerPacket[]) => { for (const packet of packets) session.receive(encodeServerFrame(packet)); };
    recv(f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap, { ...f.CharacterCreate, x: 75, y: 78, speeding: 1 }, f.UserCharIndexInServer, f.Logged);
    recv({ id: 57, x: 75, y: 78 } as ServerPacket); // AreaChanged: area 60..95 x 60..95
    // Born with a permanent particle (MakeChar) and a head aura, meditating, invisible, with a floating damage number.
    const enter = (aura: string, particleFx: number) => recv(create(BAT, { npc: 1, npcNumber: 506, x: 73, y: 61, particleFx, headAura: aura, weaponAura: '', bodyAura: '',
      damageAura: '', resistanceAura: '', otherAura: '', shieldAura: '' }));
    return { session, recv, enter, advance: (ms: number) => { now += ms; } };
  }
  const state = (s: Session) => ({
    groups: s.world.charGroups.get(BAT)?.length ?? 0, aura: s.world.auras.get(BAT)?.get(4),
    fx: s.spells.effects.filter(e => e.charIndex === BAT).length, floating: s.combat.floating.filter(e => e.charIndex === BAT).length,
  });
  const decorate = (h: ReturnType<typeof playing>) => h.recv(
    { id: SK.MeditateToggle, charIndex: BAT, fx: 115, x: 73, y: 61 } as ServerPacket,
    { id: CS.TextOverChar, text: '3', charIndex: BAT, color: 0 } as ServerPacket);
  it('a creature with an aura steps out and re-enters: exactly one particle group and one aura, no meditation or floating text left over', () => {
    const h = playing(); h.enter('12:255:5:0', 3); decorate(h);
    expect(state(h.session)).toEqual({ groups: 1, aura: '12:255:5:0', fx: 1, floating: 1 });
    h.recv({ id: S.CharacterMove, charIndex: BAT, x: 73, y: 60 }, { id: S.CharacterMove, charIndex: BAT, x: 73, y: 59 }); // out of 60..95
    expect(h.session.tracker.chars.has(BAT)).toBe(false);
    expect(state(h.session)).toEqual({ groups: 0, aura: undefined, fx: 0, floating: 0 });
    h.enter('12:255:5:0', 3); // CheckUpdateNeededNpc: the server creates it again when it comes back
    expect(state(h.session)).toEqual({ groups: 1, aura: '12:255:5:0', fx: 0, floating: 0 });
  });
  it('an aura or particle that ended while it was away does not come back', () => {
    const h = playing(); h.enter('12:255:5:0', 3); decorate(h);
    h.recv({ id: S.CharacterMove, charIndex: BAT, x: 73, y: 60 }, { id: S.CharacterMove, charIndex: BAT, x: 73, y: 59 });
    h.enter('', 0);
    expect(state(h.session)).toEqual({ groups: 0, aura: '', fx: 0, floating: 0 });
  });
  it('CambioDeArea and CharacterRemove clear the same state; the status of others goes, the own character keeps its own', () => {
    for (const erase of [
      (h: ReturnType<typeof playing>) => h.recv({ id: 57, x: 75, y: 90 } as ServerPacket), // new area 72..100: (73,61) is outside
      (h: ReturnType<typeof playing>) => h.recv({ id: N.CharacterRemove, charIndex: BAT, vanish: false, warp: false }),
    ]) {
      const h = playing(); h.enter('12:255:5:0', 3); decorate(h);
      h.recv({ id: ST.SetInvisible, charIndex: BAT, invisible: true, x: 73, y: 61 } as ServerPacket);
      expect(h.session.status.invisible.has(BAT)).toBe(true);
      erase(h);
      expect(h.session.tracker.chars.has(BAT)).toBe(false);
      expect(state(h.session)).toEqual({ groups: 0, aura: undefined, fx: 0, floating: 0 });
      expect(h.session.status.invisible.has(BAT)).toBe(false);
      h.enter('12:255:5:0', 3);
      expect(state(h.session)).toMatchObject({ groups: 1 });
    }
    const h = playing(), me = f.UserCharIndexInServer.charIndex;
    h.recv({ id: ST.SetInvisible, charIndex: me, invisible: true, x: 75, y: 78 } as ServerPacket, { id: N.CharacterRemove, charIndex: me, vanish: false, warp: true });
    expect(h.session.status.invisible.has(me)).toBe(true); // a warp removes and re-creates the own character
  });
  // #110: EraseChar also calls Dialogos.RemoveDialog and StopAllWavsMatchingLabel("sailing_<index>").
  it('a talking character steps out of the area: its speech bubble goes and the audio side hears the erase (every removal path)', () => {
    const talk = { id: N.ChatOverHead, chat: 'Hola', charIndex: BAT, color: 0xffffff, isSpell: false, x: 73, y: 61, minChatTime: 0, maxChatTime: 0 } as ServerPacket;
    for (const erase of [
      (h: ReturnType<typeof playing>) => h.recv({ id: S.CharacterMove, charIndex: BAT, x: 73, y: 60 }, { id: S.CharacterMove, charIndex: BAT, x: 73, y: 59 }),
      (h: ReturnType<typeof playing>) => h.recv({ id: 57, x: 75, y: 90 } as ServerPacket),
      (h: ReturnType<typeof playing>) => h.recv({ id: N.CharacterRemove, charIndex: BAT, vanish: false, warp: false }),
    ]) {
      const h = playing(), erased: number[] = [];
      h.session.onCharacterErased = index => erased.push(index);
      h.enter('', 0); h.recv(talk);
      expect(h.session.ui.chat.dialogs.has(BAT)).toBe(true);
      erase(h);
      expect(h.session.tracker.chars.has(BAT)).toBe(false);
      expect(h.session.ui.chat.dialogs.has(BAT)).toBe(false);
      expect(h.session.ui.chat.visibleDialogs().map(v => v.charIndex)).not.toContain(BAT);
      expect(erased).toEqual([BAT]);
    }
  });
});
