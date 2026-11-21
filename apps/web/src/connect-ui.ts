/*
 * The connect screens of the classic client (frmConnect states connect / account / create character), adapted 2026-11-21 from
 * frmConnect.frm render_MouseUp, engine.bas RenderConnect / RenderAccountCharacters / RenderUICrearPJ and ModLogin.bas.
 * Positions are the VB6 pixel values of the 1024x768 render surface. Copyright (C) 2022-2026 Noland Studios.
 * AGPL-3.0-or-later; see NOTICE. Artwork is read only from the local mount.
 */
import './connect.css';
import type { AccountCharacter } from '@ao/protocol';
import type { WorldRenderer } from './renderer.js';
import type { NewCharacter } from './session.js';
import { keyedSheet } from './grh-canvas.js';
import { fetchText, parseIni } from './assets.js';
import { CREATE_BODY, CREATE_BODY_SMALL, HOME_CITY, HOME_CITY_NAME, TEXT, headsFor, isSmallRace, raceModifiers, rotateClass, validateCharacterName } from './connect-text.js';

export type ConnectScreen = 'login' | 'account' | 'create' | 'none';
export interface ConnectHooks {
  enter(character: AccountCharacter): void;
  create(character: NewCharacter): void;
  logout(): void;
  close(): void;
  /** frmMensaje / the login assistant: a message for the player. */
  message(text: string): void;
  /** A confirmation (MsgBox vbYesNo). */
  confirm(text: string, yes: () => void): void;
  click(): void;
}
type Rect = readonly [number, number, number, number];
const MAX_CHARACTERS = 10;

/** Account screen hit areas (frmConnect.render_MouseUp, e_state_account_screen): left, top, width, height. */
export const ACCOUNT_RECTS: Record<'create' | 'delete' | 'transfer' | 'logout' | 'play' | 'close', Rect> = {
  create: [257, 711, 157, 36], delete: [15, 676, 97, 32], transfer: [981, 676, 19, 32], logout: [20, 22, 28, 23], play: [605, 712, 154, 33], close: [972, 22, 29, 23],
};
/** The slot of the character list under a point (DivX/DivY/ModX/ModY of render_MouseUp); 1-based, 0 when none. */
export function slotAt(x: number, y: number): number {
  const col = Math.floor((x - 207) / 131), row = Math.floor((y - 246) / 158);
  const modX = ((x - 207) % 131 + 131) % 131, modY = ((y - 246) % 158 + 158) % 158;
  if (col < 0 || col > 4 || row < 0 || row > 1 || modX >= 79 || modY >= 93) return 0;
  return 1 + col + row * 5;
}
/** Slot frame origin of the character i (RenderAccountCharacters: x = i*132 (+84), y = 283 or 440). */
export const slotOrigin = (i: number) => ({ x: (i > 5 ? i * 132 - 5 * 132 : i * 132) + 84, y: i > 5 ? 440 : 283 });
/** Name colour index of a status (HandleAccountCharacterList: 0 criminal 50, 1 citizen 49, 2 chaos 6, 3 army 8, 4..7 GM tiers). */
export const ACCOUNT_COLOR: Record<number, number> = { 0: 50, 1: 49, 2: 6, 3: 8, 4: 1, 5: 3, 6: 4, 7: 5 };
/** Boats and the dwarven exoskeleton (RenderAccountCharacters enBarca): no head or equipment is drawn. */
const BOATS = new Set([84, 85, 86, 87, 1263, 1264, 1265, 1266, 1267, 1268, 1269, 1270, 1271, 1272, 1273, 1274, 4596]);

const px = (rect: Rect) => `left:${rect[0]}px;top:${rect[1]}px;width:${rect[2]}px;height:${rect[3]}px`;

export class ConnectUI {
  readonly stage = document.createElement('div');
  private readonly login = document.createElement('div');
  private readonly account = document.createElement('div');
  private readonly create = document.createElement('div');
  private screen: ConnectScreen = 'none';
  private characters: AccountCharacter[] = [];
  private selected = 0;
  private slotsBox = document.createElement('div');
  private info = document.createElement('div');
  private assistantText = document.createElement('div');
  private assistantIndex = -1;
  private maximumReached = false;
  // Character creation state (frmCrearPersonaje lists).
  private race = 0; private gender = 0; private cls = 0; private head = 0; private heading = 3;
  private heads: number[] = []; private modifiers = [0, 0, 0, 0, 0];
  private ini: Map<string, Map<string, string>> | undefined;
  private createCanvas = document.createElement('canvas');
  private nameInput = document.createElement('input');
  private labels = new Map<string, HTMLElement>();
  private generation = 0;

