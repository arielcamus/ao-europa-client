/*
 * Guild DOM layer: frmGuildAdm (list), frmGuildBrief, frmSolicitud, frmGuildNews, frmGuildLeader, frmCharInfo, frmGuildDetails (founding),
 * frmCommet, frmPeaceProp, frmGuildURL and frmUserRequest. Positions are the .frm values / 15.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE. Art is read only from the local mount.
 */
import type { ClientPacket } from '@ao/protocol';
import { ALIGNMENT_FILTER, CLAN_ALIGNMENTS, CLASSES, LINE_MARK, RACES, guildBenefits, guildProgress } from './guild.js';
import type { GuildState } from './guild.js';
import type { Session } from './session.js';
import { VbWindow, combo } from './vb-window.js';
import type { VbList, WindowOptions } from './vb-window.js';
import { loadInterface } from './interface-assets.js';

/** FontTypeNames.FONTTYPE_INFO: the console colour for local warnings. */
const FONT_INFO = 3;
const lines = (text: string) => text.replaceAll(LINE_MARK, '\n');
const set = (el: HTMLElement, text: string) => { if (el.textContent !== text) el.textContent = text; };

interface Shown { win: VbWindow; refresh(session: Session): void }

export class GuildUI {
  private readonly shown = new Map<string, Shown>();
  private revision = -1;
  private session: Session | undefined;
  private listClans: unknown;

  /** `send` takes the packets of one user action, in order. */
  constructor(private readonly classic: HTMLElement, private readonly send: (...packets: (ClientPacket | undefined)[]) => void) {}

  update(session: Session | undefined) {
    if (session !== this.session) { this.session = session; this.revision = -1; for (const { win } of [...this.shown.values()]) win.close(); this.shown.clear(); }
    if (!session) return;
    const guild = session.guild;
    if (guild.revision === this.revision) return;
    this.revision = guild.revision;
    this.sync('list', !!guild.list, session, () => this.buildList(session));
    this.sync('brief', !!guild.details, session, () => this.buildBrief(session));
    this.sync('application', guild.application !== undefined, session, () => this.buildApplication(session));
    this.sync('news', !!guild.news, session, () => this.buildNews(session));
    this.sync('leader', !!guild.leader, session, () => this.buildLeader(session));
    this.sync('charinfo', !!guild.charInfo, session, () => this.buildCharInfo(session));
    this.sync('offer', guild.offer !== undefined, session, () => this.buildOffer(session));
    this.sync('proposals', !!guild.proposals, session, () => this.buildProposals(session));
    this.sync('founding', !!guild.founding, session, () => this.buildFounding(session));
    this.sync('comment', !!guild.comment, session, () => this.buildComment(session));
    this.sync('url', guild.urlBox, session, () => this.buildUrl(session));
  }
  private sync(key: string, wanted: boolean, session: Session, build: () => Shown) {
    const current = this.shown.get(key);
    if (!wanted) { if (current) { this.shown.delete(key); current.win.close(); } return; }
    if (current && !current.win.isOpen) this.shown.delete(key);
    let entry = this.shown.get(key);
    if (!entry) { entry = build(); this.shown.set(key, entry); }
    entry.refresh(session);
  }
  private open(key: string, options: Omit<WindowOptions, 'onClose'>, session: Session, closeState: (guild: GuildState) => void): VbWindow {
    const win: VbWindow = new VbWindow(this.classic, { ...options, onClose: () => { if (this.shown.get(key)?.win === win) this.shown.delete(key); closeState(session.guild); } });
    return win;
  }
  private warn(session: Session, text: string) { session.ui.message(text, FONT_INFO); }
  /** frmMain.renderer_MouseDown unloads frmGuildList (only). */
  closeOnMapClick() { this.shown.get('list')?.win.close(); }
  get anyOpen() { return [...this.shown.values()].some(entry => entry.win.isOpen); }

