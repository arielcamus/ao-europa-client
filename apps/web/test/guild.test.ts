import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GuildClientPacketId as GC, GuildServerPacketId as GS, joinList, decodeServerPacket, decodeClientPacket } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { ALIGNMENT_FILTER, CLAN_ALIGNMENTS, GuildState, asciiValidName, guildBenefits, guildProgress, validDescription } from '../src/guild.js';

const config: ServerPacket = { id: GS.GuildConfig, levelCallSupport: 3, levelSeeInvisible: 6, levelSafe: 4, levelShowHpBar: 5, maxLevel: 4, membersByLevel: [3, 4, 5, 8] };
const list = (...entries: string[]): ServerPacket => ({ id: GS.GuildList, guilds: joinList(entries) });
const details = (over: Partial<Extract<ServerPacket, { id: GS.GuildDetails }>> = {}): ServerPacket => ({
  id: GS.GuildDetails, name: 'Los Pibes', founder: 'Ana', creationDate: '01/02/2026', leader: 'Bob', memberCount: 7, alignment: 'Neutral', description: 'Hola', level: 2, ...over,
});
const charInfo = (over: Record<string, unknown> = {}): ServerPacket => ({
  id: GS.CharacterInfo, gender: 1, name: 'Cleo', race: 2, characterClass: 3, level: 12, gold: 100, bank: 200, previousPetitions: 'p', currentGuild: 'G', previousGuilds: 'q',
  royalArmy: false, chaosLegion: false, citizensKilled: 1, criminalsKilled: 2, ...over,
} as ServerPacket);

describe('GuildState lists and views', () => {
  it('parses the NUL separated "name-alignment" list and filters it like frmGuildList.cmdBuscar', () => {
    const g = new GuildState();
    g.receive(list('Los Pibes-0', 'Armada Alpha-1', 'Caos Beta-2', 'Pibes Dos-0'));
    expect(g.list).toBeDefined();
    expect(g.filtered(5, '')).toEqual(['Los Pibes', 'Armada Alpha', 'Caos Beta', 'Pibes Dos']);
    expect(g.filtered(0, '')).toEqual(['Los Pibes', 'Pibes Dos']);
    expect(g.filtered(5, 'pibes')).toEqual(['Los Pibes', 'Pibes Dos']);
    expect(g.filtered(2, 'pibes')).toEqual([]);
    g.receive(list()); expect(g.clans).toEqual([]); expect(g.list).toBeDefined(); // an empty list still opens the window
    expect(ALIGNMENT_FILTER).toHaveLength(6); expect(CLAN_ALIGNMENTS).toHaveLength(5);
  });
  it('keeps the guild config and renders the benefits of frmGuildNews (cap last) and frmGuildLeader (cap first)', () => {
    const g = new GuildState(); g.receive(config);
    expect(g.config?.membersByLevel).toEqual([3, 4, 5, 8]);
    expect(guildBenefits(1, g.config, '\n')).toBe('Max miembros: 3');
    expect(guildBenefits(4, g.config, '\n')).toBe('Pedir ayuda (G)\nSeguro de clan\nMax miembros: 8');
    expect(guildBenefits(4, g.config, ' / ')).toBe('Max miembros: 8 / Pedir ayuda (G) / Seguro de clan');
  });
  it('shows the XP bar as a fraction and percent, or the max-level text when nothing more is needed', () => {
    expect(guildProgress(100, 400)).toEqual({ fraction: 0.25, percent: '25%', count: '100/400' });
    expect(guildProgress(5, 0)).toEqual({ fraction: 1, percent: '¡Nivel Máximo!', count: '¡Nivel Máximo!' });
  });
  it('splits the news and leader lists, ignoring the alignment part of the allied-guild entries', () => {
    const g = new GuildState();
    g.receive({ id: GS.GuildNews, news: 'º', guilds: joinList(['Aliados-1', 'Otros-0']), members: joinList(['Ana', 'Bob']), level: 2, exp: 10, expNeeded: 20 });
    expect(g.news).toEqual({ news: 'º', guilds: ['Aliados', 'Otros'], members: ['Ana', 'Bob'], level: 2, exp: 10, expNeeded: 20 });
    g.receive({ id: GS.GuildLeaderInfo, guilds: '', members: joinList(['Ana']), news: 'n', joinRequests: joinList(['Zed', 'Yan']), level: 1, exp: 0, expNeeded: 5 });
    expect(g.leader).toMatchObject({ guilds: [], members: ['Ana'], joinRequests: ['Zed', 'Yan'] });
  });
});

