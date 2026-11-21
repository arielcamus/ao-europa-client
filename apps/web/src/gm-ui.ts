/*
 * GM forms (wp12), 2026-11-21, adapted from frmMain (panelGM, createObj, btnSpawn, btnInvisible, onlines), frmPanelGm.frm, frmSpawnList.frm,
 * FrmObjetos.frm, frmCambiaMotd.frm and FrmGmAyuda.frm. Positions are the .frm twips / 15. InputBox/MsgBox are the browser's prompt/confirm.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 */
import type { ClientPacket } from '@ao/protocol';
import { GmClientPacketId as G } from '@ao/protocol';
import { fetchText, parseIni } from './assets.js';
import { loadObjectIni } from './object-catalog.js';
import { parseGmLine } from './gm-commands.js';
import type { Session } from './session.js';
import { VbWindow, combo } from './vb-window.js';
import type { Box, VbList } from './vb-window.js';

const t = (l: number, tp: number, w: number, h: number): Box => [Math.round(l / 15), Math.round(tp / 15), Math.round(w / 15), Math.round(h / 15)];
/** frmSpawnList / FrmObjetos Tilde(): case and accent insensitive match. */
export const tilde = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface NpcEntry { index: number; name: string; summonable: boolean }
let npcTable: Promise<NpcEntry[]> | undefined;
/** NpcData(n).Name / PuedeInvocar from Dat/npcs.dat. */
export const loadNpcList = (): Promise<NpcEntry[]> => npcTable ??= fetchText('Dat/npcs.dat').then(text => {
  const ini = parseIni(text), list: NpcEntry[] = [];
  for (const [section, values] of ini) {
    const match = /^npc(\d+)$/.exec(section);
    if (match) list.push({ index: Number(match[1]), name: values.get('name') ?? '', summonable: parseInt(values.get('puedeinvocar') ?? '0', 10) === 1 /* VB6 Val: the value may carry a trailing comment */ });
  }
  return list.sort((a, b) => a.index - b.index);
}).catch(error => { npcTable = undefined; throw error; });

/** Rows of frmSpawnList.FillList. */
export const spawnRows = (npcs: readonly NpcEntry[], full: boolean, filter: string) =>
  npcs.filter(n => n.name !== 'Vacío' && (n.summonable || full) && tilde(n.name).includes(tilde(filter))).map(n => ({ index: n.index, text: `${n.index} - ${n.name}` }));

export class GmUI {
  private session: Session | undefined;
  private revision = -1;
  private seen = { panel: 0, spawn: 0, motd: 0 };
  private bar: Record<'panel' | 'object' | 'spawn' | 'invisible' | 'online', HTMLElement>;
  private panelWindow: VbWindow | undefined;
  private userCombo: HTMLSelectElement | undefined;
  private lists: { main: VbList; queries: VbList; detail: HTMLTextAreaElement | HTMLInputElement } | undefined;
  /** Counts what each form did; the tests and the QA shots read it. */
  constructor(private readonly parent: HTMLElement, private readonly report: (error: unknown) => void) {
    const label = (text: string, box: Box, onClick: () => void, extra = '') => {
      const el = document.createElement('button'); el.type = 'button'; el.textContent = text; el.hidden = true;
      el.style.cssText = `position:absolute;left:${box[0]}px;top:${box[1]}px;width:${box[2]}px;height:${box[3]}px;z-index:6;background:transparent;border:0;color:#ffffe1;font:bold 15px Arial,sans-serif;cursor:pointer;${extra}`;
      el.addEventListener('click', () => { try { onClick(); } catch (error) { this.report(error); } });
      parent.append(el); return el;
    };
    this.bar = {
      panel: label('PanelGM', t(2640, 75, 1215, 375), () => this.requestPanel()),
      object: label('Crear Obj', t(3960, 75, 1335, 375), () => this.openObjects()),
      spawn: label('Spawn NPC', t(5400, 75, 1335, 375), () => this.send({ id: G.SpawnListRequest })),
      invisible: label('Invisible', t(6840, 75, 1335, 375), () => this.run('/INVISIBLE')),
      online: label('Online: 1', t(1350, 0, 1665, 450), () => {}, 'font-size:13px;cursor:default;'),
    };
    this.bar.panel.id = 'gm-panel-button'; this.bar.object.id = 'gm-object-button'; this.bar.spawn.id = 'gm-spawn-button'; this.bar.invisible.id = 'gm-invisible-button';
  }

