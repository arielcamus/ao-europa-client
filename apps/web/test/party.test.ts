import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FrameDecoder, GROUP_SKILL, PartyClientPacketId as PC, PartyServerPacketId as PS, SpellClientPacketId as SC, SpellServerPacketId as SS, decodeClientPacket, decodeServerPacket, encodeServerFrame,
} from '@ao/protocol';
import type { ClientPacket, ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { GROUP_FRAME, PartyState } from '../src/party.js';
import { Session } from '../src/session.js';

const rows = (name: string) => readFileSync(new URL(`../../../tests/fixtures/vb6/party/${name}.jsonl`, import.meta.url), 'utf8').trim().split('\n')
  .map(line => JSON.parse(line) as { dir: 's2c' | 'c2s'; id: number; hex: string });
const decoded = (name: string) => rows(name).filter(r => r.dir === 's2c').map(r => decodeServerPacket(Uint8Array.from(Buffer.from(r.hex, 'hex')))).filter(p => !('unknown' in p)) as ServerPacket[];
const member = (name: string, charIndex: number, minHp = 20, maxHp = 20) => ({ name, charIndex, head: 1, minHp, maxHp });

describe('PartyState', () => {
  it('lays the frames out like Group.UpdateRenderArea: the player is skipped, the rest are 60 px apart around the middle row', () => {
    const party = new PartyState(); party.selfCharIndex = 10;
    party.receive({ id: PS.UpdateGroupInfo, members: [member('Ana', 10), member('Bob', 11), member('Cleo', 12)] });
    expect(party.size).toBe(3);
    expect(party.frames.map(m => [m.name, m.groupId, m.top])).toEqual([['Bob', 2, 190], ['Cleo', 3, 250]]); // 250 - 60 * 2 / 2 = 190
    party.receive({ id: PS.UpdateGroupInfo, members: [member('Ana', 10), member('Bob', 11)] });
    expect(party.frames.map(m => m.top)).toEqual([250 - 30]); // two members: one frame at 250 - 60 / 2
  });
  it('cuts a name to 10 characters and clears the frames when the group is dissolved or has only the leader', () => {
    const party = new PartyState(); party.selfCharIndex = 1;
    party.receive({ id: PS.UpdateGroupInfo, members: [member('Leader', 1), member('AVeryLongCharacterName', 2)] });
    expect(party.frames[0]!.name).toBe('AVeryLongC');
    party.receive({ id: PS.UpdateGroupInfo, members: [member('Leader', 1)] });
    expect(party.size).toBe(1); expect(party.frames).toEqual([]);
    party.receive({ id: PS.UpdateGroupInfo, members: [] }); expect(party.size).toBe(0);
  });
  it('finds the frame under a map pixel unless the frames are hidden (Group.HandleMouseInput)', () => {
    const party = new PartyState(); party.selfCharIndex = 1;
    party.receive({ id: PS.UpdateGroupInfo, members: [member('Leader', 1), member('Bob', 2)] });
    const top = party.frames[0]!.top!;
    expect(party.frameAt(GROUP_FRAME.startX + 5, top + 5)?.name).toBe('Bob');
    expect(party.frameAt(GROUP_FRAME.startX + GROUP_FRAME.width + 1, top + 5)).toBeUndefined();
    party.toggleHidden(); expect(party.frameAt(GROUP_FRAME.startX + 5, top + 5)).toBeUndefined();
    party.toggleHidden(); expect(party.actOnFrame(2)).toEqual({ id: PC.ActionOnGroupFrame, groupId: 2 });
    expect(party.actOnFrame(1)).toBeUndefined(); // the player's own entry has no frame
  });
  it('FrmGrupo: DatosGrupo opens the list, expel needs a selected row, invite and leave close the window', () => {
    const party = new PartyState();
    expect(party.requestWindow()).toEqual({ id: PC.RequestGrupo });
    party.receive({ id: PS.DatosGrupo, inGroup: true, members: ['Ana(Líder)', 'Bob'] });
    expect(party.window?.members).toEqual(['Ana(Líder)', 'Bob']);
    expect(party.requestWindow()).toBeUndefined(); // already open
    expect(party.expel(-1)).toBeUndefined(); expect(party.expel(5)).toBeUndefined(); expect(party.window).toBeDefined();
    expect(party.expel(1)).toEqual({ id: PC.HecharDeGrupo, index: 1 }); expect(party.window).toBeUndefined();
    party.receive({ id: PS.DatosGrupo, inGroup: false, members: [] });
    expect(party.invite()).toEqual({ id: PC.InvitarGrupo }); expect(party.window).toBeUndefined();
    party.receive({ id: PS.DatosGrupo, inGroup: true, members: ['Ana'] });
    expect(party.leave()).toEqual({ id: PC.AbandonarGrupo }); expect(party.window).toBeUndefined();
  });
});

describe('recorded VB6 party sessions', () => {
  it('the member session ends outside any group and saw the invite question twice before accepting', () => {
    const party = new PartyState(); let questions = 0, sizes: number[] = [];
    for (const packet of decoded('group-lifecycle-member')) {
      if (packet.id === 142) { questions++; expect(packet).toMatchObject({ messageId: 1595, param: 'Pguilda' }); }
      if (packet.id === PS.UpdateGroupInfo) sizes = [...sizes, packet.members.length];
      party.receive(packet);
    }
    expect(questions).toBe(3);
    expect(sizes).toEqual([2, 0, 2, 0]); // joined, expelled, joined, left
    expect(party.size).toBe(0); expect(party.frames).toEqual([]);
  });
  it('the leader session shows the member with its HP while grouped and lists "(Líder)" first in DatosGrupo', () => {
    const party = new PartyState(); party.selfCharIndex = undefined;
    const lists: string[][] = [];
    for (const packet of decoded('group-lifecycle-leader')) {
      party.receive(packet);
      if (packet.id === PS.DatosGrupo && packet.inGroup) lists.push(packet.members);
      if (packet.id === PS.UpdateGroupInfo && packet.members.length === 2) expect(party.frames.length).toBeGreaterThan(0);
    }
    expect(lists).toEqual([['Pguilda(Líder)', 'Aotesta']]);
  });
  it('the client packets of the recording are the ones the codecs write', () => {
    const sent = rows('group-lifecycle-leader').filter(r => r.dir === 'c2s' && r.id !== 305).map(r => decodeClientPacket(Uint8Array.from(Buffer.from(r.hex, 'hex'))));
    expect(sent.filter(p => p.id === SC.WorkLeftClick).map(p => (p as { counter: number; skill: number }).counter)).toEqual([1, 2, 3]);
    expect(sent.filter(p => p.id === SC.WorkLeftClick).every(p => (p as { skill: number }).skill === GROUP_SKILL)).toBe(true);
    expect(sent.map(p => p.id).filter(id => [PC.RequestGrupo, PC.InvitarGrupo, PC.HecharDeGrupo].includes(id))).toContain(PC.HecharDeGrupo);
  });
});

function playing() {
  let now = 0; const sent: Uint8Array[] = [];
  const session = new Session({ email: 'a', password: 'b' }, bytes => sent.push(bytes), () => now);
  const recv = (...packets: ServerPacket[]) => { for (const packet of packets) session.receive(encodeServerFrame(packet)); };
  recv(f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap, { ...f.CharacterCreate, speeding: 1 }, f.UserCharIndexInServer, f.Logged);
  const out = () => { const decoder = new FrameDecoder(); return sent.flatMap(bytes => decoder.push(bytes).map(decodeClientPacket)) as (ClientPacket & { counter?: number })[]; };
  return { session, recv, out, at: (ms: number) => { now = ms; } };
}

describe('party in the session', () => {
  it('the invite target click is the spells feature\'s WorkLeftClick with skill Grupo on the shared workLeftClick counter', () => {
    const { session, recv, out, at } = playing();
    recv({ id: SS.WorkRequestTarget, skill: GROUP_SKILL, area: false, radius: 0 });
    expect(session.spells.targeting?.skill).toBe(GROUP_SKILL);
    at(1000); expect(session.spells.click(51, 60)).toBe(true);
    recv({ id: SS.WorkRequestTarget, skill: GROUP_SKILL, area: false, radius: 0 });
    at(2000); expect(session.spells.click(52, 61)).toBe(true);
    const clicks = out().filter(p => p.id === SC.WorkLeftClick);
    expect(clicks).toEqual([{ id: SC.WorkLeftClick, x: 51, y: 60, skill: GROUP_SKILL, counter: 1 }, { id: SC.WorkLeftClick, x: 52, y: 61, skill: GROUP_SKILL, counter: 2 }]);
  });
  it('sendPacket carries the counterless party and guild requests, and refuses a sequenced packet without a shared counter', () => {
    const { session, out } = playing();
    expect(session.sendPacket({ id: PC.RequestGrupo })).toBe(true);
    expect(() => session.sendPacket({ id: SC.WorkLeftClick, x: 1, y: 1, skill: GROUP_SKILL, counter: 99 })).toThrow(/session\.next\('workLeftClick'\)/);
    expect(out().map(p => p.id)).toContain(PC.RequestGrupo);
    const early = new Session({ email: 'a', password: 'b' }, () => undefined);
    expect(early.sendPacket({ id: PC.RequestGrupo })).toBe(false); // not logged in yet
  });
});
