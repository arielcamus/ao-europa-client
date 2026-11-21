/*
 * DOM layer of the extras (2026-11-21): the invasion bar, the duel form (frmRetos), the tournament organiser (FrmTorneo), the battleground
 * lobby list (frmLobbyBattleground) and the right-click interaction menus (MenuUser, MenuNPC, MenuGM, ModGameplayUI.ShowInteractionMenu).
 * Positions are the .frm twips / 15. Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 */
import { ExtrasClientPacketId as X, SpellClientPacketId as SC } from '@ao/protocol';
import type { ClientPacket } from '@ao/protocol';
import { make, place } from './bank-trade-dom.js';
import { VbWindow, combo } from './vb-window.js';
import type { VbList } from './vb-window.js';
import { showConfirm } from './session-windows.js';
import { windows } from './window-stack.js';
import { MAX_DUEL_PLAYERS_PER_TEAM, parseExtrasCommand } from './extras-commands.js';
import { splitName } from './character-data.js';
import type { Session } from './session.js';
import './extras.css';

/** frmMain.Evento: the bar of TileEngine_RenderScreen (InvasionActual). */
export const INVASION_BOX = { x: 190, y: 550, w: 356, h: 36 };
/** eSkill.Grupo: the pseudo skill the party invite sends as WorkLeftClick. */
export const GROUP_SKILL = 90;
/** General.ValidarNombre: 3..18 letters (A-Z) and single inner spaces. */
export function validName(name: string): boolean {
  if (name.length < 3 || name.length > 18) return false;
  if (!/^[A-Za-z ]+$/.test(name) || name.includes('  ') || name.startsWith(' ') || name.endsWith(' ')) return false;
  return true;
}
/** frmRetos.Validar: the first error caption, or '' when the form can be sent. */
export function validateDuel(names: string[], perTeam: number, redPotions: boolean, potions: string): string {
  for (let i = 0; i < perTeam * 2; i++) {
    if ((names[i] ?? '') === '') return 'Complete todos los jugadores';
    if (!validName(names[i]!)) return `Nombre del jugador inválido: '${names[i]}'`;
  }
  for (let i = 0; i < perTeam * 2 - 1; i++) for (let j = i + 1; j < perTeam * 2; j++) if (names[i] === names[j]) return 'No se permiten jugadores repetidos';
  if (redPotions) { const n = Number(potions) || 0; if (n < 0 || n > 10_000_000) return 'No se permite apostar mas de 10.000.000 monedas de oro'; }
  return '';
}

export interface ExtrasUiDeps {
  /** The session's one door (counters are stamped by the callers that need them). */
  send(packet: ClientPacket): void;
  /** Runs a slash command through the chat box exactly as if it had been typed. */
  runLine(line: string): void;
  /** frmMain.SendTxt = "\name ": opens the chat box with a whisper to `name`. */
  whisper(name: string): void;
}

export class ExtrasUI {
  private readonly bar: HTMLElement; private readonly life: HTMLElement; private readonly time: HTMLElement;
  private duel: VbWindow | undefined; private tournament: VbWindow | undefined; private lobby: VbWindow | undefined;
  private menu: HTMLElement | undefined;
  private session: Session | undefined; private revision = -1;

  constructor(private readonly parent: HTMLElement, viewport: HTMLElement, private readonly deps: ExtrasUiDeps) {
    this.bar = make('div', 'extras-invasion', viewport, 'invasion-bar'); this.bar.hidden = true;
    place(this.bar, INVASION_BOX.x, INVASION_BOX.y, INVASION_BOX.w, INVASION_BOX.h);
    this.life = make('div', 'extras-invasion-life', this.bar, 'invasion-life'); this.time = make('div', 'extras-invasion-time', viewport, 'invasion-time'); this.time.hidden = true;
  }