describe('GuildState actions', () => {
  it('asks for another guild\'s brief, remembers who asked, and ignores an empty name', () => {
    const g = new GuildState();
    expect(g.requestDetails('', false)).toBeUndefined();
    expect(g.requestDetails('Los Pibes', true)).toEqual({ id: GC.GuildRequestDetails, guild: 'Los Pibes' }); expect(g.detailsFromLeader).toBe(true);
    g.receive(details()); expect(g.details?.name).toBe('Los Pibes');
  });
  it('sends a membership application with "," turned into ";" and line breaks into "º" (frmSolicitud)', () => {
    const g = new GuildState(); g.receive(details());
    expect(g.sendApplication('x')).toBeUndefined(); // nothing is being written
    g.startApplication(); expect(g.application).toBe('Los Pibes');
    expect(g.sendApplication('Hola, quiero entrar\nSoy Bob')).toEqual({ id: GC.GuildRequestMembership, guild: 'Los Pibes', application: 'Hola; quiero entrar' + 'º' + 'Soy Bob' });
    expect(g.application).toBeUndefined();
  });
  it('founding: validates the name like AsciiValidos and sends CreateNewGuild with the aligned index', () => {
    const g = new GuildState(); g.receive({ id: GS.ShowFundarClanForm });
    expect(g.founding?.creating).toBe(true);
    expect(g.found('', 'd', 1).warning).toBeDefined();
    expect(g.found('x'.repeat(31), 'd', 1).warning).toBeDefined();
    expect(g.found('Clan 1', 'd', 1).warning).toBeDefined(); // digits are not valid
    expect(g.found('Clan', 'd', -1).warning).toBeDefined(); // no alignment chosen
    expect(g.founding).toBeDefined(); // still open after a refusal
    expect(g.found('Los Pibes', 'una\ndos', 3).packet).toEqual({ id: GC.CreateNewGuild, description: 'unaºdos', name: 'Los Pibes', alignment: 3 });
    expect(g.founding).toBeUndefined();
    expect(asciiValidName('Ñandú')).toBe(false); expect(asciiValidName('a b')).toBe(true);
  });
  it('edits the description only with printable characters (frmGuildLeader.cmdEditarDescripcion)', () => {
    const g = new GuildState();
    expect(g.editDescription('hola\nmundo').packet).toEqual({ id: GC.ClanCodexUpdate, description: 'holaºmundo' });
    expect(g.editDescription('mal\u0001').warning).toBe('La descripción contiene caracteres inválidos');
    expect(validDescription('ñ ú')).toBe(true);
  });
  it('the leader panel: member and applicant info, accept/kick then ask for the panel again, reject with a reason', () => {
    const g = new GuildState();
    g.receive({ id: GS.GuildLeaderInfo, guilds: '', members: joinList(['Ana', 'Bob']), news: '', joinRequests: joinList(['Cleo', 'Dan']), level: 1, exp: 0, expNeeded: 5 });
    expect(g.memberInfo('', 'members')).toBeUndefined();
    expect(g.memberInfo('Cleo', 'requests')).toEqual({ id: GC.GuildMemberInfo, userName: 'Cleo' });
    g.receive(charInfo()); expect(g.charInfo?.mode).toBe('requests');
    expect(g.joinerInfo()).toEqual({ id: GC.GuildRequestJoinerInfo, userName: 'Cleo' });
    g.startReject(); expect(g.comment).toEqual({ kind: 'reject', target: 'Cleo' });
    expect(g.sendComment('').warning).toMatch(/Cleo/); expect(g.comment).toBeDefined();
    expect(g.sendComment('no, gracias\nchau').packet).toEqual({ id: GC.GuildRejectNewMember, userName: 'Cleo', reason: 'no  gracias chau' });
    expect(g.charInfo).toBeUndefined(); expect(g.leader?.joinRequests).toEqual(['Dan']);
    g.receive(charInfo({ name: 'Dan' })); expect(g.charInfo?.mode).toBe('requests');
    expect(g.acceptMember()).toEqual([{ id: GC.GuildAcceptNewMember, userName: 'Dan' }, { id: GC.RequestGuildLeaderInfo }]);
    expect(g.leader).toBeUndefined(); // closed until the answer arrives
    g.memberInfo('Ana', 'members'); g.receive(charInfo({ name: 'Ana' })); expect(g.charInfo?.mode).toBe('members');
    expect(g.kickMember()).toEqual([{ id: GC.GuildKickMember, userName: 'Ana' }, { id: GC.RequestGuildLeaderInfo }]);
  });
  it('proposals (frmPeaceProp) and offers (frmCommet): alliance and peace use their own packets', () => {
    const g = new GuildState(); g.receive(details());
    g.receive({ id: GS.PeaceProposalsList, guilds: joinList(['A', 'B']) });
    expect(g.proposals).toEqual({ kind: 'peace', guilds: ['A', 'B'] });
    expect(g.proposalDetails('A')).toEqual({ id: GC.GuildPeaceDetails, guild: 'A' });
    expect(g.proposalAnswer('', true)).toBeUndefined();
    expect(g.proposalAnswer('B', false)).toEqual({ id: GC.GuildRejectPeace, guild: 'B' }); expect(g.proposals).toBeUndefined();
    g.receive({ id: GS.AlianceProposalsList, guilds: 'C' });
    expect(g.proposalAnswer('C', true)).toEqual({ id: GC.GuildAcceptAlliance, guild: 'C' });
    g.startOffer('alliance'); expect(g.comment).toEqual({ kind: 'alliance', target: 'Los Pibes' });
    expect(g.sendComment('juntos\nsiempre').packet).toEqual({ id: GC.GuildOfferAlliance, guild: 'Los Pibes', proposal: 'juntosºsiempre' });
    g.startOffer('peace'); expect(g.sendComment('paz').packet).toEqual({ id: GC.GuildOfferPeace, guild: 'Los Pibes', proposal: 'paz' });
    expect(g.declareWar()).toEqual({ id: GC.GuildDeclareWar, guild: 'Los Pibes' }); expect(g.details).toBeUndefined();
    g.receive({ id: GS.OfferDetails, details: 'texto' }); expect(g.offer).toBe('texto');
    expect(g.sendUrl('')).toBeUndefined(); expect(g.sendUrl('http://x')).toEqual({ id: GC.GuildNewWebsite, url: 'http://x' });
  });
  it('the Clanes button asks for the panel; the reply decides the form, and anyOpen tracks them', () => {
    const g = new GuildState();
    expect(g.anyOpen).toBe(false);
    expect(g.openGuildPanel()).toEqual({ id: GC.RequestGuildLeaderInfo });
    g.receive(list('A-0')); expect(g.anyOpen).toBe(true);
    g.closeList(); expect(g.anyOpen).toBe(false);
    g.receive({ id: GS.PosLLamadaDeClan, map: 1, x: 5, y: 6 }); expect(g.call).toEqual({ map: 1, x: 5, y: 6 });
  });
});