  private send(packet: ClientPacket) { this.session?.sendChat(packet); }
  /** ParseUserCommand for text the panel builds; console lines go to the console like a typed command. */
  run(line: string) {
    const session = this.session; if (!session) return;
    const outcome = parseGmLine(line, { isGM: session.gm.isGM });
    if (!outcome) { session.ui.message('El comando es invalido.'); return; }
    for (const note of outcome.notes) session.ui.message(note.text, note.font);
    for (const packet of outcome.packets) session.sendChat(packet);
    if (outcome.open === 'objects') this.openObjects(); else if (outcome.open === 'gmHelp') this.openHelp();
  }
  /** frmMain.panelGM_Click: WriteSOSShowList + WriteGMPanel (the server answers with ShowGMPanelForm). */
  requestPanel() { this.send({ id: G.SOSShowList }); this.send({ id: G.GMPanel }); }

  update(session: Session | undefined) {
    if (session !== this.session) { this.session = session; this.revision = -1; this.seen = { panel: 0, spawn: 0, motd: 0 }; this.panelWindow?.close(); }
    const gm = session?.gm;
    const isGM = gm?.isGM === true;
    // HandlePrivilegios: the four labels follow EsGM; the online count is for every GM but a counsellor (priv 2).
    for (const key of ['panel', 'object', 'spawn', 'invisible'] as const) this.bar[key].hidden = !isGM;
    const priv = session?.self?.privileges;
    this.bar.online.hidden = !(isGM && priv !== 2);
    if (!session || !gm || gm.revision === this.revision) return;
    this.revision = gm.revision;
    this.bar.online.textContent = `Online: ${gm.online ?? 1}`;
    if (gm.panelOpened !== this.seen.panel) { this.seen.panel = gm.panelOpened; this.openPanel(session); }
    else if (this.panelWindow?.isOpen) this.fillLists(session);
    if (gm.spawnOpened !== this.seen.spawn) { this.seen.spawn = gm.spawnOpened; this.openSpawn(gm.spawnFull); }
    if (gm.motdOpened !== this.seen.motd) { this.seen.motd = gm.motdOpened; this.openMotd(gm.motd); }
  }

