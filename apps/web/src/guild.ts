/*
 * Guild (clan) state, 2026-11-20, from the classic client Protocol.bas (HandleGuildList, HandleGuildNews, HandleGuildLeaderInfo,
 * HandleGuildDetails, HandleCharacterInfo, HandleOfferDetails, Handle*ProposalsList, HandleShowFundarClanForm, HandleGuildConfig,
 * HandlePosLLamadaDeClan) and the forms frmGuildAdm, frmGuildBrief, frmGuildNews, frmGuildLeader, frmSolicitud, frmCharInfo,
 * frmGuildDetails, frmCommet, frmPeaceProp, frmGuildURL, frmUserRequest. AGPL-3.0-or-later; no warranty. See NOTICE.
 */
import { GuildClientPacketId as GC, GuildServerPacketId as GS, guildEntryAlignment, guildEntryName, splitList } from '@ao/protocol';
import type { ClientPacket, ServerPacket } from '@ao/protocol';

/** Declares.bas eClanType, in the order of frmGuildDetails.Combo1 (the .frx items). */
export const CLAN_ALIGNMENTS = ['Neutral (Ciudadanos y criminales)', 'Armada Real', 'Legión Oscura', 'Ciudadano(Ciudadanos y Armada)', 'Criminal (Criminales y Legión oscura)'] as const;
/** frmGuildList.cmbAlignment: eClanType 0..4 then "Todos" (index 5), from Languages/1.json. */
export const ALIGNMENT_FILTER = ['Neutral', 'Armada Real', 'Legión Oscura', 'Ciudadano', 'Criminal', 'Todos'] as const;
/** General.bas ListaRazas / ListaClases, Languages/1.json. */
export const RACES = ['', 'Humano', 'Elfo', 'Elfo Oscuro', 'Gnomo', 'Enano', 'Orco'] as const;
export const CLASSES = ['', 'Mago', 'Clérigo', 'Guerrero', 'Asesino', 'Bardo', 'Druida', 'Paladín', 'Cazador', 'Trabajador', 'Pirata', 'Ladrón', 'Bandido'] as const;
export const MSG_MAX_LEVEL = '¡Nivel Máximo!';
/** Protocol.bas replaces the vbCrLf of multi-line boxes with this character (º) before sending text and back when showing it. */
export const LINE_MARK = 'º';

export interface GuildConfigData { levelCallSupport: number; levelSeeInvisible: number; levelSafe: number; levelShowHpBar: number; maxLevel: number; membersByLevel: number[] }
export interface GuildListEntry { name: string; alignment: number }
export interface GuildDetailsData { name: string; founder: string; creationDate: string; leader: string; memberCount: number; alignment: string; description: string; level: number }
export interface GuildNewsData { news: string; guilds: string[]; members: string[]; level: number; exp: number; expNeeded: number }
export interface GuildLeaderData { guilds: string[]; members: string[]; news: string; joinRequests: string[]; level: number; exp: number; expNeeded: number }
export interface CharInfoData {
  /** frmCharInfo.frmType: who opened it, which decides the buttons (members: Echar; requests: Aceptar/Rechazar/Peticion). */
  mode: 'members' | 'requests';
  gender: number; name: string; race: number; characterClass: number; level: number; gold: number; bank: number;
  previousPetitions: string; currentGuild: string; previousGuilds: string; royalArmy: boolean; chaosLegion: boolean; citizensKilled: number; criminalsKilled: number;
}
export type ProposalKind = 'alliance' | 'peace';
/** Which comment box (frmCommet.t) is open and for whom. */
export interface CommentBox { kind: 'alliance' | 'peace' | 'reject'; target: string }

/** ClanNivel benefits text of frmGuildNews / frmGuildLeader. */
export function guildBenefits(level: number, config: GuildConfigData | undefined, separator: '\n' | ' / '): string {
  const parts: string[] = [];
  if (config) {
    if (level >= config.levelCallSupport) parts.push('Pedir ayuda (G)');
    if (level >= config.levelSafe) parts.push('Seguro de clan');
    if (level >= config.levelShowHpBar) parts.push('Ver vida y mana');
    if (level >= config.levelSeeInvisible) parts.push('Verse invisible');
  }
  const members = `Max miembros: ${config?.membersByLevel[level - 1] ?? ''}`;
  // frmGuildNews lists the benefits first and the member cap last; frmGuildLeader puts the cap first.
  return separator === '\n' ? [...parts, members].join(separator) : [members, ...parts].join(separator);
}
/** The XP bar of both guild panels: filled fraction and the two captions (percent / count), or the max-level text. */
export function guildProgress(exp: number, needed: number): { fraction: number; percent: string; count: string } {
  if (needed > 0) return { fraction: Math.min(1, exp / needed), percent: `${Math.round(exp * 100 / needed)}%`, count: `${exp}/${needed}` };
  return { fraction: 1, percent: MSG_MAX_LEVEL, count: MSG_MAX_LEVEL };
}