  /** Once per frame. */
  update(session: Session | undefined) {
    if (session !== this.session) { this.session = session; this.revision = -1; this.closeAll(); }
    if (!session) return;
    session.extras.tick();
    const invasion = session.extras.invasion;
    this.bar.hidden = this.time.hidden = !invasion;
    if (invasion) {
      place(this.life, 3, 3, 3.5 * invasion.lifePercent, 30);
      place(this.time, 340, 586, 54, 9);
      this.time.replaceChildren(); const fill = make('div', 'extras-invasion-time-fill', this.time); place(fill, 2, 2, 0.5 * invasion.timePercent, 5);
    }
    if (session.extras.revision !== this.revision) { this.revision = session.extras.revision; this.syncLobby(session); }
  }
  closeAll() { this.duel?.close(); this.tournament?.close(); this.lobby?.close(); this.closeMenu(); }
  get windowOpen() { return !!(this.duel?.isOpen || this.tournament?.isOpen || this.lobby?.isOpen); }

  // ---- frmRetos -------------------------------------------------------------------------------------------------------------------
  openDuel(names: readonly string[] = [], own = splitName(this.session?.characters.get(this.session.charIndex ?? -1)?.name ?? '').name) {
    this.duel?.close();
    const win = new VbWindow(this.parent, { id: 'duel-window', size: [291, 487], title: 'Retos', onClose: () => { this.duel = undefined; } });
    this.duel = win;
    win.label('Retos', [100, 8, 91, 20], 'vb-center vb-bold');
    win.label('Jugadores por equipo', [32, 94, 130, 15]);
    const perTeam = win.input([193, 91, 25, 17], { maxLength: 1, light: true, readOnly: true }) as HTMLInputElement; perTeam.value = '1'; perTeam.id = 'duel-per-team';
    const players: HTMLInputElement[] = [];
    // Jugador(0..9): even indexes left (x 32), odd right (x 154), one row of 32 px per pair from y 152.
    for (let i = 0; i < MAX_DUEL_PLAYERS_PER_TEAM * 2; i++) {
      const input = win.input([i % 2 === 0 ? 32 : 154, 152 + 32 * Math.floor(i / 2), 105, 16], { maxLength: 18, light: true }) as HTMLInputElement;
      input.id = `duel-player-${i}`; input.placeholder = i % 2 === 0 ? 'Equipo 1' : 'Equipo 2'; players.push(input);
    }
    players[0]!.value = own; players[0]!.readOnly = true;
    names.forEach((name, i) => { if (players[i + 1]) players[i + 1]!.value = name; });
    const error = win.label('', [32, 384, 225, 15], 'duel-error'); error.id = 'duel-error';
    const refresh = () => { const n = Number(perTeam.value); players.forEach((input, i) => { input.hidden = Math.floor(i / 2) >= n; }); };
    const step = (delta: number) => { perTeam.value = String(Math.min(MAX_DUEL_PLAYERS_PER_TEAM, Math.max(1, Number(perTeam.value) + delta))); refresh(); };
    win.command('-', [159, 90, 21, 21], () => step(-1)).id = 'duel-minus';
    win.command('+', [231, 89, 21, 21], () => step(1)).id = 'duel-plus';
    win.label('Apuesta', [32, 366, 80, 15]);
    const bet = win.input([120, 366, 97, 15], { light: true }) as HTMLInputElement; bet.value = '0'; bet.id = 'duel-bet';
    // Apuesta_Change: |val| as a Long, above 100.000.000 it becomes 10.000.000.
    bet.addEventListener('input', () => { let n = Math.round(Math.abs(Number(bet.value.replace(/[^0-9.-]/g, '')) || 0)); if (n > 100_000_000) n = 10_000_000; bet.value = String(n); });
    const redBox = make('input', '', undefined, 'duel-red-potions'); redBox.type = 'checkbox'; win.add(redBox, [31, 311, 17, 17]);
    win.label('Pociones rojas', [56, 313, 120, 15]);
    const potions = win.input([197, 313, 41, 15], { light: true }) as HTMLInputElement; potions.value = '0'; potions.id = 'duel-potions'; potions.hidden = true;
    redBox.addEventListener('change', () => { potions.hidden = !redBox.checked; });
    const dropBox = make('input', '', undefined, 'duel-drop-items'); dropBox.type = 'checkbox'; win.add(dropBox, [56, 397, 17, 17]);
    win.label('Caen los ítems', [80, 399, 120, 15]);
    win.command('Retar', [90, 448, 110, 27], () => {
      const n = Number(perTeam.value), names = players.map(input => input.value.trim());
      const problem = validateDuel(names, n, redBox.checked, potions.value);
      error.textContent = problem;
      if (problem) return;
      // Retar_Click: every player but the creator, joined by ';'.
      this.deps.send({ id: X.Duel, players: names.slice(1, n * 2).join(';'), bet: Number(bet.value) || 0, redPotions: redBox.checked ? Math.round(Number(potions.value) || 0) : -1, dropItems: dropBox.checked } as unknown as ClientPacket);
      win.close();
    }).id = 'duel-send';
    win.closeButton([260, 1, 31, 28]);
    win.root.addEventListener('input', () => { error.textContent = ''; });
    // Form_Load: three of the names the command gave make a second team column visible.
    const perTeamFromNames = Math.min(MAX_DUEL_PLAYERS_PER_TEAM, Math.max(1, Math.ceil((names.length + 1) / 2)));
    perTeam.value = String(perTeamFromNames); refresh();
    win.focus();
    return win;
  }