  // ---- frmPanelgm -----------------------------------------------------------------------------------------------------
  private openPanel(session: Session) {
    this.panelWindow?.close();
    const form = session.gm.panel!;
    const win = new VbWindow(this.parent, { id: 'gm-panel', size: [491, 583], title: 'Panel GM', onClose: () => { this.panelWindow = undefined; this.lists = undefined; } });
    this.panelWindow = win;
    win.root.style.overflow = 'hidden';
    // frmMain.panelGM_Click: Width = 4860 twips (the narrow form); cmdMapeo (Mapeo) toggles 7365 (the wide one with the map tools).
    const narrow = 324, wide = 491;
    const setWidth = (w: number) => { win.root.style.width = `${w}px`; };
    setWidth(narrow);
    const cmd = (label: string, box: Box, fn: () => void) => win.command(label, box, () => { try { fn(); } catch (error) { this.report(error); } });
    const user = () => this.userCombo?.value ?? '';
    // Lists (List1 = main messages, List2 = consultas), the message box and the user picker.
    const main = win.list(t(120, 110, 4560, 2010), true), queries = win.list(t(120, 600, 4560, 1425), true);
    queries.el.hidden = true;
    const detail = win.input(t(120, 2160, 4575, 1035), { multiline: true, light: true, readOnly: true });
    this.lists = { main, queries, detail };
    main.onSelect = i => { detail.value = session.gm.sos[i]?.query ?? ''; };
    queries.onSelect = i => { detail.value = session.gm.sos.filter(r => r.type === 'Consulta regular' || session.self?.privileges !== 2)[i]?.query ?? ''; };
    cmd('Lista 1 (Principal)', t(7320, 360, 2175, 255), () => { main.el.hidden = false; queries.el.hidden = true; });
    cmd('Lista 2 (Consultas)', t(7320, 840, 2175, 255), () => { main.el.hidden = true; queries.el.hidden = false; });
    cmd('Seleccionar personaje', t(120, 3360, 1815, 375), () => {
      this.send({ id: G.MarcaDeGMPack });
      const row = session.gm.sos[main.index]; if (row && this.userCombo) this.setUser(row.name);
    });
    cmd('Info/Mapa', t(2040, 3360, 1335, 360), () => {
      const choice = prompt('Edición de mapa\n0: información\n1: seguro\n2: inseguro', '');
      if (choice === '0') this.run('/MAPINFO'); else if (choice === '1') this.run('/MODMAPINFO SEGURO 1'); else if (choice === '2') this.run('/MODMAPINFO SEGURO 0');
    });
    cmd('Mapeo', t(3480, 3360, 1215, 360), () => setWidth(win.root.offsetWidth === narrow ? wide : narrow));
    cmd('Actualizar Trabajadores', t(120, 3840, 2175, 360), () => this.send({ id: G.Working }));
    cmd('Actualizar Usuarios', t(2400, 3840, 2295, 360), () => this.send({ id: G.RequestUserList }));
    const picker = combo(session.gm.userNames); this.userCombo = picker;
    win.add(picker, t(120, 4320, 3675, 315));
    cmd('/ir A', t(3840, 4320, 855, 320), () => this.send({ id: G.GoNearby, userName: user() }));
    // FraControlMacros (relative to 120,4680): the per-user actions.
    const f = (l: number, tp: number, w: number, h: number): Box => t(120 + l, 4680 + tp, w, h);
    const frame: HTMLElement[] = [];
    const fcmd = (label: string, l: number, tp: number, w: number, h: number, fn: () => void) => frame.push(cmd(label, f(l, tp, w, h), fn));
    const reasonPrompt = (what: string) => prompt(what, '') ?? '';
    fcmd('Ir Cerca', 120, 240, 1455, 330, () => this.send({ id: G.GoNearby, userName: user() }));
    fcmd('Seguir Mouse', 1680, 240, 1455, 330, () => this.run(`/SM ${user()}`));
    fcmd('Info', 120, 600, 1455, 330, () => this.send({ id: G.RequestCharInfo, userName: user() }));
    fcmd('Consulta', 1680, 600, 1455, 330, () => this.run(`/CONSULTA ${user()}`));
    fcmd('STAT', 120, 960, 1455, 330, () => this.send({ id: G.RequestCharStats, userName: user() }));
    fcmd('Boveda', 1680, 960, 1455, 330, () => this.send({ id: G.RequestCharBank, userName: user() }));
    fcmd('Cerrar Cliente', 3240, 960, 1215, 330, () => this.send({ id: G.CerrarCliente, userName: user() }));
    fcmd('Traer Usuario', 120, 1320, 1455, 330, () => this.send({ id: G.SummonChar, userName: user() }));
    fcmd('Penas', 1680, 1320, 1455, 330, () => this.send({ id: G.Punishments, userName: user() }));
    fcmd('Inventario', 3240, 1320, 1215, 330, () => this.run(`/INV ${user()}`));
    fcmd('Carcel', 120, 1680, 1455, 330, () => {
      const reason = reasonPrompt('Escriba el motivo de Carcel .'), time = reasonPrompt('Escriba el tiempo de Carcel .');
      if (reason === '' || time === '') alert('Faltan datos'); else this.send({ id: G.Jail, userName: user(), reason, time: Math.round(Number(time)) || 0 });
    });
    fcmd('Echar', 1680, 1680, 1455, 330, () => this.send({ id: G.Kick, userName: user() }));
    fcmd('Ban PJ', 120, 2040, 1455, 330, () => {
      const reason = reasonPrompt(`Escriba el motivo del BAN de ${user()}.`);
      if (reason !== '') this.send({ id: G.BanChar, userName: user(), reason });
    });
    fcmd('Ejecutar', 1680, 2040, 1455, 330, () => this.send({ id: G.Execute, userName: user() }));
    // The /MOD rows (Body, Head, Escudo, Arma, Casco) edit the GM's own character ("yo"); chkVerPanel swaps them with the frame above.
    const rows: HTMLElement[] = [];
    const modRow = (caption: string, top: number, key: 'body' | 'head' | 'escudo' | 'arma' | 'casco', word: string, zero?: string) => {
      rows.push(win.label(caption, t(120, top + 120, 975, 285)));
      const box = win.input(t(1680, top, 735, 375), { light: true }); box.value = String(form[key]); rows.push(box);
      const step = (delta: number) => { const value = Math.max(0, (Number(box.value) || 0) + delta); box.value = String(value); this.run(`/MOD yo ${word} ${value}`); };
      rows.push(cmd('-', t(1200, top, 375, 375), () => { if ((Number(box.value) || 0) >= 1) step(-1); }), cmd('+', t(2520, top, 375, 375), () => step(1)));
      if (zero) rows.push(cmd(zero, t(3120, top, 1590, 360), () => { box.value = '0'; this.run(`/MOD yo ${word} 0`); }));
    };
    modRow('Body', 4800, 'body', 'Body', 'Body 0'); modRow('Head', 5280, 'head', 'Head', 'Head 0');
    modRow('Escudo', 5760, 'escudo', 'Escudo'); modRow('Arma', 6240, 'arma', 'Arma'); modRow('Casco', 6720, 'casco', 'Casco');
    const showMod = (on: boolean) => { for (const el of rows) el.hidden = !on; for (const el of frame) el.hidden = on; };
    showMod(false);
    const check = document.createElement('input'); check.type = 'checkbox'; check.setAttribute('aria-label', 'Ver panel /MOD');
    check.addEventListener('change', () => showMod(check.checked)); win.add(check, t(3240, 7680, 255, 255));
    win.label('Ver panel /MOD', t(3500, 7710, 1215, 200));
    // txtMod + the command line (cmdComandoGM: ParseUserCommand(txtMod.text)).
    const line = win.input(t(120, 7320, 3615, 285), { light: true });
    line.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Enter') { this.run(line.value); line.value = ''; } });
    cmd('A GMs', t(3840, 7320, 800, 300), () => { this.run(`/GMSG ${line.value}`); line.value = ''; });
    cmd('Información General', t(120, 8040, 1935, 360), () => this.send({ id: G.RequestCharStats, userName: user() }));
    cmd('/Revivir', t(2160, 8040, 1215, 360), () => this.send({ id: G.ReviveChar, userName: user() }));
    cmd('Destrabar', t(3480, 8040, 1215, 375), () => this.run(`/DESTRABAR ${user()}`));
    // The wide column (x >= 4800 twips): map and server tools.
    cmd('Bloquear/Desbloquear - Pos', t(4800, 120, 2295, 360), () => this.send({ id: G.TileBlockedToggle }));
    cmd('Eventos', t(4800, 600, 2295, 360), () => { const type = prompt('Tipo de evento (0 tesoro continente, 1 tesoro dungeon, 2 aparición de criatura)', ''); if (type) this.run(`/EVENTO ${type}`); });
    cmd('Invisible', t(4800, 1080, 2295, 360), () => this.run('/INVISIBLE'));
    const trigger = win.input(t(6600, 4560, 495, 375), { light: true }); trigger.value = '5';
    cmd('Insertar trigger´s', t(4800, 4560, 1695, 360), () => this.run(`/TRIGGER ${trigger.value}`));
    cmd('Seguro', t(4800, 5040, 1095, 360), () => this.run('/MODMAPINFO SEGURO 1'));
    cmd('Inseguro', t(6000, 5040, 1110, 360), () => this.run('/MODMAPINFO SEGURO 0'));
    cmd('Restringir Mapa', t(4800, 5640, 2295, 360), () => { this.run('/MODMAPINFO RESTRINGIR Newbie'); this.run('/MODMAPINFO RESTRINGIR NoPKS'); this.run('/MODMAPINFO RESTRINGIR NoCIUD'); });
    cmd('Magia / Sin Magia', t(4800, 6120, 2295, 360), () => this.run('/MODMAPINFO RESTRINGIR SINMAGIA'));
    cmd('Invisibilidad Si/No', t(4800, 6600, 2295, 360), () => this.run('/MODMAPINFO RESTRINGIR SININVI'));
    cmd('Matar NPC', t(4800, 7080, 2295, 360), () => this.run('/MATA'));
    cmd('Recargar NPCs', t(4800, 8040, 2295, 360), () => this.run('/RELOAD NPCS'));
    this.fillLists(session);
    this.send({ id: G.RequestUserList });
    win.focus();
  }
  private setUser(name: string) {
    const picker = this.userCombo; if (!picker) return;
    if (![...picker.options].some(o => o.value === name)) { const o = document.createElement('option'); o.value = o.textContent = name; picker.append(o); }
    picker.value = name;
  }
  /** HandleShowSOSForm / HandleUserNameList filling frmPanelgm. */
  private fillLists(session: Session) {
    const gm = session.gm, lists = this.lists; if (!lists) return;
    const counsellor = session.self?.privileges === 2;
    const rows = gm.sos.filter(r => r.type === 'Consulta regular' || !counsellor);
    lists.main.set(rows.map(r => `${r.name}(${r.type}) - ${r.date}`));
    lists.queries.set(rows.map(r => r.query));
    const picker = this.userCombo;
    if (picker) {
      const current = picker.value;
      picker.replaceChildren(...gm.userNames.map(name => { const o = document.createElement('option'); o.value = o.textContent = name; return o; }));
      picker.value = gm.userNames.includes(current) ? current : (gm.userNames[0] ?? '');
    }
  }