/** AsciiValidos: letters a-z (case-folded), space and ÿ only. */
export const asciiValidName = (text: string) => [...text.toLowerCase()].every(ch => { const c = ch.charCodeAt(0); return (c >= 97 && c <= 122) || c === 32 || c === 255; });
/** ValidDescriptionCharacters: printable Latin-1 only. */
export const validDescription = (text: string) => [...text].every(ch => { const c = ch.charCodeAt(0); return !((c < 32 || c >= 127) && c < 160); });

export class GuildState {
  revision = 0;
  config: GuildConfigData | undefined;
  /** ClanesList / ListaClanes of the last GuildList (kept so the filter can run without the server). */
  clans: GuildListEntry[] = [];
  /** Open windows and their data. Each is undefined while its form is not shown. */
  list: { open: true } | undefined;
  details: GuildDetailsData | undefined;
  /** frmGuildBrief.EsLeader, set by the form that asked for the details. */
  detailsFromLeader = false;
  application: string | undefined;
  news: GuildNewsData | undefined;
  leader: GuildLeaderData | undefined;
  charInfo: CharInfoData | undefined;
  offer: string | undefined;
  proposals: { kind: ProposalKind; guilds: string[] } | undefined;
  founding: { creating: boolean } | undefined;
  comment: CommentBox | undefined;
  urlBox = false;
  /** HandlePosLLamadaDeClan: where a guild member called for help. */
  call: { map: number; x: number; y: number } | undefined;
  /** What the next CharacterInfo is for (frmCharInfo.frmType is set before WriteGuildMemberInfo / WriteGuildRequestJoinerInfo). */
  private nextCharInfo: CharInfoData['mode'] = 'members';

  receive(packet: ServerPacket): void {
    switch (packet.id) {
      case GS.GuildConfig: this.config = { ...packet }; break;
      case GS.GuildList:
        this.clans = splitList(packet.guilds).map(entry => ({ name: guildEntryName(entry), alignment: guildEntryAlignment(entry) }));
        this.list = { open: true }; break;
      case GS.GuildNews:
        this.news = { news: packet.news, guilds: splitList(packet.guilds).map(guildEntryName), members: splitList(packet.members), level: packet.level, exp: packet.exp, expNeeded: packet.expNeeded };
        break;
      case GS.GuildLeaderInfo:
        this.leader = { guilds: splitList(packet.guilds).map(guildEntryName), members: splitList(packet.members), news: packet.news, joinRequests: splitList(packet.joinRequests), level: packet.level, exp: packet.exp, expNeeded: packet.expNeeded };
        break;
      case GS.GuildDetails: this.details = { ...packet }; break;
      case GS.CharacterInfo: this.charInfo = { mode: this.nextCharInfo, ...packet }; break;
      case GS.OfferDetails: this.offer = packet.details; break;
      case GS.AlianceProposalsList: this.proposals = { kind: 'alliance', guilds: splitList(packet.guilds) }; break;
      case GS.PeaceProposalsList: this.proposals = { kind: 'peace', guilds: splitList(packet.guilds) }; break;
      case GS.ShowGuildFundationForm: this.founding = { creating: true }; break;
      case GS.ShowFundarClanForm: this.founding = { creating: true }; break;
      case GS.PosLLamadaDeClan: this.call = { map: packet.map, x: packet.x, y: packet.y }; break;
      default: return;
    }
    this.revision++;
  }
  private bump() { this.revision++; }

  /** frmGuildList.cmdBuscar_Click: filter by alignment (index 5 = all) and by upper-cased name fragment. */
  filtered(alignment: number, text: string): string[] {
    const fragment = text.toUpperCase();
    return this.clans.filter(clan => (alignment >= 5 || clan.alignment === alignment) && (fragment === '' || clan.name.toUpperCase().includes(fragment))).map(clan => clan.name);
  }