  constructor(parent: HTMLElement, private readonly renderer: WorldRenderer, private readonly hooks: ConnectHooks) {
    this.stage.id = 'connect-stage'; this.stage.hidden = true;
    this.login.className = 'cs-screen cs-login'; this.account.className = 'cs-screen cs-account'; this.create.className = 'cs-screen cs-create';
    this.stage.append(this.login, this.account, this.create);
    parent.append(this.stage);
    void this.buildLogin(); void this.buildAccount(); void this.buildCreate();
    void fetchText('init/sp_localindex.dat').then(text => { this.ini = parseIni(text); this.applyRace(); }).catch(() => undefined);
  }

  get current() { return this.screen; }
  get selectedCharacter() { return this.characters[this.selected - 1]; }

  setScreen(screen: ConnectScreen) {
    if (screen === this.screen) return;
    this.screen = screen;
    this.stage.hidden = screen === 'none';
    this.stage.dataset.screen = screen;
    this.login.hidden = screen !== 'login'; this.account.hidden = screen !== 'account'; this.create.hidden = screen !== 'create';
    if (screen === 'login' && this.assistantIndex < 0) this.say(TEXT.welcome);
    if (screen === 'create') { this.startCreate(); this.nameInput.focus(); }
  }
  /** TextoAlAsistente: the speech line over the Creador del Mundo of the login screen. */
  say(text: string) {
    this.assistantText.textContent = text; this.assistantText.classList.remove('cs-pop'); void this.assistantText.offsetWidth; this.assistantText.classList.add('cs-pop');
  }

  // ---- login screen -------------------------------------------------------------------------------------------------
  private async buildLogin() {
    const grh = (id: number, x: number, y: number, center = false, cls = '') => this.grh(this.login, id, x, y, center, cls);
    await Promise.all([grh(1172, 90, 10, false, 'cs-logo'), grh(1169, 0, 0, false, 'cs-marco'), grh(16577, 810, 655)]);
    this.assistantText.className = 'cs-assistant-text'; this.assistantText.setAttribute('role', 'status');
    this.login.append(this.assistantText);
    const npc = document.createElement('canvas'); npc.className = 'cs-assistant'; npc.width = 64; npc.height = 96; npc.style.cssText = 'left:469px;top:300px';
    npc.title = TEXT.worldCreator;
    npc.addEventListener('click', () => { this.assistantIndex = (this.assistantIndex + 1 + Math.floor(Math.random() * 3)) % TEXT.assistant.length; this.say(TEXT.assistant[this.assistantIndex]!); });
    this.login.append(npc);
    const name = document.createElement('div'); name.className = 'cs-npc-name'; name.innerHTML = `Gulfas Morgolock<br><span>${TEXT.worldCreator}</span>`;
    this.login.append(name);
    await this.drawCharacter(npc, { body: 123, head: 118, helmet: 13, weapon: 6 }, 3, 21, 33);
  }