  // ---- frmSpawnList (Invocar NPC) ------------------------------------------------------------------------------------------
  openSpawn(full: boolean) {
    const win = new VbWindow(this.parent, { id: 'gm-spawn-list', size: [185, 279], title: 'Invocar NPC' });
    win.label('Filtrar:', t(120, 120, 660, 240));
    const filter = win.input(t(840, 120, 1815, 285), { light: true });
    const list = win.list(t(120, 480, 2490, 2790), true);
    let rows: { index: number; text: string }[] = [], npcs: NpcEntry[] = [];
    const fill = () => { rows = spawnRows(npcs, full, filter.value); list.set(rows.map(r => r.text)); };
    const spawn = () => { const row = rows[list.index]; if (row) this.send({ id: G.SpawnCreature, creatureIndex: row.index }); };
    void loadNpcList().then(table => { npcs = table; fill(); }).catch(error => this.report(error));
    filter.addEventListener('input', fill);
    filter.addEventListener('keyup', event => { if ((event as KeyboardEvent).key === 'Enter' && rows.length) { list.select(0); list.el.focus(); } });
    list.onDoubleClick = spawn;
    win.command('Spawn', t(120, 3600, 2490, 510), spawn);
    win.focus();
    return win;
  }

  // ---- FrmObjetos (Crear objeto) ----------------------------------------------------------------------------------------------
  openObjects() {
    const win = new VbWindow(this.parent, { id: 'gm-objects', size: [301, 385], title: 'Crear objeto' });
    win.label('Filtrar', t(480, 250, 615, 255));
    const filter = win.input(t(1200, 240, 2415, 350), { light: true });
    const list = win.list(t(120, 720, 4215, 3540), true);
    win.label('Cantidad:', t(840, 4440, 735, 255));
    const amount = win.input(t(1800, 4440, 615, 285), { light: true }); amount.value = '1';
    let rows: { index: number; text: string }[] = [], all: { index: number; name: string }[] = [];
    const fill = () => { rows = all.filter(o => tilde(o.name).includes(tilde(filter.value))).map(o => ({ index: o.index, text: `${o.name}  (${o.index})` })); list.set(rows.map(r => r.text)); };
    const create = () => {
      const row = rows[list.index]; const quantity = Number(amount.value);
      // MAX_INVENTORY_OBJS is 10000; WriteCreateItem takes an Int16.
      if (row && Number.isInteger(quantity) && quantity <= 10000) this.send({ id: G.CreateItem, itemIndex: row.index, cantidad: quantity });
    };
    void loadObjectIni().then(ini => {
      all = [...ini].flatMap(([section, values]) => { const m = /^obj(\d+)$/.exec(section); const name = values.get('name'); return m && name ? [{ index: Number(m[1]), name }] : []; }).sort((a, b) => a.index - b.index);
      fill();
    }).catch(error => this.report(error));
    filter.addEventListener('input', fill);
    list.onDoubleClick = create;
    win.command('Crear', t(120, 4800, 2730, 855), create);
    win.command('Salir', t(3000, 4800, 1290, 855), () => win.close());
    win.focus();
    return win;
  }