  // ---- Closing ----
  closeList() { this.list = undefined; this.bump(); }
  closeDetails() { this.details = undefined; this.application = undefined; this.bump(); }
  closeNews() { this.news = undefined; this.bump(); }
  closeLeader() { this.leader = undefined; this.bump(); }
  closeCharInfo() { this.charInfo = undefined; this.comment = this.comment?.kind === 'reject' ? undefined : this.comment; this.bump(); }
  closeOffer() { this.offer = undefined; this.bump(); }
  closeProposals() { this.proposals = undefined; this.bump(); }
  closeFounding() { this.founding = undefined; this.bump(); }
  closeComment() { this.comment = undefined; this.bump(); }
  closeUrl() { this.urlBox = false; this.bump(); }
  closeApplication() { this.application = undefined; this.bump(); }
  /** True when any guild form is open (the host closes them all when the map is clicked, like frmMain.renderer_MouseDown). */
  get anyOpen() {
    return !!(this.list || this.details || this.news || this.leader || this.charInfo || this.offer || this.proposals || this.founding || this.comment || this.urlBox || this.application);
  }

  // ---- Actions: each returns the packet to send, or undefined (and says why in `note`) ----
  /** frmMain.clanimg_MouseUp: closes the leader panel, then WriteRequestGuildLeaderInfo. The reply picks the window. */
  openGuildPanel(): ClientPacket { this.leader = undefined; this.bump(); return { id: GC.RequestGuildLeaderInfo }; }
  /** frmGuildList.Image3_Click / frmGuildNews.cmdDetalles_Click / frmGuildLeader dblclick: ask for another guild's brief. */
  requestDetails(name: string, fromLeader: boolean): ClientPacket | undefined {
    if (name === '') return undefined; // "un guild con nombre vacío": do nothing
    this.detailsFromLeader = fromLeader;
    return { id: GC.GuildRequestDetails, guild: name };
  }
  /** frmGuildBrief.cmdSolicitarIngreso_Click: opens frmSolicitud for this guild. */
  startApplication(): void { if (this.details) { this.application = this.details.name; this.bump(); } }
  /** frmSolicitud.cmdEnviarSolicitud_Click: "," becomes ";" and line breaks become "º". */
  sendApplication(text: string): ClientPacket | undefined {
    if (this.application === undefined) return undefined;
    const guild = this.application;
    this.application = undefined; this.bump();
    return { id: GC.GuildRequestMembership, guild, application: text.replaceAll(',', ';').replace(/\r?\n/g, LINE_MARK) };
  }
  /** frmGuildList.cmdFundarClan_Click (the dead check is the caller's). */
  requestFounding(): ClientPacket { return { id: GC.QuieroFundarClan }; }
  /** frmGuildDetails.cmdFundar_Click while CreandoClan. Returns the warning text when the input is refused. */
  found(name: string, description: string, alignment: number): { packet?: ClientPacket; warning?: string } {
    if (name === '') return { warning: 'Debes ingresar un nombre para el clan.' };
    if (name.length > 30) return { warning: 'El nombre del clan es demasiado extenso.' };
    if (!asciiValidName(name)) return { warning: 'El nombre del clan contiene caracteres inválidos.' };
    if (alignment < 0 || alignment > 4) return { warning: 'Debes definir el alineamiento del clan.' };
    const creating = this.founding?.creating ?? true;
    this.founding = undefined; this.bump();
    const text = description.replace(/\r?\n/g, LINE_MARK);
    return { packet: creating ? { id: GC.CreateNewGuild, description: text, name, alignment } : { id: GC.ClanCodexUpdate, description: text } };
  }
  /** frmGuildLeader.cmdActualizar_Click. */
  updateNews(text: string): ClientPacket { return { id: GC.GuildUpdateNews, news: text.replace(/\r?\n/g, LINE_MARK) }; }
  /** frmGuildLeader.cmdEditarDescripcion_Click: refuses non-printable characters. */
  editDescription(text: string): { packet?: ClientPacket; warning?: string } {
    const description = text.replace(/\r?\n/g, LINE_MARK);
    return validDescription(description) ? { packet: { id: GC.ClanCodexUpdate, description } } : { warning: 'La descripción contiene caracteres inválidos' };
  }
  /** frmGuildLeader members/requests list double click: frmType first, then WriteGuildMemberInfo. */
  memberInfo(name: string, mode: CharInfoData['mode']): ClientPacket | undefined {
    if (name === '') return undefined;
    this.nextCharInfo = mode; return { id: GC.GuildMemberInfo, userName: name };
  }
  /** frmCharInfo desc button (Peticion). */
  joinerInfo(): ClientPacket | undefined { return this.charInfo ? { id: GC.GuildRequestJoinerInfo, userName: this.charInfo.name } : undefined; }
  /** frmCharInfo Aceptar / Echar: acts on the shown character, then asks the leader panel again. */
  acceptMember(): ClientPacket[] { return this.charInfo ? this.thenRefresh({ id: GC.GuildAcceptNewMember, userName: this.charInfo.name }) : []; }
  kickMember(): ClientPacket[] { return this.charInfo ? this.thenRefresh({ id: GC.GuildKickMember, userName: this.charInfo.name }) : []; }
  private thenRefresh(first: ClientPacket): ClientPacket[] { this.leader = undefined; this.charInfo = undefined; this.bump(); return [first, { id: GC.RequestGuildLeaderInfo }]; }
  /** frmCharInfo Rechazar: the reason box (frmCommet RECHAZOPJ). */
  startReject(): void { if (this.charInfo) { this.comment = { kind: 'reject', target: this.charInfo.name }; this.bump(); } }
  /** frmGuildBrief.Guerra_Click / frmCommet openers. */
  declareWar(): ClientPacket | undefined { if (!this.details) return undefined; const guild = this.details.name; this.closeDetails(); return { id: GC.GuildDeclareWar, guild }; }
  startOffer(kind: ProposalKind): void { if (this.details) { this.comment = { kind, target: this.details.name }; this.bump(); } }
  /** frmCommet.Command1_Click: "ºnn" line marks; the reject reason loses its commas and line breaks. Empty text is refused with the VB6 message. */
  sendComment(text: string): { packet?: ClientPacket; warning?: string } {
    const box = this.comment;
    if (!box) return {};
    if (text === '') {
      return { warning: box.kind === 'reject' ? `Debes indicar el motivo por el cual rechazas la membresía de ${box.target}` : `Debes redactar un mensaje solicitando la paz o alianza al líder de ${box.target}` };
    }
    this.comment = undefined;
    if (box.kind === 'reject') {
      this.charInfo = undefined;
      if (this.leader) this.leader = { ...this.leader, joinRequests: this.leader.joinRequests.filter(name => name !== box.target) };
      this.bump();
      return { packet: { id: GC.GuildRejectNewMember, userName: box.target, reason: text.replaceAll(',', ' ').replace(/\r?\n/g, ' ') } };
    }
    this.bump();
    const proposal = text.replace(/\r?\n/g, LINE_MARK);
    return { packet: box.kind === 'peace' ? { id: GC.GuildOfferPeace, guild: box.target, proposal } : { id: GC.GuildOfferAlliance, guild: box.target, proposal } };
  }
  /** frmPeaceProp buttons act on the selected entry. */
  proposalDetails(entry: string): ClientPacket | undefined {
    if (!this.proposals || entry === '') return undefined;
    return this.proposals.kind === 'peace' ? { id: GC.GuildPeaceDetails, guild: entry } : { id: GC.GuildAllianceDetails, guild: entry };
  }
  proposalAnswer(entry: string, accept: boolean): ClientPacket | undefined {
    if (!this.proposals || entry === '') return undefined;
    const peace = this.proposals.kind === 'peace';
    this.proposals = undefined; this.bump();
    if (accept) return peace ? { id: GC.GuildAcceptPeace, guild: entry } : { id: GC.GuildAcceptAlliance, guild: entry };
    return peace ? { id: GC.GuildRejectPeace, guild: entry } : { id: GC.GuildRejectAlliance, guild: entry };
  }
  /** frmGuildURL.Command1_Click: empty text sends nothing. */
  sendUrl(text: string): ClientPacket | undefined { this.urlBox = false; this.bump(); return text === '' ? undefined : { id: GC.GuildNewWebsite, url: text }; }
  openElections(): ClientPacket { this.leader = undefined; this.bump(); return { id: GC.GuildOpenElections }; }
}