  // ---- frmGuildAdm: registered guilds ----
  private buildList(session: Session): Shown {
    const guild = session.guild;
    const win = this.open('list', { id: 'frm-guild-list', art: 'ventanaclanes', size: [415, 389], title: 'Lista de clanes registrados' }, session, g => g.closeList());
    const filter = win.input([36.3, 107.7, 105, 17], { maxLength: 30 }) as HTMLInputElement;
    const alignment = win.add(combo(ALIGNMENT_FILTER, 5), [152, 106.7, 110.3, 19]);
    const clans = win.list([33, 144, 272, 171]);
    const search = () => clans.set(guild.filtered(alignment.selectedIndex, filter.value));
    win.button('boton-buscar', [267, 104, 30, 28.3], 'Buscar', search);
    win.closeButton([384, 0, 28, 28]);
    // Image3: transparent hotspot on the bitmap that asks for the selected guild's details.
    const details = () => { const packet = guild.requestDetails(clans.value, false); if (packet) this.send(packet); };
    const hotspot = win.add(document.createElement('button'), [310, 282, 26, 28]); hotspot.type = 'button'; hotspot.className = 'vb-hotspot'; hotspot.title = 'Detalles'; hotspot.setAttribute('aria-label', 'Detalles'); hotspot.onclick = details;
    clans.onDoubleClick = details;
    win.button('boton-fundar-clan', [144, 336, 130, 28], 'Fundar clan', () => {
      if (session.dead) { this.warn(session, '¡¡Estás muerto!!'); return; } // cmdFundarClan_Click
      this.send(guild.requestFounding());
    });
    return { win, refresh: () => { if (this.listClans !== guild.clans) { this.listClans = guild.clans; alignment.selectedIndex = 5; filter.value = ''; clans.set(guild.filtered(5, '')); } } };
  }

  // ---- frmGuildBrief: another guild's details ----
  private buildBrief(session: Session): Shown {
    const guild = session.guild;
    const win = this.open('brief', { id: 'frm-guild-brief', art: 'ventanaclanes_detalles', size: [300, 295], title: 'Detalles del clan' }, session, g => g.closeDetails());
    const fields = {
      name: win.label('', [8, 18, 283, 13], 'vb-center vb-bold'), founder: win.label('', [56, 69.3, 51, 13]), creation: win.label('', [173, 70.3, 93, 13]),
      leader: win.label('', [67, 109.3, 29, 13]), members: win.label('', [194, 109.3, 51, 13]), alignment: win.label('', [55, 149.3, 53, 13]), level: win.label('', [187, 149.3, 65, 13]),
    };
    const description = win.input([43.3, 186.7, 213.3, 50], { multiline: true, readOnly: true });
    win.button('boton-solicitaringreso', [42, 248, 185, 25], 'Solicitar ingreso', () => guild.startApplication());
    win.closeButton([268.3, 0, 25, 25]);
    return { win, refresh: () => {
      const d = guild.details; if (!d) return;
      set(fields.name, d.name); set(fields.founder, d.founder); set(fields.creation, d.creationDate);
      set(fields.leader, d.founder); // HandleGuildDetails shows the founder as the leader ("Provisoriamente")
      set(fields.members, String(d.memberCount)); set(fields.alignment, d.alignment); set(fields.level, String(d.level));
      description.value = lines(d.description);
    } };
  }

  // ---- frmSolicitud: membership application ----
  private buildApplication(session: Session): Shown {
    const guild = session.guild;
    const win = this.open('application', { id: 'frm-guild-sol', art: 'ventanaclanes_solicitud_ingreso', size: [313, 229], title: 'Solicitud de ingreso' }, session, g => g.closeApplication());
    const text = win.input([18.7, 100, 273, 81], { multiline: true, maxLength: 400 }) as HTMLTextAreaElement;
    win.button('boton-enviarsolicitud', [46.7, 186.7, 241, 25], 'Enviar solicitud', () => this.send(guild.sendApplication(text.value)));
    win.closeButton([281, 0, 25, 25]);
    text.focus();
    return { win, refresh: () => undefined };
  }