  // ---- FrmTorneo ------------------------------------------------------------------------------------------------------------------
  openTournament() {
    this.tournament?.close();
    const win = new VbWindow(this.parent, { id: 'tournament-window', size: [470, 430], title: 'Organizacion de evento', onClose: () => { this.tournament = undefined; } });
    this.tournament = win;
    win.label('Torneos y Eventos', [150, 6, 170, 16], 'vb-center vb-bold');
    const send = (packet: ClientPacket) => this.deps.send(packet);
    const line = (text: string) => this.deps.runLine(text);
    // Torneos frame: Command1_Click -> WriteCreaerTorneo.
    win.label('Torneo', [10, 28, 80, 15], 'vb-bold');
    const numberField = (id: string, caption: string, x: number, y: number, value: string) => {
      win.label(caption, [x, y, 90, 15]); const input = win.input([x + 90, y - 2, 60, 17], { light: true }) as HTMLInputElement; input.id = id; input.value = value; return input;
    };
    const minLevel = numberField('tournament-min', 'Nivel mínimo', 10, 48, '1'), maxLevel = numberField('tournament-max', 'Nivel máximo', 10, 72, '47');
    const slots = numberField('tournament-slots', 'Cupos', 10, 96, '8'), cost = numberField('tournament-cost', 'Costo', 10, 120, '0');
    const map = numberField('tournament-map', 'Mapa', 170, 48, '1'), x = numberField('tournament-x', 'X', 170, 72, '50'), y = numberField('tournament-y', 'Y', 170, 96, '50');
    win.label('Nombre', [10, 146, 60, 15]); const name = win.input([70, 144, 140, 17], { light: true }) as HTMLInputElement; name.id = 'tournament-name';
    win.label('Reglas', [220, 146, 50, 15]); const rules = win.input([270, 144, 180, 17], { light: true }) as HTMLInputElement; rules.id = 'tournament-rules';
    const classes = ['Mago', 'Clérigo', 'Guerrero', 'Asesino', 'Bardo', 'Druida', 'Paladín', 'Cazador', 'Trabajador', 'Pirata', 'Ladrón', 'Bandido'];
    const checks = classes.map((label, i) => {
      const box = make('input', '', undefined, `tournament-class-${i}`); box.type = 'checkbox'; box.checked = true;
      win.add(box, [330 + (i % 2) * 70, 48 + Math.floor(i / 2) * 16, 14, 14]); win.label(label, [346 + (i % 2) * 70, 48 + Math.floor(i / 2) * 16, 54, 14]); return box;
    });
    const byte = (v: string) => Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
    win.command('Crear evento', [10, 172, 100, 24], () => send({
      id: X.CrearTorneo, minLevel: byte(minLevel.value), maxLevel: byte(maxLevel.value), slots: byte(slots.value), cost: Math.round(Number(cost.value) || 0),
      mage: +checks[0]!.checked, cleric: +checks[1]!.checked, warrior: +checks[2]!.checked, assassin: +checks[3]!.checked, bard: +checks[4]!.checked, druid: +checks[5]!.checked,
      paladin: +checks[6]!.checked, hunter: +checks[7]!.checked, worker: +checks[8]!.checked, pirate: +checks[9]!.checked, thief: +checks[10]!.checked, bandit: +checks[11]!.checked,
      map: Math.round(Number(map.value) || 0), x: byte(x.value), y: byte(y.value), name: name.value, rules: rules.value,
    } as unknown as ClientPacket)).id = 'tournament-create';
    win.command('Comenzar', [120, 172, 100, 24], () => send({ id: X.ComenzarTorneo } as ClientPacket)).id = 'tournament-start';
    win.command('Cancelar torneo', [230, 172, 110, 24], () => send({ id: X.CancelarTorneo } as ClientPacket)).id = 'tournament-cancel';
    // Busqueda del tesoro: cmdIniciarBusqueda_Click (0 = object, 2 = NPC), cmdCancelarBusqueda_Click (3).
    win.label('Busqueda del tesoro', [10, 212, 150, 15], 'vb-bold');
    const kind = combo(['Objeto misterioso', 'NPC'], 0); kind.id = 'treasure-kind'; win.add(kind, [10, 232, 150, 20]);
    win.command('Iniciar', [170, 231, 80, 22], () => send({ id: X.BusquedaTesoro, type: kind.selectedIndex === 0 ? 0 : 2 } as unknown as ClientPacket)).id = 'treasure-start';
    win.command('Cancelar', [260, 231, 80, 22], () => send({ id: X.BusquedaTesoro, type: 3 } as unknown as ClientPacket)).id = 'treasure-cancel';
    // Eventos con lobby: /CREAREVENTO <tipo> participantes nivelmin nivelmax [costo] and /CONFIGLOBBY start|list.
    win.label('Evento con lobby', [10, 272, 150, 15], 'vb-bold');
    const eventKind = combo(['Lobby', 'Captura de bandera', 'Cacería', 'DeathMatch', 'Abordaje'], 0); eventKind.id = 'event-kind'; win.add(eventKind, [10, 292, 150, 20]);
    const players = numberField('event-players', 'Participantes', 10, 322, '8'), lo = numberField('event-min', 'Nivel mínimo', 10, 346, '1'), hi = numberField('event-max', 'Nivel máximo', 10, 370, '47');
    const fee = numberField('event-fee', 'Inscripción', 170, 322, '0'), rounds = numberField('event-rounds', 'Rondas', 170, 346, '1');
    win.command('Crear el evento', [170, 292, 110, 22], () => {
      const word = ['LOBBY', 'CAPTURA', 'CACERIA', 'DEATHMATCH', 'NAVALCONQUEST'][eventKind.selectedIndex]!;
      line(word === 'CAPTURA' ? `/CREAREVENTO CAPTURA ${players.value} ${rounds.value} ${lo.value} ${hi.value} ${fee.value}` : word === 'LOBBY'
        ? `/CREAREVENTO LOBBY ${players.value} ${lo.value} ${hi.value}` : `/CREAREVENTO ${word} ${players.value} ${lo.value} ${hi.value} ${fee.value}`);
    }).id = 'event-create';
    win.command('Iniciar el evento', [330, 292, 120, 22], () => line('/CONFIGLOBBY START')).id = 'event-start';
    win.command('Ver anotados', [330, 322, 120, 22], () => line('/CONFIGLOBBY LIST')).id = 'event-list';
    win.command('Cancelar evento', [330, 352, 120, 22], () => send({ id: X.CancelarEvento } as ClientPacket)).id = 'event-cancel';
    win.closeButton([436, 2, 28, 24]);
    win.focus();
    return win;
  }