  // ---- account screen -----------------------------------------------------------------------------------------------
  private async buildAccount() {
    await Promise.all([this.grh(this.account, 4531, 0, 0, false, 'cs-bg'), this.grh(this.account, 3839, 0, 0, false, 'cs-ui')]);
    this.slotsBox.className = 'cs-slots'; this.info.className = 'cs-info';
    this.account.append(this.slotsBox, this.info);
    const button = (name: keyof typeof ACCOUNT_RECTS, label: string, run: () => void) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'cs-hit'; b.style.cssText = px(ACCOUNT_RECTS[name]); b.setAttribute('aria-label', label); b.title = label;
      b.addEventListener('click', () => { this.hooks.click(); run(); }); this.account.append(b); return b;
    };
    button('create', 'Crear personaje', () => {
      if (this.characters.length >= MAX_CHARACTERS) { this.hooks.message(TEXT.characterLimit); return; }
      this.setScreen('create');
    });
    button('delete', 'Borrar personaje', () => {
      const character = this.selectedCharacter; if (!character) return;
      this.hooks.confirm(TEXT.deleteAsk(character.name), () => this.hooks.message(TEXT.deleteUnsupported));
    });
    button('transfer', 'Transferir personaje', () => this.hooks.message(TEXT.deleteUnsupported.replace('borrar', 'transferir').replace('el borrado', 'la transferencia')));
    button('logout', 'Volver al ingreso', () => this.hooks.logout());
    button('play', 'Jugar', () => this.play());
    button('close', 'Cerrar', () => this.hooks.close());
    // Slot hit areas follow the VB6 grid, not the art frames: one button per slot.
    for (let i = 1; i <= MAX_CHARACTERS; i++) {
      const col = (i - 1) % 5, row = Math.floor((i - 1) / 5);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'cs-hit cs-slot-hit'; b.dataset.slot = String(i);
      b.style.cssText = px([207 + 131 * col, 246 + 158 * row, 79, 93]); b.hidden = true;
      b.addEventListener('click', () => this.select(i)); b.addEventListener('dblclick', () => { this.select(i); this.play(); });
      this.account.append(b);
    }
  }
  private play() {
    const character = this.selectedCharacter;
    if (!character) return;
    this.hooks.click(); this.hooks.enter(character);
  }
  private select(slot: number) {
    if (slot < 1 || slot > this.characters.length) return;
    this.selected = slot; this.renderSlots();
  }
  /** HandleAccountCharacterList: the first character is selected. */
  showAccount(characters: AccountCharacter[]) {
    this.characters = characters.slice(0, MAX_CHARACTERS); this.selected = this.characters.length ? 1 : 0;
    this.maximumReached = this.characters.length >= MAX_CHARACTERS;
    this.renderSlots();
    this.setScreen('account');
  }
  private renderSlots() {
    const generation = ++this.generation;
    this.slotsBox.replaceChildren();
    this.account.querySelectorAll<HTMLButtonElement>('.cs-slot-hit').forEach(b => { b.hidden = Number(b.dataset.slot) > this.characters.length; b.setAttribute('aria-label', this.characters[Number(b.dataset.slot) - 1]?.name ?? ''); });
    this.characters.forEach((character, index) => {
      const slot = index + 1, { x, y } = slotOrigin(slot);
      const box = document.createElement('div'); box.className = `cs-slot${slot === this.selected ? ' cs-selected' : ''}`; box.style.cssText = `left:${x - 8}px;top:${y - 20}px`;
      const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 96; box.append(canvas);
      const color = this.renderer.pjColor(ACCOUNT_COLOR[character.status] ?? 50);
      const name = document.createElement('div'); name.className = 'cs-slot-name'; name.textContent = character.name; name.style.color = `rgb(${color.r},${color.g},${color.b})`; box.append(name);
      this.slotsBox.append(box);
      const boat = BOATS.has(character.body);
      void this.drawCharacter(canvas, { body: character.body, head: boat ? 0 : character.head, helmet: boat ? 0 : character.helmet, shield: boat ? 0 : character.shield, weapon: boat ? 0 : character.weapon }, 3, 23, 30, boat ? 0 : character.backpack)
        .then(() => { if (generation !== this.generation) canvas.remove(); });
    });
    const character = this.selectedCharacter;
    this.info.replaceChildren();
    if (!character) return;
    const line = (text: string, top: number, color = '#fff') => { const d = document.createElement('div'); d.textContent = text; d.style.top = `${top}px`; d.style.color = color; this.info.append(d); };
    const color = this.renderer.pjColor(ACCOUNT_COLOR[character.status] ?? 50);
    line(character.name, 566, `rgb(${color.r},${color.g},${color.b})`);
    line(`${TEXT.classLabel}${TEXT.classes[character.characterClass - 1] ?? ''}`, 590);
    line(`${TEXT.levelLabel}${character.level}`, 608);
    line(`${this.mapName(character.map)}`, 640);
  }
  private mapName(map: number) { return map > 0 ? `Mapa ${map}` : ''; }

  // ---- character creation -------------------------------------------------------------------------------------------
  private async buildCreate() {
    await Promise.all([this.grh(this.create, 4531, 0, 0, false, 'cs-bg'), this.grh(this.create, 1171, 494, 190, true, 'cs-logo'), this.grh(this.create, 727, 475, 545, true), this.grh(this.create, 1169, 0, 0, false, 'cs-marco')]);
    const text = (id: string, content: string, x: number, y: number, cls = '') => {
      const d = document.createElement('div'); d.className = `cs-text ${cls}`.trim(); d.textContent = content; d.style.cssText = `left:${x}px;top:${y}px`; this.create.append(d); this.labels.set(id, d); return d;
    };
    text('title', TEXT.creation, 0, 118, 'cs-title').style.width = '1024px';
    text('nameLabel', TEXT.name, 460, 200, 'cs-bold');
    this.nameInput.className = 'cs-name'; this.nameInput.maxLength = 18; this.nameInput.autocomplete = 'off'; this.nameInput.spellcheck = false; this.nameInput.setAttribute('aria-label', TEXT.name);
    this.nameInput.style.cssText = 'left:416px;top:224px;width:142px;height:20px';
    this.nameInput.addEventListener('input', () => this.drawPreview());
    this.nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.submitCreate(); });
    this.create.append(this.nameInput);
    // Selectors: label, box, value, arrow rects (frmConnect.render_MouseUp for e_state_createchar_screen).
    const selector = (id: string, label: string, lx: number, ly: number, bx: number, by: number, left: Rect, right: Rect, step: (forward: boolean) => void, enabled = true) => {
      text(`${id}Label`, label, lx, ly, 'cs-bold');
      const box = document.createElement('div'); box.className = 'cs-box'; box.style.cssText = `left:${bx}px;top:${by}px`; this.create.append(box);
      const value = text(id, '', bx, by + 2, 'cs-value'); value.style.width = '95px';
      for (const [rect, forward, glyph] of [[left, false, '<'], [right, true, '>']] as const) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'cs-hit cs-arrow'; b.style.cssText = px(rect); b.textContent = glyph; b.setAttribute('aria-label', `${label} ${forward ? 'siguiente' : 'anterior'}`);
        b.disabled = !enabled; b.addEventListener('click', () => { this.hooks.click(); step(forward); }); this.create.append(b);
      }
    };
    const wrap = (n: number, forward: boolean, size: number) => (n + (forward ? 1 : size - 1)) % size;
    selector('class', TEXT.class, 585, 255, 557, 275, [540, 276, 14, 16], [658, 276, 14, 16], f => { this.cls = rotateClass(this.cls, f); this.refresh(); });
    selector('race', TEXT.race, 587, 305, 557, 320, [539, 321, 14, 16], [657, 321, 15, 17], f => { this.race = wrap(this.race, f, TEXT.races.length); this.applyRace(true); });
    selector('gender', TEXT.gender, 345, 255, 322, 275, [298, 276, 16, 16], [415, 277, 16, 18], f => { this.gender = wrap(this.gender, f, 2); this.applyRace(true); });
    selector('home', TEXT.home, 345, 305, 322, 320, [298, 321, 16, 16], [415, 321, 16, 16], () => undefined, false);
    text('attributes', TEXT.attributes, 575, 347, 'cs-bold');
    TEXT.attribute.forEach((name, i) => { text(`attr${i}`, name, 525, 372 + 30 * i); text(`val${i}`, '', 645, 375 + 30 * i, 'cs-attr'); });
    const aspect = document.createElement('div'); aspect.className = 'cs-aspect'; aspect.style.cssText = 'left:275px;top:367px;width:185px;height:148px'; this.create.append(aspect);
    text('aspect', 'Aspecto', 340, 345, 'cs-bold'); text('headLabel', 'Cabeza', 345, 370);
    this.createCanvas.className = 'cs-preview'; this.createCanvas.width = 96; this.createCanvas.height = 110; this.createCanvas.style.cssText = 'left:301px;top:386px';
    this.create.append(this.createCanvas);
    const arrow = (rect: Rect, glyph: string, label: string, run: () => void, big = false) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = `cs-hit cs-arrow${big ? ' cs-big' : ''}`; b.style.cssText = px(rect); b.textContent = glyph; b.setAttribute('aria-label', label);
      b.addEventListener('click', () => { this.hooks.click(); run(); }); this.create.append(b);
    };
    const step = (delta: number) => { this.head = (this.head + delta + this.heads.length) % Math.max(1, this.heads.length); this.drawPreview(); };
    arrow([325, 371, 19, 16], '<', 'Cabeza anterior', () => step(-1)); arrow([394, 373, 17, 13], '>', 'Cabeza siguiente', () => step(1));
    arrow([282, 428, 40, 40], '<', 'Girar', () => { this.heading = this.heading + 1 >= 5 ? 1 : this.heading + 1; this.drawPreview(); }, true);
    arrow([412, 427, 34, 43], '>', 'Girar', () => { this.heading = this.heading - 1 <= 0 ? 4 : this.heading - 1; this.drawPreview(); }, true);
    arrow([289, 525, 160, 37], 'Volver', 'Volver', () => this.setScreen('account'));
    arrow([532, 525, 160, 37], 'Crear personaje', 'Crear personaje', () => this.submitCreate());
    this.create.querySelectorAll('.cs-arrow').forEach(el => { if ((el as HTMLElement).textContent!.length > 1) el.classList.add('cs-transparent'); });
    this.refresh();
  }
  /** IniciarCrearPj: Humano, Hombre, Mago, the second head of the list. */
  private startCreate() {
    this.race = 0; this.gender = 0; this.cls = 0; this.heading = 3; this.nameInput.value = '';
    this.heads = headsFor(this.race, this.gender); this.head = Math.min(1, this.heads.length - 1);
    this.applyRace();
  }
  /** lstRaza_Click / lstGenero_Click: DameOpciones picks a random head of the new list. */
  private applyRace(randomHead = false) {
    this.heads = headsFor(this.race, this.gender);
    if (randomHead) this.head = Math.floor(Math.random() * this.heads.length);
    this.modifiers = this.ini ? raceModifiers(this.ini, this.race) : [0, 0, 0, 0, 0];
    this.refresh();
  }
  private refresh() {
    const set = (id: string, text: string) => { const el = this.labels.get(id); if (el) el.textContent = text; };
    set('class', TEXT.classes[this.cls]!); set('race', TEXT.races[this.race]!); set('gender', TEXT.genders[this.gender]!); set('home', HOME_CITY_NAME);
    this.modifiers.forEach((mod, i) => {
      const value = 18 + mod, el = this.labels.get(`val${i}`); if (!el) return;
      el.textContent = String(value); el.style.color = value > 18 ? '#0f0' : value < 18 ? '#f00' : '#fff';
    });
    this.drawPreview();
  }
  private async drawPreview() {
    const canvas = this.createCanvas, head = this.heads[this.head] ?? 1;
    const small = isSmallRace(this.race);
    ctxClear(canvas);
    await this.drawCharacter(canvas, { body: small ? CREATE_BODY_SMALL : CREATE_BODY, head }, this.heading, 48, 60);
    const name = this.nameInput.value;
    const ctx = canvas.getContext('2d')!; ctx.font = 'bold 12px Tahoma, Arial'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgb(0,128,190)'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    if (name) { ctx.strokeText(name, 48, 104); ctx.fillText(name, 48, 104); }
  }
  /** Crear: ValidarNombre, then WriteLoginNewChar. The server answers by entering the character or with ShowMessageBox. */
  private submitCreate() {
    const name = this.nameInput.value.replace(/ +$/, '');
    const problem = validateCharacterName(name);
    if (problem) { this.hooks.message(problem); return; }
    const head = this.heads[this.head];
    if (head === undefined) { this.hooks.message(TEXT.pickHead); return; }
    this.hooks.create({ name, race: this.race + 1, gender: this.gender + 1, characterClass: this.cls + 1, head, home: HOME_CITY });
  }

  // ---- drawing helpers ----------------------------------------------------------------------------------------------
  /** A Grh placed like Draw_Grh (the `center` flag puts the bitmap's middle on a 32 px tile: x - w/2 + 16, y - h + 32). */
  private async grh(parent: HTMLElement, id: number, x: number, y: number, center: boolean, cls = '') {
    const frame = await this.renderer.graphic(id);
    const el = document.createElement('div'); el.className = `cs-grh ${cls}`.trim();
    const left = center ? x - Math.floor(frame.width / 2) + 16 : x, top = center ? y - frame.height + 32 : y;
    el.style.cssText = `left:${left}px;top:${top}px;width:${frame.width}px;height:${frame.height}px;background:url("/ao-assets/Graficos/${frame.file}.png") -${frame.x}px -${frame.y}px no-repeat`;
    parent.prepend(el); // art goes under the controls added so far
    return el;
  }
  /** A stationary character at the tile origin (ox, oy) of a canvas, like Char_Render (frame centred on the tile, bottom aligned). */
  private async drawCharacter(canvas: HTMLCanvasElement, char: { body: number; head: number; helmet?: number; shield?: number; weapon?: number }, heading: number, ox: number, oy: number, backpack = 0) {
    await this.renderer.graphic(1);
    const ctx = canvas.getContext('2d')!;
    const token = (drawTokens.get(canvas) ?? 0) + 1; drawTokens.set(canvas, token);
    const paint = async (layers: ReturnType<WorldRenderer['characterLayers']>) => {
      for (const layer of layers) {
        if (drawTokens.get(canvas) !== token) return; // a newer draw owns this canvas
        const frame = layer.animation.frames[0]!;
        ctx.drawImage(await keyedSheet(frame.file), frame.x, frame.y, frame.width, frame.height, ox + layer.x + Math.floor((32 - frame.width) / 2), oy + 32 + layer.y - frame.height, frame.width, frame.height);
      }
    };
    ctxClear(canvas);
    if (backpack) await paint(this.renderer.characterLayers({ body: backpack, head: 0 }, heading));
    await paint(this.renderer.characterLayers(char, heading));
  }
}
const drawTokens = new WeakMap<HTMLCanvasElement, number>();
function ctxClear(canvas: HTMLCanvasElement) { canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height); }