  // ---- frmGuildNews: a member's view of its own guild ----
  private buildNews(session: Session): Shown {
    const guild = session.guild;
    const win = this.open('news', { id: 'frm-guild-news', art: 'ventanaclanes_noticias', size: [437, 376], title: 'Noticias de clan' }, session, g => g.closeNews());
    const members = win.list([37, 223, 156, 106]), allies = win.list([245.3, 223.3, 155, 93]);
    const news = win.input([246.7, 63.3, 150.7, 129], { multiline: true, readOnly: true });
    const level = win.label('', [163.7, 47.7, 65, 17], 'vb-small'), count = win.label('', [147.7, 208.7, 65, 17], 'vb-small');
    const track = win.add(document.createElement('div'), [32, 72, 161, 17]); track.className = 'vb-shape';
    const bar = win.add(document.createElement('div'), [34, 73, 0, 14]); bar.className = 'vb-expbar';
    const percent = win.label('', [32, 72.7, 161, 17], 'vb-center vb-bold vb-small'), exp = win.label('', [32, 72.7, 161, 17], 'vb-center vb-bold vb-small');
    exp.hidden = true;
    const benefits = win.label('', [32, 112, 161, 81], 'vb-multi');
    // porciento_MouseMove shows the exp count; beneficios_MouseMove shows the percent again.
    percent.style.pointerEvents = 'auto'; percent.addEventListener('mouseenter', () => { percent.hidden = true; exp.hidden = false; });
    exp.style.pointerEvents = 'auto'; exp.addEventListener('mouseleave', () => { percent.hidden = false; exp.hidden = true; });
    win.button('boton-detalles', [256, 326.7, 121, 17], 'Detalles', () => { const packet = guild.requestDetails(allies.value, false); if (packet) this.send(packet); });
    win.closeButton([406, 0.7, 25, 25]);
    return { win, refresh: () => {
      const n = guild.news; if (!n) return;
      news.value = lines(n.news); allies.set(n.guilds);
      members.set(n.members.map((name, i) => (i === 0 ? `${name}(Lider)` : name)));
      set(count, String(n.members.length)); set(level, String(n.level));
      const progress = guildProgress(n.exp, n.expNeeded);
      bar.style.width = `${Math.min(158, Math.round(((n.exp + 1 / 100) / (n.expNeeded + 1 / 100)) * 158))}px`; // EXPBAR.Width = ((expacu + 1/100) / (ExpNe + 1/100)) * 2370 twips
      set(percent, progress.percent); set(exp, progress.count);
      benefits.textContent = guildBenefits(n.level, guild.config, '\n');
    } };
  }

  // ---- frmGuildLeader: the leader's panel ----
  private buildLeader(session: Session): Shown {
    const guild = session.guild;
    const win = this.open('leader', { id: 'frm-guild-leader', art: 'ventanaadminclan', size: [552, 559], title: 'Administración del Clan' }, session, g => g.closeLeader());
    const requests = win.list([279, 106, 249, 67]), allies = win.list([280, 248, 249, 80]), members = win.list([21, 248, 249, 80]);
    const news = win.input([22, 416, 504, 78], { multiline: true }) as HTMLTextAreaElement;
    const level = win.label('', [58, 106, 14, 16], 'vb-small vb-bold'), count = win.label('', [140, 154, 14, 16], 'vb-small vb-bold'), max = win.label('', [235, 154, 14, 16], 'vb-small vb-bold');
    const bar = win.add(document.createElement('div'), [26, 130, 239, 15]); bar.className = 'vb-expbar vb-picture';
    void loadInterface('barra-nivel-clan').then(url => { bar.style.backgroundImage = `url("${url}")`; }).catch(() => undefined);
    const percent = win.label('', [36, 131, 219, 17], 'vb-center vb-bold vb-small'), exp = win.label('', [36, 131, 219, 17], 'vb-center vb-bold vb-small');
    exp.hidden = true;
    percent.style.pointerEvents = 'auto'; percent.addEventListener('mouseenter', () => { percent.hidden = true; exp.hidden = false; });
    exp.style.pointerEvents = 'auto'; exp.addEventListener('mouseleave', () => { percent.hidden = false; exp.hidden = true; });
    const benefits = win.label('', [26, 171, 241, 56], 'vb-multi vb-small');
    requests.onDoubleClick = () => this.send(guild.memberInfo(requests.value, 'requests'));
    members.onDoubleClick = () => this.send(guild.memberInfo(members.value, 'members'));
    allies.onDoubleClick = () => { const packet = guild.requestDetails(allies.value, true); if (packet) this.send(packet); };
    win.button('boton-actualizar', [84, 515, 132, 28], 'Actualizar', () => this.send(guild.updateNews(news.value)));
    win.button('boton-editar-desc-clan', [252, 515, 216, 28], 'Editar descripción', () => this.promptDescription(session));
    win.closeButton([521, 0, 31, 28]);
    return { win, refresh: () => {
      const l = guild.leader; if (!l) return;
      requests.set(l.joinRequests); allies.set(l.guilds); members.set(l.members); news.value = lines(l.news);
      set(level, String(l.level)); set(count, String(l.members.length)); set(max, String(guild.config?.membersByLevel[l.level - 1] ?? ''));
      const progress = guildProgress(l.exp, l.expNeeded);
      bar.style.width = `${progress.fraction * 239}px`; set(percent, progress.percent); set(exp, progress.count);
      benefits.textContent = guildBenefits(l.level, guild.config, ' / ');
    } };
  }
  /** frmGuildLeader.cmdEditarDescripcion_Click: the VB6 InputBox as a small form. */
  private promptDescription(session: Session) {
    const guild = session.guild;
    const win = new VbWindow(this.classic, { id: 'frm-guild-description', size: [312, 160], title: 'Modify Description' });
    win.label('Ingrese la descripción:', [8, 8, 289, 17]);
    const text = win.input([8, 28, 289, 80], { multiline: true, light: true }) as HTMLTextAreaElement;
    win.command('Cancelar', [8, 118, 137, 33], () => win.close());
    win.command('Aceptar', [160, 118, 137, 33], () => {
      const result = guild.editDescription(text.value);
      if (result.warning) { this.warn(session, result.warning); return; }
      this.send(result.packet); win.close();
    });
    text.focus();
  }

