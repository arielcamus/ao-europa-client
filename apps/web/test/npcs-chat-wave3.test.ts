import { describe, expect, it } from 'vitest';
import { CharValueType, KeysClientPacketId as K, ServerPacketId as S, SessionClientPacketId as SCP, SessionServerPacketId as SS, decodeClientPacket, encodeServerFrame, FrameDecoder } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { Session } from '../src/session.js';
import { CharacterTracker, splitTag } from '../src/characters.js';
import { OWN_CLAN_COLOR, clanTagColor, parseColors } from '../src/character-data.js';
import { ObjectCatalog } from '../src/object-catalog.js';
import { parseIni } from '../src/assets.js';

const create = (charIndex: number, patch: Record<string, unknown> = {}) => ({ ...f.CharacterCreate, charIndex, x: 10, y: 10, heading: 3, speeding: 1, npc: 1, name: `N${charIndex}`, ...patch }) as ServerPacket;
const SELF = f.CharacterCreate.charIndex;
function playing() {
  let now = 0; const sent: Uint8Array[] = [];
  const s = new Session({ email: 'a', password: 'b' }, bytes => sent.push(bytes), () => now);
  for (const p of [f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap, { ...f.CharacterCreate, speeding: 1 }, f.UserCharIndexInServer, f.Logged]) s.receive(encodeServerFrame(p));
  sent.length = 0;
  return { s, sent, advance: (ms: number) => { now += ms; } };
}
const sentIds = (sent: Uint8Array[]) => sent.flatMap(bytes => new FrameDecoder().push(bytes).map(body => decodeClientPacket(body).id));

describe('CharacterTranslate (TranslateCharacterToPos)', () => {
  it('moves a character to any tile and glides it in over the packet time, without the walking animation or a heading change', () => {
    const t = new CharacterTracker();
    t.receive(create(5), 0);
    t.receive({ id: SS.CharacterTranslate, charIndex: 5, x: 14, y: 10, time: 400 }, 1000);
    const char = t.chars.get(5)!;
    expect(char).toMatchObject({ x: 14, y: 10, heading: 3 });
    expect(t.visualPosition(char, 1000)).toMatchObject({ x: 10, y: 10, moving: false });
    expect(t.visualPosition(char, 1200).x).toBeCloseTo(12, 5);
    expect(t.visualPosition(char, 1401)).toMatchObject({ x: 14, moving: false });
  });
  it('ignores an unknown character and a zero time (VB6 would divide by zero)', () => {
    const t = new CharacterTracker();
    t.receive({ id: SS.CharacterTranslate, charIndex: 9, x: 3, y: 3, time: 100 }, 0);
    expect(t.chars.size).toBe(0);
    t.receive(create(5), 0);
    t.receive({ id: SS.CharacterTranslate, charIndex: 5, x: 11, y: 10, time: 0 }, 0);
    expect(t.chars.get(5)).toMatchObject({ x: 11 }); expect(t.chars.get(5)!.motion).toBeUndefined();
  });
  it('moves the player itself with a translate motion (no footsteps / walking frames)', () => {
    const { s } = playing();
    s.receive(encodeServerFrame({ id: SS.CharacterTranslate, charIndex: SELF, x: f.CharacterCreate.x + 2, y: f.CharacterCreate.y, time: 500 }));
    expect(s.position).toMatchObject({ x: f.CharacterCreate.x + 2 });
    expect(s.motion).toMatchObject({ translate: true, duration: 500 });
    expect(s.self).toMatchObject({ x: f.CharacterCreate.x + 2 });
  });
});