  // ---- frmLobbyBattleground ---------------------------------------------------------------------------------------------------------
  private syncLobby(session: Session) {
    const lobbies = session.extras.lobbies;
    if (!lobbies) { this.lobby?.close(); return; }
    this.lobby?.close();
    const win = new VbWindow(this.parent, { id: 'lobby-window', size: [560, 360], title: 'Battlegrounds', onClose: () => { this.lobby = undefined; session.extras.closeLobbies(); } });
    this.lobby = win;
    win.label('Descripción · Escenario · Niveles · Jugadores · Equipo · Precio', [10, 8, 540, 15], 'vb-bold');
    const list: VbList = win.list([10, 28, 540, 240], true);
    list.set(lobbies.map(l => `${l.description || `Sala ${l.id}`} · ${l.scenarioType} · Nv ${l.minLevel}-${l.maxLevel} · ${l.registeredPlayers}/${l.maxPlayers} (min ${l.minPlayers}) · ${l.teamSize}x${l.teamSize} · ${l.inscriptionPrice} oro${l.isPrivate ? ' · privada' : ''}`));
    list.el.id = 'lobby-list';
    win.label('Contraseña', [10, 282, 80, 15]); const password = win.input([90, 280, 140, 17], { light: true }) as HTMLInputElement; password.id = 'lobby-password';
    win.command('Participar', [250, 276, 110, 26], () => {
      const lobby = lobbies[list.index];
      if (lobby) { this.deps.send({ id: X.Participar, roomId: lobby.id, password: password.value } as unknown as ClientPacket); win.close(); }
    }).id = 'lobby-join';
    win.closeButton([524, 2, 28, 24]);
    win.focus();
  }

