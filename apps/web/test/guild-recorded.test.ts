import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GuildClientPacketId as GC, GuildServerPacketId as GS, decodeClientPacket, decodeServerPacket } from '@ao/protocol';
import type { ClientPacket, ServerPacket } from '@ao/protocol';
import { BankTradeState } from '../src/bank-trade-state.js';
import { GuildState } from '../src/guild.js';

/** Real VB6 recordings of a guild lifecycle (tools/real-server/record-guild-flow.mjs): a leader and an applicant, 21 Nov 2026. */
type Row = { t_ms: number; dir: 's2c' | 'c2s'; id: number; hex: string };
const rows = (name: string) => readFileSync(new URL(`../../../tests/fixtures/vb6/guild/${name}.jsonl`, import.meta.url), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Row);
const server = (row: Row) => decodeServerPacket(Uint8Array.from(Buffer.from(row.hex, 'hex'))) as ServerPacket & { unknown?: true };
const client = (row: Row) => decodeClientPacket(Uint8Array.from(Buffer.from(row.hex, 'hex'))) as ClientPacket;

describe('recorded guild lifecycle: the leader (flow: found, applicant card, application text, reject)', () => {
  const data = rows('guild-flow-leader');
  /** Feeds every server packet up to and including the n-th packet with `id`. */
  const upTo = (g: GuildState, id: number, nth = 1) => {
    let seen = 0;
    for (const row of data.filter(r => r.dir === 's2c')) {
      const packet = server(row); if ('unknown' in packet) continue;
      g.receive(packet);
      if (packet.id === id && ++seen === nth) return packet;
    }
    throw new Error(`no packet ${id} #${nth}`);
  };
  it('the panel lists the applicant; the server ends the request list with a NUL, so VB6 Split (and we) keep a blank last row', () => {
    const g = new GuildState(); upTo(g, GS.GuildLeaderInfo, 2);
    expect(g.leader?.joinRequests).toEqual(['Windowsapp', '']); expect(g.leader?.members).toEqual(['Wintest']);
    expect(g.leader?.guilds).toEqual(['Pguildclan-0', 'WinGuild-0'].map(entry => entry.replace(/-\d$/, '')));
  });
  it('double-clicking the applicant opens frmCharInfo in request mode; the server upper-cases the name it sends back', () => {
    const g = new GuildState(); upTo(g, GS.GuildLeaderInfo, 2);
    expect(g.memberInfo('Windowsapp', 'requests')).toEqual({ id: GC.GuildMemberInfo, userName: 'Windowsapp' });
    upTo(g, GS.CharacterInfo, 1);
    expect(g.charInfo).toMatchObject({ mode: 'requests', name: 'WINDOWSAPP', level: 1, currentGuild: 'Ninguno', characterClass: 1, race: 2 });
    // The buttons act on the name as the server wrote it; the server matches it case-insensitively (the accept below succeeded with it).
    expect(g.joinerInfo()).toEqual({ id: GC.GuildRequestJoinerInfo, userName: 'WINDOWSAPP' });
  });
  it('Peticion: the real server answers with ShowUserRequest (99), the packet that fills frmUserRequest in the trade state, not OfferDetails (90)', () => {
    const trade = new BankTradeState();
    for (const row of data.filter(r => r.dir === 's2c')) { const packet = server(row); if (!('unknown' in packet)) trade.receive(packet); }
    expect(trade.requests).toEqual(['Quiero entrar al clan;º de prueba'.replaceAll('·', '\n')]);
    expect(data.some(r => r.dir === 's2c' && r.id === GS.OfferDetails)).toBe(false);
  });
  it('rejecting sends the reason without commas (the upper-cased card name goes out as is)', () => {
    const g = new GuildState(); upTo(g, GS.GuildLeaderInfo, 2); g.memberInfo('Windowsapp', 'requests'); upTo(g, GS.CharacterInfo, 1);
    g.startReject();
    expect(g.sendComment('Todavia no').packet).toEqual({ id: GC.GuildRejectNewMember, userName: 'WINDOWSAPP', reason: 'Todavia no' });
    // VB6 removes the entry only when List(i) = nombre (a binary compare); the card name came back upper-cased, so the row stays until the panel is asked again.
    expect(g.leader?.joinRequests).toEqual(['Windowsapp', '']);
    const sent = data.filter(r => r.dir === 'c2s' && r.id === GC.GuildRejectNewMember).map(client);
    expect(sent[0]).toMatchObject({ userName: 'Windowsapp', reason: 'Todavia no' });
  });
  it('the second CharacterInfo (after the first rejection) lists the previous petition', () => {
    const g = new GuildState(); upTo(g, GS.CharacterInfo, 2);
    expect(g.charInfo?.previousPetitions).toBe('WinGuild');
  });
});

