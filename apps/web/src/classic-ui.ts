/*
 * Classic controls adapted from frmMain.frm, clsGraphicalList and
 * clsGrapchicalInventory. Copyright (C) 2022-2026 Noland Studios.
 * AGPL-3.0-or-later; see NOTICE. Artwork is read only from the local mount.
 */
import { fetchText, parseIni, assetUrl } from './assets.js';
import type { Ini } from './assets.js';
import type { Session } from './session.js';
import type { WorldRenderer } from './renderer.js';
import { loadInterface, loadedInterfaceUrl } from './interface-assets.js';
import { KeysClientPacketId } from '@ao/protocol';
import { renderMessage } from './chat-console.js';
import { loadSpellTables, swapSpellSlots } from './spells.js';
import { ObjectCatalog, loadObjectIni } from './object-catalog.js';

export const element = <T extends HTMLElement = HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element ${id}`);
  return node as T;
};
const text = (id: string, value: string | number) => { element(id).textContent = String(value); };
const ratio = (value: number | undefined, max: number | undefined) => max && value !== undefined ? Math.min(1, Math.max(0, value / max)) : 0;

/** e_ElementalTags (Fire 1, Water 2, Earth 4, Wind 8) and e_ElementalTagIconsGrhIndex; CORNER_X/CORNER_Y of clsGrapchicalInventory.DrawInventory. */
export const ELEMENTAL_ICONS = [{ tag: 1, grh: 10484 }, { tag: 2, grh: 10486 }, { tag: 4, grh: 10483 }, { tag: 8, grh: 10485 }] as const;
export const ELEMENTAL_CORNERS = [[23, 0], [0, 0], [23, 21], [0, 21]] as const;
export const elementalTagIcons = (tags: number) => ELEMENTAL_ICONS.filter(icon => (tags & icon.tag) !== 0);
export class ClassicUI {
  private objects: Ini = new Map();
  private spells: Ini = new Map();
  private sheets = new Map<number, Promise<HTMLImageElement>>();
  private revision = -1;
  private session: Session | undefined;
  private generation = 0;
  private selectedItem = 0;
  private selectedSpell = 0;
  private panelSeq = 0;
  private slotButtons: HTMLButtonElement[] = [];
  private menuButtons = new Map<string, HTMLButtonElement>();
  private menuActions = new Map<string, () => void>();
  private safeButtons = new Map<string, HTMLButtonElement>();
  /** Double click on an inventory item (picInv_DblClick -> UserItemClick); set by main.ts. */
  onActivate: ((slot: number) => void) | undefined;
  private catalog: ObjectCatalog | undefined;

  constructor(private readonly renderer: WorldRenderer, private readonly report: (message: string) => void) {
    for (let i = 0; i < 42; i++) {
      const button = document.createElement('button');
      button.className = 'inventory-slot'; button.type = 'button';
      button.style.left = `${i % 6 * 35}px`;
      button.style.top = `${Math.floor(i / 6) * 35 + (i >= 24 ? 9 : 0)}px`;
      button.setAttribute('aria-label', `Casilla ${i + 1}`);
      button.addEventListener('click', () => {
        const item = this.session?.ui.inventory.get(i + 1);
        this.selectedItem = item ? i + 1 : 0; this.markItem(); // the object's text is the ObjLbl hover label (inventory-extras.ts), not a console line
      });
      button.addEventListener('dblclick', () => { if (this.session?.ui.inventory.has(i + 1)) { this.selectedItem = i + 1; this.markItem(); this.onActivate?.(i + 1); } });
      element('inventory').append(button); this.slotButtons.push(button);
    }
    // frmMain.inventoryClick / hechizosClick: a followed client reports the panel it shows (WriteNotifyInventarioHechizos).
    element('inventory-tab').onclick = () => { this.showSpells(false); this.session?.spells.notifyPanel(1, Math.max(0, this.selectedSpell - 1), 0); };
    element('spells-tab').onclick = () => { this.showSpells(true); this.session?.spells.notifyPanel(2, Math.max(0, this.selectedSpell - 1), 0); };
    element('spell-up').onclick = () => this.moveSpell(true);
    element('spell-down').onclick = () => this.moveSpell(false);
    element('spells').addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); this.selectSpell(this.selectedSpell + (event.key === 'ArrowDown' ? 1 : -1));
      }
    });
    // imgSpellInfo_Click: ask the server (WriteSpellInfo); it answers with a HECINF console line.
    element('spell-info').onclick = () => {
      const spell = this.session?.ui.spells.get(this.selectedSpell);
      if (this.session?.ready && spell && spell.index > 0) this.session.spells.info(this.selectedSpell);
    };
    // cmdLanzar_Click -> UseSpell: WriteCastSpell, then the server asks for a target (WorkRequestTarget).
    element('cast').onclick = () => {
      const spell = this.session?.ui.spells.get(this.selectedSpell);
      if (this.session?.ready && spell && spell.index > 0) this.session.spells.cast(this.selectedSpell, this.spellName(spell.index));
    };
    // OpcionesBoton opens frmOpciones and imgManual / imgMAO the web pages (main.ts, frm-main-buttons.ts).
    element('menu-tab').onclick = () => this.showMenu(true);
    element('stats-tab').onclick = () => this.showMenu(false);
    // Image controls inside panelInf, frmMain.frm. Their artwork is already
    // present in ventanaprincipal_info.bmp; unsupported actions stay explicit.
    for (const [name, x, y] of [['Skins', 9, 37], ['Grupo', 9, 75], ['Clanes', 9, 113], ['Retos', 9, 151], ['Llavero', 135, 37], ['Quests', 136, 75], ['Hogar', 135, 113], ['Estadísticas', 135, 151]] as const) {
      const button = document.createElement('button'); button.className = 'hotspot'; button.type = 'button';
      button.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:36px;height:33px`;
      button.setAttribute('aria-label', name); button.setAttribute('aria-disabled', 'true');
      button.onclick = () => { const action = this.menuActions.get(name); if (action) action(); else this.session?.ui.message(`${name} aún no está disponible.`); };
      this.menuButtons.set(name, button);
      element('menu-actions').append(button);
    }
    // The five safe toggles of panelInf (frmMain ImgSegParty, ImgSegClan, ImgSeg, ImgSegResu, ImgLegionarySecure), 408 twips (27.2 px) is only the designed slot: the Image controls have no Stretch, so VB6 sizes each to its 34x34 bitmap from Left/Top (7.2,204 ...) and the picture covers the baked slot art in ventanaprincipal_info.
    for (const [key, x, name, tip, act] of [
      ['party', 7.2, 'seguro-party', 'Seguro de grupo', () => this.session?.sendAction({ id: KeysClientPacketId.PartySafeToggle })],
      ['clan', 42.4, 'seguro-clan', 'Seguro de clan', () => this.session?.toggleSafe('clan')],
      ['attack', 76.8, 'seguro-ciudadano', 'Seguro de ataque', () => this.session?.sendAction({ id: KeysClientPacketId.SafeToggle })],
      ['resu', 112, 'fantasma', 'Seguro de resurrección', () => this.session?.toggleSafe('resu')],
      ['legion', 147.2, 'demonio', 'Seguro de legión', () => this.session?.toggleSafe('legion')],
    ] as const) {
      const button = document.createElement('button'); button.className = 'safe-toggle'; button.type = 'button'; button.id = `safe-${key}`;
      button.dataset.art = name; button.title = tip; button.setAttribute('aria-label', tip);
      button.style.cssText = `position:absolute;left:${x}px;top:204px;width:34px;height:34px;border:0;padding:0;background-size:100% 100%`;
      button.onclick = () => { try { act(); } catch (error) { this.report(String(error)); } };
      element('menu-actions').append(button); this.safeButtons.set(key, button);
    }
    for (const id of ['hp', 'mana', 'stamina', 'water', 'food', 'experience']) element(`${id}-fill`).style.width = '0px';
  }
  /** Wire a frmMain info-panel button to its form; buttons nobody wired keep the "aún no está disponible" line. */
  bindMenu(name: string, action: () => void) { this.menuActions.set(name, action); this.menuButtons.get(name)?.removeAttribute('aria-disabled'); }
  async init() {
    const imageTasks = [...document.querySelectorAll<HTMLElement>('[data-interface]')].map(async node => {
      const url = await loadInterface(node.dataset.interface!, !node.hasAttribute('data-unlocalized'));
      if (node instanceof HTMLImageElement) { node.src = url; await node.decode(); }
      else node.style.backgroundImage = `url("${url}")`;
    });
    const [objects, spells] = await Promise.all([
      loadObjectIni(), fetchText('Dat/Hechizos.dat'), ...imageTasks,
      this.sheet(135), this.renderer.graphic(47743),
      ...['centrohechizo', 'centroinventario', 'ventanaprincipal_info'].map(name => loadInterface(name)),
      ...['seguro-party', 'seguro-clan', 'seguro-ciudadano', 'fantasma', 'demonio'].flatMap(name => [`boton-${name}-on`, `boton-${name}-off`].map(file => loadInterface(file).catch(() => ''))),
    ]);
    this.objects = objects; this.catalog = new ObjectCatalog(objects); this.spells = parseIni(spells);
    await loadSpellTables(this.spells).catch(error => this.report(String(error)));
    await this.renderInventory();
    element('classic').dataset.uiReady = 'true';
  }
  private sheet(file: number) {
    let pending = this.sheets.get(file);
    if (!pending) {
      const image = new Image(); image.src = assetUrl(`Graficos/${file}.png`);
      pending = image.decode().then(() => image); this.sheets.set(file, pending);
    }
    return pending;
  }
  /** Slot selected in the main inventory; 200 is the gold pseudo-slot (FLAGORO). */
  get selectedSlot() { return this.selectedItem; }
  selectGold() { this.selectedItem = 200; this.markItem(); }
  /** clsGrapchicalInventory.InvSelectedItem = slot (0 clears); the right-drag end and the delete button use it. */
  selectSlot(slot: number) { this.selectedItem = slot; this.markItem(); }
  /** The 32x32 item picture the inventory draws, shared with the shop window. */
  async itemArt(grh: number): Promise<HTMLCanvasElement> {
    const frame = await this.renderer.graphic(grh), sheet = await this.sheet(frame.file);
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; canvas.className = 'item-art';
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(sheet, frame.x, frame.y, frame.width, frame.height, Math.floor((32 - frame.width) / 2), 32 - frame.height, frame.width, frame.height);
    const pixels = ctx.getImageData(0, 0, 32, 32);
    for (let j = 0; j < pixels.data.length; j += 4) if (!pixels.data[j] && !pixels.data[j + 1] && !pixels.data[j + 2]) pixels.data[j + 3] = 0;
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  }
  /** An elemental tag icon at its own size (clsGrapchicalInventory draws it at a slot corner, e_ElementalTagIconsGrhIndex). */
  async tagIcon(grh: number): Promise<HTMLCanvasElement> {
    const frame = await this.renderer.graphic(grh), sheet = await this.sheet(frame.file);
    const canvas = document.createElement('canvas'); canvas.width = frame.width; canvas.height = frame.height; canvas.className = 'tag-icon';
    canvas.getContext('2d')!.drawImage(sheet, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
    return canvas;
  }
  async slotBackground(grh: number): Promise<{ image: string; position: string }> {
    const frame = await this.renderer.graphic(grh);
    return { image: `url("${assetUrl(`Graficos/${frame.file}.png`)}")`, position: `-${frame.x}px -${frame.y}px` };
  }
  private markItem() {
    this.slotButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(i + 1 === this.selectedItem)));
  }
  private showSpells(show: boolean) {
    element<HTMLImageElement>('panel-art').src = loadedInterfaceUrl(show ? 'centrohechizo' : 'centroinventario');
    element('inventory').hidden = show;
    for (const id of ['spells', 'cast', 'spell-info', 'spell-up', 'spell-down']) element(id).hidden = !show;
    element('inventory-tab').setAttribute('aria-selected', String(!show));
    element('spells-tab').setAttribute('aria-selected', String(show));
  }
  private showMenu(show: boolean) {
    element<HTMLImageElement>('stats-art').src = loadedInterfaceUrl(show ? 'ventanaprincipal_info' : 'ventanaprincipal_stats');
    element('stats-panel').querySelectorAll<HTMLElement>('.bar, .label').forEach(node => { node.hidden = show; });
    element('menu-actions').hidden = !show;
  }
  private spellName(index: number) { return this.spells.get(`hechizo${index}`)?.get('nombre') ?? `Hechizo ${index}`; }
  /** cmdMoverHechi_Click: swap the entries locally and tell the server (WriteMoveSpell). */
  private moveSpell(up: boolean) {
    const session = this.session;
    if (!session?.ready || !session.ui.spells.has(this.selectedSpell)) return;
    const slot = this.selectedSpell, target = swapSpellSlots(session.ui.spells, slot, up);
    if (target === slot) return;
    session.spells.move(up, slot);
    this.selectedSpell = target; session.ui.revision++;
  }
  private selectSpell(slot: number) {
    const rows = [...element('spells').children] as HTMLElement[];
    if (!rows.length) return;
    this.selectedSpell = Math.min(rows.length, Math.max(1, slot));
    element('spells').setAttribute('aria-activedescendant', `spell-${this.selectedSpell}`);
    for (const row of rows) row.setAttribute('aria-selected', String(Number(row.dataset.slot) === this.selectedSpell));
    rows[this.selectedSpell - 1]?.scrollIntoView({ block: 'nearest' });
  }
  private async renderInventory() {
    const generation = ++this.generation;
    const state = this.session?.ui;
    await Promise.all(this.slotButtons.map(async (button, i) => {
      const slot = i + 1;
      const locked = slot > 24 + (state?.unlockedRows ?? 0) * 6;
      const background = await this.renderer.graphic(locked ? 1122 : slot > 24 ? 47742 : 47743);
      const item = state?.inventory.get(slot);
      const object = item ? this.objects.get(`obj${item.object}`) : undefined;
      let canvas: HTMLCanvasElement | undefined;
      if (item && object) {
        const frame = await this.renderer.graphic(Number(object.get('grhindex')));
        const sheet = await this.sheet(frame.file);
        canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; canvas.className = 'item-art';
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(sheet, frame.x, frame.y, frame.width, frame.height, Math.floor((32 - frame.width) / 2), 32 - frame.height, frame.width, frame.height);
        const pixels = ctx.getImageData(0, 0, 32, 32);
        for (let j = 0; j < pixels.data.length; j += 4) if (!pixels.data[j] && !pixels.data[j + 1] && !pixels.data[j + 2]) pixels.data[j + 3] = 0;
        ctx.putImageData(pixels, 0, 0);
      }
      if (generation !== this.generation) return;
      button.style.backgroundImage = `url("${assetUrl(`Graficos/${background.file}.png`)}")`;
      button.style.backgroundPosition = `-${background.x}px -${background.y}px`;
      const name = item ? object?.get('name') ?? `Objeto ${item.object}` : locked ? 'Bloqueada' : 'Vacía';
      button.title = name; button.setAttribute('aria-label', `Casilla ${slot}: ${name}${item ? ` × ${item.amount}` : ''}`);
      button.setAttribute('aria-disabled', String(locked));
      button.replaceChildren();
      if (canvas) button.append(canvas);
      if (item) {
        const amount = document.createElement('span'); amount.className = 'quantity'; amount.textContent = String(item.amount); button.append(amount);
        if (item.equipped) { const equipped = document.createElement('span'); equipped.className = 'equipped'; equipped.textContent = '+'; button.append(equipped); }
        // The tags of the slot (crafted) or of the object itself, in the fixed order Fire, Water, Earth, Wind, one corner each.
        const tags = elementalTagIcons(item.elementalTags | Number(object?.get('elementaltags') ?? 0));
        const icons = await Promise.all(tags.map((icon, n) => this.tagIcon(icon.grh).then(canvas => { Object.assign(canvas.style, { left: `${ELEMENTAL_CORNERS[n]![0]}px`, top: `${ELEMENTAL_CORNERS[n]![1]}px` }); return canvas; }).catch(() => undefined)));
        if (generation === this.generation) for (const icon of icons) if (icon) button.append(icon);
      }
    }));
    this.markItem();
  }
  update(session: Session | undefined) {
    if (this.session !== session) {
      this.session = session; this.revision = -1; this.selectedItem = 0; this.selectedSpell = 0; this.showSpells(false); this.showMenu(false);
    }
    if (!session) return;
    // HandleGetInventarioHechizos: a GM following this player flips the panel (and the selected spell row) remotely.
    const request = session.spells.panelRequest;
    if (request && request.seq !== this.panelSeq) {
      this.panelSeq = request.seq;
      if (request.value === 1) this.showSpells(false); else if (request.value === 2) { this.showSpells(true); this.selectSpell(request.selected + 1); }
    }
    if (this.catalog) session.catalog ??= this.catalog;
    const ui = session.ui, stats = ui.stats;
    // frmMain: the on/off picture of each safe follows the flags the server last set (all on after login).
    const safes = { party: session.status.partySafe, clan: session.status.clanSafe, attack: session.safeMode !== false, resu: session.status.resuSafe, legion: session.status.legionSafe };
    for (const [key, button] of this.safeButtons) {
      const url = loadedInterfaceUrl(`boton-${button.dataset.art}-${safes[key as keyof typeof safes] ? 'on' : 'off'}`);
      if (button.dataset.state !== url) { button.dataset.state = url; button.style.backgroundImage = `url("${url}")`; }
    }
    element('cast').setAttribute('aria-disabled', String(!session.ready));
    const hp = stats.hp ?? session.self?.minHp, maxHp = stats.maxHp ?? session.self?.maxHp;
    const mana = stats.mana ?? session.self?.minMana, maxMana = stats.maxMana ?? session.self?.maxMana;
    const shield = stats.shield ?? 0;
    const fullHp = Math.max(maxHp ?? 0, (hp ?? 0) + shield);
    this.bar('hp', hp, fullHp, 216, maxHp);
    const hpWidth = ratio(hp, fullHp) * 216;
    element('shield-fill').style.left = `${35.2 + hpWidth}px`;
    element('shield-fill').style.width = `${ratio(shield, fullHp) * 216}px`;
    if (shield > 0) text('hp-text', `${hp} / ${maxHp} + ${shield}`);
    this.bar('mana', mana, maxMana, 216);
    this.bar('stamina', stats.stamina, stats.maxStamina, 89);
    this.bar('water', ui.food?.water, ui.food?.maxWater, 32);
    this.bar('food', ui.food?.food, ui.food?.maxFood, 32);
    this.bar('experience', stats.experience, stats.nextLevel, 235);
    text('gold', stats.gold === undefined ? '—' : stats.gold.toLocaleString('es-AR'));
    text('level', `Nivel ${stats.level ?? session.characterLevel ?? '—'}`);
    // The classic clock is server time; leave it blank until that packet is supported.
    if (ui.revision === this.revision) return;
    this.revision = ui.revision;
    void this.renderInventory().catch(error => this.report(String(error)));
    const list = element('spells'), scroll = list.scrollTop;
    list.replaceChildren();
    const count = Math.max(0, ...ui.spells.keys());
    if (count && !this.selectedSpell) this.selectedSpell = 1;
    for (let slot = 1; slot <= count; slot++) {
      const spell = ui.spells.get(slot), row = document.createElement('div');
      row.className = 'spell'; row.dataset.slot = String(slot); row.id = `spell-${slot}`;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(slot === this.selectedSpell));
      row.textContent = spell && spell.index > 0 ? this.spellName(spell.index) : '(Vacío)';
      row.onclick = () => this.selectSpell(slot); list.append(row);
    }
    list.scrollTop = scroll;
    const messages = element('messages'); messages.replaceChildren();
    for (const message of ui.messages) messages.append(renderMessage(message, ui.chat.locale));
    element('console').scrollTop = element('console').scrollHeight;
  }
  private bar(name: string, value: number | undefined, max: number | undefined, width: number, labelMax = max) {
    element(`${name}-fill`).style.width = `${ratio(value, max) * width}px`;
    if (name === 'experience') return; // the four read-out labels are written by frm-main-buttons.ts (UpdateExpBar)
    const label = value === undefined || labelMax === undefined ? '—' : ['water', 'food'].includes(name) ? String(value) : `${value} / ${labelMax}`;
    text(`${name}-text`, label);
  }
}