describe('UpdateTagAndStatus, UpdateFlag, UpdateCharValue', () => {
  it('splits "Name <Clan>" at "<", else "[", else keeps the whole tag, and takes status, group, guild and alignment', () => {
    expect(splitTag('Ana <Los Cuervos>')).toEqual({ name: 'Ana', clan: '<Los Cuervos>' });
    expect(splitTag('Ana [CONSULTA]')).toEqual({ name: 'Ana', clan: '[CONSULTA]' });
    expect(splitTag('Ana')).toEqual({ name: 'Ana', clan: '' });
    expect(splitTag('<Solo>')).toBeUndefined(); // Left$(tag, -1) raises in VB6
    const t = new CharacterTracker();
    t.receive(create(4, { npc: 0, name: 'Ana', status: 1 }), 0);
    t.receive({ id: SS.UpdateTagAndStatus, charIndex: 4, status: 3, tag: 'Ana <Cuervos>', groupIndex: 6, clanIndex: 9, clanAlignment: 4 }, 0);
    expect(t.chars.get(4)).toMatchObject({ name: 'Ana', clan: '<Cuervos>', status: 3, groupIndex: 6, clanIndex: 9, clanAlignment: 4 });
    t.receive({ id: SS.UpdateTagAndStatus, charIndex: 4, status: 2, tag: '<Solo>', groupIndex: 1, clanIndex: 2, clanAlignment: 1 }, 0);
    expect(t.chars.get(4)).toMatchObject({ name: 'Ana', status: 3, clanIndex: 2, clanAlignment: 1 }); // only the guild fields land before the VB6 error
  });
  it('keeps one character store: the tracker carries the wire tag, status, guild and flag', () => {
    const { s } = playing();
    s.receive(encodeServerFrame(create(8, { npc: 0, name: 'Beto' })));
    s.receive(encodeServerFrame({ id: SS.UpdateTagAndStatus, charIndex: 8, status: 2, tag: 'Beto <X>', groupIndex: 0, clanIndex: 3, clanAlignment: 3 }));
    s.receive(encodeServerFrame({ id: SS.UpdateFlag, charIndex: 8, flag: 2 }));
    expect(s.tracker.chars.get(8)).toMatchObject({ tag: 'Beto <X>', name: 'Beto', status: 2, clanIndex: 3, clanAlignment: 3, banderaIndex: 2 });
    expect('characters' in s).toBe(false);
  });
  it('UpdateCharValue eDontBlockTile (value 1) sets and clears the flag; other value types are ignored', () => {
    expect(CharValueType.DontBlockTile).toBe(1);
    const t = new CharacterTracker();
    t.receive(create(3), 0);
    t.receive({ id: SS.UpdateCharValue, charIndex: 3, valueType: 1, value: 1 }, 0);
    expect(t.chars.get(3)!.dontBlockTile).toBe(true);
    t.receive({ id: SS.UpdateCharValue, charIndex: 3, valueType: 7, value: 0 }, 0);
    expect(t.chars.get(3)!.dontBlockTile).toBe(true);
    t.receive({ id: SS.UpdateCharValue, charIndex: 3, valueType: 1, value: 0 }, 0);
    expect(t.chars.get(3)!.dontBlockTile).toBe(false);
    t.receive(create(3), 0); // a re-create resets it (.DontBlockTile = False)
    expect(t.chars.get(3)!.dontBlockTile).toBe(false);
  });
  it('guild tag colours follow GetClanTagColor', () => {
    const colors = parseColors('[20]\nR=1\nG=2\nB=3\n[21]\nR=4\nG=5\nB=6\n[23]\nR=7\nG=8\nB=9\n[24]\nR=10\nG=11\nB=12');
    expect(clanTagColor(colors, 0)).toEqual({ r: 255, g: 255, b: 255 });
    expect(clanTagColor(colors, 3)).toEqual({ r: 1, g: 2, b: 3 }); expect(clanTagColor(colors, 1)).toEqual({ r: 4, g: 5, b: 6 });
    expect(clanTagColor(colors, 4)).toEqual({ r: 7, g: 8, b: 9 }); expect(clanTagColor(colors, 2)).toEqual({ r: 10, g: 11, b: 12 });
    expect(clanTagColor(colors, 9)).toBeUndefined(); expect(OWN_CLAN_COLOR).toEqual({ r: 255, g: 255, b: 0 });
  });
});

describe('ShowSignal (InitCartel)', () => {
  it('opens one sign with the object text, ignores a second while open, and a step closes it', () => {
    const { s, advance } = playing();
    s.catalog = new ObjectCatalog(parseIni('[OBJ7]\nName=Cartel\nGrhIndex=1\nObjType=8\nTexto=Bienvenido a Ullathorpe\n[OBJ8]\nName=Otro\nTexto=Otro texto'));
    s.receive(encodeServerFrame({ id: SS.ShowSignal, objIndex: 7, grh: 600 }));
    expect(s.sign).toEqual({ text: 'Bienvenido a Ullathorpe', grh: 600 });
    s.receive(encodeServerFrame({ id: SS.ShowSignal, objIndex: 8, grh: 601 }));
    expect(s.sign!.grh).toBe(600);
    advance(1000); s.walk(1);
    expect(s.sign).toBeUndefined();
  });
});

describe('Esc during the logout countdown (CancelarExit)', () => {
  it('Quit sets UserSaliendo; Esc then sends CancelarExit once and clears it', () => {
    const { s, sent } = playing();
    expect(s.cancelExit()).toBe(false); expect(sentIds(sent)).toEqual([]);
    s.sendAction({ id: K.Quit });
    expect(s.leaving).toBe(true);
    expect(s.cancelExit()).toBe(true);
    expect(s.leaving).toBe(false);
    expect(s.cancelExit()).toBe(false);
    expect(sentIds(sent)).toEqual([K.Quit, SCP.CancelarExit]);
    expect(SCP.CancelarExit).toBe(247);
  });
  it('the server disconnect resets the flag (HandleDisconnect)', () => {
    const { s } = playing();
    s.interactive = true;
    s.sendAction({ id: K.Quit });
    s.receive(encodeServerFrame({ id: S.Disconnect, fullLogout: true } as ServerPacket));
    expect(s.leaving).toBe(false);
  });
});

describe('follow-ups', () => {
  it('Disconnect resets the skills state (#38: SkillsState.reset was never called)', () => {
    const { s } = playing();
    s.interactive = true; s.skills.resting = true; s.skills.skillPoints = 5;
    s.receive(encodeServerFrame({ id: S.Disconnect, fullLogout: true } as ServerPacket));
    expect(s.skills.resting).toBe(false); expect(s.skills.skillPoints).toBe(0);
  });
  it('the tracker mirrors the player\'s steps, so tracker.at is the one "who stands where" (#16 item 8)', () => {
    const { s, advance } = playing();
    advance(1000); expect(s.walk(3)).toBe(true);
    expect(s.tracker.at(s.position!.x, s.position!.y)?.charIndex).toBe(SELF);
  });
});