describe('recorded guild lifecycle: the applicant', () => {
  const data = rows('guild-flow-applicant');
  const feed = (g: GuildState, id?: number, nth = 1) => {
    let seen = 0;
    for (const row of data.filter(r => r.dir === 's2c')) {
      const packet = server(row); if ('unknown' in packet) continue;
      g.receive(packet);
      if (packet.id === id && ++seen === nth) return packet;
    }
    return undefined;
  };
  it('a lowercase name resolves on the server, which answers with the upper-cased name; the application then goes out with that name', () => {
    const asked = data.filter(r => r.dir === 'c2s' && r.id === GC.GuildRequestDetails).map(client)[0] as { guild: string };
    expect(asked.guild).toBe('winguild'); // what the recording asked: case-insensitive on the server (modGuilds.GuildIndex upper-cases both sides)
    const g = new GuildState(); feed(g, GS.GuildDetails);
    expect(g.details).toMatchObject({ name: 'WINGUILD', founder: 'Wintest', memberCount: 1, alignment: 'Neutral' });
    g.startApplication();
    expect(g.sendApplication('Quiero entrar, ya\nchau')).toEqual({ id: GC.GuildRequestMembership, guild: 'WINGUILD', application: 'Quiero entrar; yaºchau' });
  });
});

describe('recorded guild lifecycle: accept, member news, kick', () => {
  it('accepting asks for the panel again; the new member is listed, and the applicant gets the member news', () => {
    const leader = rows('guild-accept-leader'), applicant = rows('guild-accept-applicant');
    const g = new GuildState();
    for (const row of leader.filter(r => r.dir === 's2c')) { const packet = server(row); if (!('unknown' in packet)) g.receive(packet); if (packet.id === GS.GuildLeaderInfo && g.leader?.members.length === 2) break; }
    expect(g.leader?.members).toEqual(['Wintest', 'Windowsapp']); expect(g.leader?.joinRequests).toEqual([]);
    const accepts = leader.filter(r => r.dir === 'c2s' && r.id === GC.GuildAcceptNewMember).map(client);
    expect(accepts).toHaveLength(1);
    const member = new GuildState();
    for (const row of applicant.filter(r => r.dir === 's2c')) { const packet = server(row); if (!('unknown' in packet)) member.receive(packet); }
    expect(member.news).toMatchObject({ members: ['Wintest', 'Windowsapp'], level: 1, exp: 0, expNeeded: 750 });
    expect(member.news?.news).toContain('WinGuild');
    expect(member.details?.memberCount).toBe(2);
    // Kick: the recorded c2s 32 is GuildKickMember with the member's name, and the refreshed panel no longer lists her.
    const kicks = leader.filter(r => r.dir === 'c2s' && r.id === GC.GuildKickMember).map(client);
    expect(kicks).toEqual([{ id: GC.GuildKickMember, userName: 'Windowsapp' }]);
    const after = new GuildState(); let panels = 0;
    for (const row of leader.filter(r => r.dir === 's2c')) { const packet = server(row); if (!('unknown' in packet)) after.receive(packet); if (packet.id === GS.GuildLeaderInfo) panels++; }
    expect(panels).toBeGreaterThanOrEqual(3);
    expect(after.leader?.members).toEqual(['Wintest']);
  });
});

/**
 * tools/real-server/record-guild-leader-lists.mjs, 21 Nov 2026: the leader-only requests frmGuildLeader.frm has handlers for but no control
 * (peace list, alliance list, declare war, election vote) all get one LocaleMsg back, "... desactivadas por el momento" (server Protocol.bas
 * HandleGuildPeacePropList etc., SP_LocalMsg Msg1149-1151 and Msg1172). That is why the pinned client form has no buttons for them.
 */
describe('recorded leader-only requests: clan relations and elections are switched off on the server', () => {
  const data = rows('guild-leader-relations-disabled');
  const sent = data.filter(r => r.dir === 'c2s' && r.id !== 305 && r.id !== 73);
  it('sent the four requests and the leader panel request', () => {
    expect(sent.map(r => r.id)).toEqual([GC.RequestGuildLeaderInfo, GC.GuildPeacePropList, GC.GuildAlliancePropList, GC.GuildDeclareWar, GC.GuildVote]);
  });
  it('each of the four is answered by exactly one LocaleMsg and never by a proposal list', () => {
    const after = data.filter(r => r.dir === 's2c');
    expect(after.some(r => r.id === GS.PeaceProposalsList || r.id === GS.AlianceProposalsList)).toBe(false);
    const messages = after.map(server).filter(p => p.id === 141).map(p => (p as { messageId: number }).messageId);
    expect(messages).toEqual(expect.arrayContaining([1150, 1149, 1151, 1172]));
  });
});