  // ---- ShowInteractionMenu --------------------------------------------------------------------------------------------------------
  closeMenu() { this.menu?.remove(); this.menu = undefined; windows.unwatch('interaction-menu'); }
  get menuOpen() { return !!this.menu; }
  /**
   * Right click (eInteract) at `tile`: the character on the tile, or on the one below it, gets a menu: a pet its commands (MenuNPC), a
   * player the player menu, or the GM menu when the clicking character is a GM and Shift is not held. NPCs get no menu. WriteLeftClick
   * is sent first, like the VB6 client, so the server also tells the player who it is.
   */
  interact(session: Session, tile: { x: number; y: number }, at: { x: number; y: number }, shift: boolean): boolean {
    const near = [...session.characters.values()];
    const found = near.find(c => c.x === tile.x && c.y === tile.y && c.charIndex !== session.charIndex) ?? near.find(c => c.x === tile.x && c.y === tile.y + 1 && c.charIndex !== session.charIndex);
    if (!found) return false;
    session.leftClick(tile.x, tile.y);
    const self = session.characters.get(session.charIndex ?? -1);
    const run = (line: string) => this.deps.runLine(line);
    const target = splitName(found.name).name;
    let items: [string, () => void][];
    if (found.npc === 2) items = this.petItems(session, run);
    else if (found.npc !== 0) return true;
    else if ((self?.privileges ?? 0) > 0 && !shift) items = this.gmItems(target, run);
    else items = [
      ['COMERCIAR', () => run('/COMERCIAR')],
      ['INVITAR GRUPO', () => session.sendPacket({ id: SC.WorkLeftClick, x: tile.x, y: tile.y, skill: GROUP_SKILL, counter: session.next('workLeftClick') })],
      ['PRIVADO', () => this.deps.whisper(target.replace(/ /g, '+'))],
      ['RETAR', () => this.openDuel([target])],
      ['DENUNCIAR', () => run(`/DENUNCIAR ${target}`)],
    ];
    this.showMenu(items, at);
    return true;
  }
  private petItems(session: Session, run: (line: string) => void): [string, () => void][] {
    const ask = (text: string, line: string) => showConfirm(this.parent, text, () => run(line));
    return [
      ['QUIETO', () => run('/QUIETO')], ['ACOMPAÑAR', () => run('/ACOMPAÑAR')], ['ACOMPAÑAR TODOS', () => run('/ACOMPAÑARTODOS')],
      ['LIBERAR', () => ask('¿Deseas liberar la mascota?', '/LIBERAR')], ['LIBERAR TODOS', () => ask('¿Deseas liberar todas las mascotas?', '/LIBERARTODOS')],
    ];
  }
  private gmItems(target: string, run: (line: string) => void): [string, () => void][] {
    const ask = (message: string, title: string) => window.prompt(message, '') ?? '';
    const pick = (lines: string[]) => lines[Math.floor(Math.random() * lines.length)]!.replace('¬1', target);
    // MenuGM.OpcionImg_Click: the three InputBox forms and the random anti-macro message.
    return [
      ['SUM', () => run(`/SUM ${target}`)], ['CONSULTA', () => run(`/CONSULTA ${target}`)], ['INFO', () => run(`/INFO ${target}`)], ['STAT', () => run(`/STAT ${target}`)],
      ['BAL', () => run(`/BAL ${target}`)], ['BOVEDA', () => run(`/BOV ${target}`)], ['INVENTARIO', () => run(`/INV ${target}`)], ['REVIVIR', () => run(`/revivir ${target}`)],
      ['ECHAR', () => run(`/echar ${target}`)], ['EJECUTAR', () => run(`/ejecutar ${target}`)],
      // "/SM" is not a command of ParseUserCommand: the classic client answers "El comando es invalido." and so do we.
      ['SEGUIR MOUSE', () => run(`/SM ${target}`)], ['PENAS', () => run(`/PENAS ${target}`)],
      ['SILENCIAR', () => { const reason = ask('Escriba el motivo del Silenciado.', `Silenciaso de ${target}`); if (reason) run(`/SILENCIAR ${target}@${reason}`); }],
      ['VIGILANTE', () => run(`/MENSAJEANTIMACRO ${target}@${pick(['¬1, ¿seguís ahí?', '¬1, respondé este mensaje por favor.', '¬1, ¿estás jugando?'])}`)],
      ['CARCEL', () => { const reason = ask('Escriba el motivo de Carcel .', `Carcel a ${target}`), time = reason ? ask('Escriba el tiempo de Carcel .', `Tiempo de Carcel a ${target}`) : ''; if (reason && time) run(`/CARCEL ${target}@${reason}@${time}`); else window.alert('Faltan datos. Repita la acción.'); }],
      ['BAN', () => { const reason = ask('Escriba el motivo del BAN.', `Baneo de ${target}`); if (reason) run(`/BAN ${target}@${reason}`); }],
    ];
  }
  private showMenu(items: [string, () => void][], at: { x: number; y: number }) {
    this.closeMenu();
    const menu = make('div', 'extras-menu', this.parent, 'interaction-menu'); menu.setAttribute('role', 'menu'); this.menu = menu;
    const height = items.length * 20 + 8;
    menu.style.left = `${Math.min(1024 - 150, at.x + 1)}px`; menu.style.top = `${at.y + height > 768 ? at.y - height : at.y}px`;
    for (const [label, action] of items) {
      const row = make('button', 'extras-menu-item', menu); row.type = 'button'; row.textContent = label; row.setAttribute('role', 'menuitem');
      row.addEventListener('click', event => { event.stopPropagation(); this.closeMenu(); action(); });
    }
    windows.watch('interaction-menu', () => this.menu === menu, () => this.closeMenu());
    const dismiss = (event: Event) => { if (!menu.contains(event.target as Node)) { this.closeMenu(); document.removeEventListener('pointerdown', dismiss, true); } };
    setTimeout(() => document.addEventListener('pointerdown', dismiss, true), 0);
  }

  /** `/RETAR`, `/RETO`, `/CHALLENGE` and the tournament organiser go through here (ExtrasOutcome.open). */
  openFor(window: 'duel' | 'tournament', names?: string[]) { if (window === 'duel') this.openDuel(names ?? []); else this.openTournament(); }
}
export { parseExtrasCommand };