  // ---- frmCharInfo: a member's or an applicant's data ----
  private buildCharInfo(session: Session): Shown {
    const guild = session.guild;
    const win = this.open('charinfo', { id: 'frm-char-info', size: [424, 400], title: 'Información del personaje' }, session, g => g.closeCharInfo());
    const frame = (text: string, box: readonly [number, number, number, number]) => { const el = win.add(document.createElement('fieldset'), box); const legend = document.createElement('legend'); legend.textContent = text; el.append(legend); el.className = 'vb-frame'; return el; };
    frame('General', [8, 8, 405, 132]); frame('Clanes', [9, 141, 405, 208]);
    const at = (x: number, y: number, w: number, dx: number, dy: number) => win.label('', [x + dx, y + dy, w, 17], 'vb-light-label');
    const g = (x: number, y: number, w: number) => at(x, y, w, 8, 8);
    const labels = {
      name: g(9, 16, 376), race: g(8, 32, 192), gender: g(8, 64, 193), class: g(8, 48, 218), level: g(8, 80, 207), gold: g(8, 96, 187), bank: g(8, 112, 199),
      guild: g(202, 32, 192), army: g(204, 48, 192), citizens: g(204, 64, 190), criminals: g(204, 80, 193),
    };
    win.label('Ultimas membresías solicitadas:', [9 + 9, 141 + 18, 199, 17], 'vb-light-label'); win.label('Ultimos clanes en los que participó:', [9 + 9, 141 + 108, 199, 17], 'vb-light-label');
    const petitions = win.input([9 + 9, 141 + 30, 386, 74], { multiline: true, readOnly: true, light: true }), previous = win.input([9 + 9, 141 + 120, 386, 74], { multiline: true, readOnly: true, light: true });
    win.command('Cerrar', [8, 359, 66.7, 33], () => win.close());
    const kick = win.command('Echar', [93, 359, 66.7, 33], () => this.send(...guild.kickMember()));
    const peticion = win.command('Peticion', [177, 359, 66.7, 33], () => this.send(guild.joinerInfo()));
    const reject = win.command('Rechazar', [258, 359, 66.7, 33], () => guild.startReject());
    const accept = win.command('Aceptar', [339, 359, 66.7, 33], () => this.send(...guild.acceptMember()));
    return { win, refresh: () => {
      const c = guild.charInfo; if (!c) return;
      const members = c.mode === 'members';
      kick.hidden = !members; peticion.hidden = members; reject.hidden = members; accept.hidden = members; // HandleCharacterInfo
      set(labels.gender, c.gender === 1 ? 'Genero: Hombre' : 'Genero: Mujer'); set(labels.name, `Nombre: ${c.name}`);
      set(labels.race, `Raza: ${RACES[c.race] ?? ''}`); set(labels.class, `Clase: ${CLASSES[c.characterClass] ?? ''}`); set(labels.level, `Nivel: ${c.level}`);
      set(labels.gold, `Oro: ${c.gold}`); set(labels.bank, `Banco: ${c.bank}`); set(labels.guild, `Clan: ${c.currentGuild}`);
      set(labels.army, c.royalArmy ? 'Ejército: Armada Real' : c.chaosLegion ? 'Ejército: Legión Oscura' : '');
      set(labels.citizens, `Ciudadanos asesinados: ${c.citizensKilled}`); set(labels.criminals, `Criminales asesinados: ${c.criminalsKilled}`);
      petitions.value = lines(c.previousPetitions); previous.value = lines(c.previousGuilds);
    } };
  }