  // ---- frmCambiaMotd ---------------------------------------------------------------------------------------------------------
  openMotd(current: string) {
    const win = new VbWindow(this.parent, { id: 'gm-motd', size: [345, 343], title: 'ZMOTD' });
    win.label('No olvides agregar los colores al final de cada línea (ver tabla de abajo)', t(360, 60, 4455, 495));
    const text = win.input(t(360, 660, 4455, 2415), { multiline: true, light: true }) as HTMLTextAreaElement;
    text.value = current.replaceAll('\r\n', '\n');
    const bold = document.createElement('input'), italic = document.createElement('input'); bold.type = italic.type = 'checkbox';
    win.add(bold, t(1080, 4320, 255, 255)); win.label('Negrita', t(1350, 4320, 600, 255)); win.add(italic, t(2880, 4320, 255, 255)); win.label('Cursiva', t(3150, 4320, 600, 255));
    const colours: [string, string, number, number][] = [['Azul', '50~70~250', 600, 3240], ['Rojo', '255~0~0', 1560, 3240], ['Blanco', '255~255~255', 2520, 3240], ['Gris', '157~157~157', 3480, 3240],
      ['Amarillo', '244~244~0', 600, 3840], ['Morado', '128~0~128', 1560, 3840], ['Verde', '23~104~26', 2520, 3840], ['Marron', '97~58~31', 3480, 3840]];
    for (const [caption, rgb, l, tp] of colours) win.command(caption, t(l, tp, 855, 375), () => { text.value += `~${rgb}~${bold.checked ? 1 : 0}~${italic.checked ? 1 : 0}`; });
    win.command('Aceptar', t(600, 4680, 3855, 375), () => {
      const body = text.value.endsWith('\n') ? text.value.slice(0, -1) : text.value;
      const lines = body.split('\n');
      for (let i = 0; i < lines.length; i++) {
        // Each line must hold exactly five "~" that are not the last character.
        let n = 0, pos = lines[i]!.indexOf('~');
        while (pos >= 0 && pos < lines[i]!.length - 1) { n++; pos = lines[i]!.indexOf('~', pos + 1); }
        if (n !== 5) { alert(`Error de formato en la línea ${i + 1}.`); return; }
      }
      this.send({ id: G.SetMOTD, message: lines.join('\r\n') }); win.close();
    });
    win.focus();
    return win;
  }