describe('recorded VB6 guild session', () => {
  const rows = JSON.parse(`[${readFileSync(new URL('../../../tests/fixtures/vb6/party/guild-without-guild.jsonl', import.meta.url), 'utf8').trim().split('\n').join(',')}]`) as { dir: string; id: number; hex: string }[];
  it('a level-1 character without a guild gets an empty guild list and only refusals for the rest', () => {
    const g = new GuildState();
    for (const row of rows.filter(r => r.dir === 's2c')) {
      const packet = decodeServerPacket(Uint8Array.from(Buffer.from(row.hex, 'hex')));
      if (!('unknown' in packet)) g.receive(packet);
    }
    expect(g.config?.maxLevel).toBe(g.config?.membersByLevel.length);
    expect(g.clans).toEqual([]); expect(g.list).toBeDefined();
    expect(g.news).toBeUndefined(); expect(g.leader).toBeUndefined(); expect(g.founding).toBeUndefined();
  });
  it('the requests of the recording decode with the guild codecs', () => {
    const ids = rows.filter(r => r.dir === 'c2s' && r.id !== 305).map(r => (decodeClientPacket(Uint8Array.from(Buffer.from(r.hex, 'hex'))) as { id: number }).id);
    expect(ids).toEqual(expect.arrayContaining([GC.RequestGuildLeaderInfo, GC.QuieroFundarClan, GC.GuildRequestDetails, GC.GuildRequestMembership, GC.GuildLeave, GC.GuildMemberInfo, GC.GuildAlliancePropList, GC.GuildPeacePropList]));
  });
});