  // ---- frmUserRequest: the text of a proposal or an application ----
  private buildOffer(session: Session): Shown {
    const guild = session.guild;
    const win = this.open('offer', { id: 'frm-user-request', size: [310, 162], title: 'Peticion' }, session, g => g.closeOffer());
    const text = win.input([8, 8, 289, 105], { multiline: true, readOnly: true, light: true });
    win.command('Cerrar', [8, 120, 289, 33], () => win.close());
    return { win, refresh: () => { text.value = lines(guild.offer ?? ''); } };
  }

  // ---- frmPeaceProp: pending peace / alliance proposals ----
  private buildProposals(session: Session): Shown {
    const guild = session.guild;
    const win = this.open('proposals', { id: 'frm-peace-prop', size: [332, 193], title: 'Ofertas de paz' }, session, g => g.closeProposals());
    const list: VbList = win.list([8, 8, 313, 121], true);
    win.command('Cerrar', [8, 152, 65, 33], () => win.close());
    win.command('Detalles', [88, 152, 65, 33], () => this.send(guild.proposalDetails(list.value)));
    win.command('Aceptar', [168, 152, 65, 33], () => this.send(guild.proposalAnswer(list.value, true)));
    win.command('Rechazar', [248, 152, 65, 33], () => this.send(guild.proposalAnswer(list.value, false)));
    return { win, refresh: () => { list.set(guild.proposals?.guilds ?? []); } };
  }

  // ---- frmGuildDetails: found a guild ----
  private buildFounding(session: Session): Shown {
    const guild = session.guild;
    const win = this.open('founding', { id: 'frm-guild-details', art: 'ventanaclanes_fundar', size: [250, 295], title: 'Fundar Clan' }, session, g => g.closeFounding());
    const name = win.input([24, 52, 201, 19], { maxLength: 30 }) as HTMLInputElement;
    win.label('Nota: No se toleraran nombres inapropiados.', [24, 72.7, 203, 33], 'vb-note');
    const description = win.input([24, 106.7, 201, 57], { multiline: true }) as HTMLTextAreaElement;
    const alignment = win.add(combo(CLAN_ALIGNMENTS, -1), [24, 186.7, 201, 21]);
    win.label('El alineamiento del clan es el que decide qué tipo de miembro podrá ingresar al clan y cuál no.', [24, 211.7, 201, 57], 'vb-note');
    win.button('boton-fundar-clan', [56.7, 246.7, 113, 33], 'Fundar', () => {
      const result = guild.found(name.value, description.value, alignment.selectedIndex);
      if (result.warning) { this.warn(session, result.warning); return; }
      this.send(result.packet);
    });
    win.closeButton([218.7, 0.3, 25, 25]);
    name.focus();
    return { win, refresh: () => undefined };
  }

  // ---- frmCommet: a proposal text or a rejection reason ----
  private buildComment(session: Session): Shown {
    const guild = session.guild;
    const win = this.open('comment', { id: 'frm-commet', size: [312, 188], title: 'Oferta de paz o alianza' }, session, g => g.closeComment());
    const text = win.input([8, 8, 289, 129], { multiline: true, light: true }) as HTMLTextAreaElement;
    win.command('Cancelar', [8, 144, 137, 33], () => win.close());
    win.command('Enviar', [160, 144, 137, 33], () => {
      const result = guild.sendComment(text.value);
      if (result.warning) { this.warn(session, result.warning); return; }
      this.send(result.packet);
    });
    text.focus();
    return { win, refresh: () => {
      const box = guild.comment; if (!box) return;
      text.maxLength = box.kind === 'reject' ? 50 : 200; // frmCommet.SetTipo
      win.root.setAttribute('aria-label', box.kind === 'alliance' ? 'Ingrese propuesta de alianza' : box.kind === 'peace' ? 'Ingrese propuesta de paz' : 'Ingrese motivo para rechazo');
    } };
  }

  // ---- frmGuildURL ----
  private buildUrl(session: Session): Shown {
    const guild = session.guild;
    const win = this.open('url', { id: 'frm-guild-url', size: [263, 69], title: 'Oficial Web Site' }, session, g => g.closeUrl());
    win.label('Ingrese la direccion del site:', [8, 8, 281, 17]);
    const text = win.input([8, 24, 249, 19], { light: true }) as HTMLInputElement;
    win.command('Aceptar', [8, 48, 249, 17], () => this.send(guild.sendUrl(text.value)));
    text.focus();
    return { win, refresh: () => undefined };
  }
}