  // ---- FrmGmAyuda (/GM) -------------------------------------------------------------------------------------------------------
  openHelp() {
    const win = new VbWindow(this.parent, { id: 'gm-help', art: 'ventanagm', size: [470, 435], title: 'Formulario de mensaje a administradores' });
    const kinds = ['Consulta regular', 'Descargo', 'Acusación', 'Sugerencia', 'Reporte de bug', 'Otro', 'Queja'];
    let chosen = -1;
    const radios = kinds.map((kind, i) => {
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'gm-help-kind'; radio.setAttribute('aria-label', kind);
      radio.addEventListener('change', () => { chosen = i; });
      win.add(radio, t(3915, 1590 + i * 360, 225, 210)); win.label(kind, t(4200, 1590 + i * 360, 1900, 240)); return radio;
    });
    void radios;
    const text = win.input(t(720, 3000, 2415, 2175), { multiline: true, light: true }) as HTMLTextAreaElement;
    win.command('Enviar', t(3855, 5715, 1920, 360), () => {
      if (text.value === '') { this.session?.ui.message('Debes escribir tu mensaje.'); return; }
      if (chosen < 0) { this.session?.ui.message('Debes elegir el motivo de tu consulta.'); return; }
      this.send({ id: G.QuestionGM, consulta: text.value, tipoDeConsulta: kinds[chosen]!, counter: 0 }); win.close();
    });
    win.command('Cancelar', t(1335, 5715, 1920, 360), () => win.close());
    win.closeButton(t(6585, 0, 420, 420));
    win.focus();
    return win;
  }
}
