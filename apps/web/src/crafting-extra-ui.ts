/*
 * Alchemy (frmAlqui), tailor (FrmSastre) and the generic crafting station (frmCrafteo), adapted 2026-11-21 from the classic client forms.
 * Geometry is the original VB6 twips / 15, centred over the 1024x768 main window. Copyright (C) 2022-2026 Noland Studios.
 * AGPL-3.0-or-later; no warranty. See NOTICE. Artwork and object data are read only from the local mount.
 */
import { windows } from './window-stack.js';
import { loadInterface } from './interface-assets.js';
import { loadObjectIni } from './object-catalog.js';
import { fetchText, parseIni } from './assets.js';
import type { Ini } from './assets.js';
import { grhCanvas } from './grh-canvas.js';
import { ALCHEMY_MATERIAL_GRH, TAILOR_SKIN_GRH, TAILOR_SKIN_OBJECTS, alchemyMaterials, splitTailor, tailorMaterials } from './crafting-recipes.js';
import { MAX_CRAFT_SLOTS } from './crafting.js';
import { ListBox, make, place } from './crafting-ui.js';
import type { ClassicUI } from './classic-ui.js';
import type { Session } from './session.js';
import type { WorldRenderer } from './renderer.js';
import { paintSlot } from './bank-trade-dom.js';
import type { SlotView } from './bank-trade-dom.js';

const MSG_SELECT_OBJECT = 'Debes seleccionar un objeto.';
/** A control that is only background artwork until the pointer is over it (clsGraphicalButton with no default picture). */
function hoverButton(parent: HTMLElement, id: string, label: string, art: string, x: number, y: number, width: number, height: number, onClick: () => void) {
  const button = make('button', 'craft-button', parent, id); button.type = 'button'; button.setAttribute('aria-label', label);
  place(button, x, y, width, height); button.onclick = onClick;
  void loadInterface(art).then(url => {
    button.onpointerenter = () => { button.style.backgroundImage = `url("${url}")`; };
    button.onpointerleave = () => { button.style.backgroundImage = ''; };
  }).catch(() => { /* usable without artwork */ });
  return button;
}
/** A +/- control: nothing at rest, the "off" bitmap while pressed (cmdMasMenos_MouseDown). */
function pressButton(parent: HTMLElement, id: string, label: string, art: string, x: number, y: number, width: number, height: number, onPress: () => void) {
  const button = make('button', 'craft-button', parent, id); button.type = 'button'; button.setAttribute('aria-label', label);
  place(button, x, y, width, height);
  void loadInterface(art).then(url => {
    button.onpointerdown = () => { button.style.backgroundImage = `url("${url}")`; };
    const release = () => { button.style.backgroundImage = ''; };
    button.onpointerup = release; button.onpointerleave = release;
  }).catch(() => {});
  button.onclick = onPress;
  return button;
}
type Rect = readonly [number, number, number, number];

/** What differs between frmAlqui and FrmSastre. */
interface ListLayout {
  id: 'alchemy' | 'tailor'; label: string; background: string; size: readonly [number, number];
  list: Rect; materials: Rect; amounts: Rect; picture: readonly [number, number]; desc: Rect; descSize: number; quantity: Rect;
  minus: Rect; plus: Rect; build: Rect; cancel: Rect; close: Rect; closeArt?: string;
}
/** frmAlqui: ClientWidth 6480 x ClientHeight 7080 twips = 432 x 472. */
const ALCHEMY: ListLayout = {
  id: 'alchemy', label: 'Trabajar con alquimista', background: 'ventanaalquimia', size: [432, 472],
  list: [39, 99, 194, 236], materials: [272, 256, 83, 80], amounts: [368, 256, 29, 80], picture: [319, 126],
  desc: [272, 176, 121, 49], descSize: 9, quantity: [256, 378, 44, 17], minus: [220, 376, 21, 21], plus: [312, 376, 21, 21],
  build: [235, 423, 130, 27], cancel: [72, 423, 130, 27], close: [400, 0, 33, 25],
};
/** FrmSastre: 6480 x 7125 twips = 432 x 475. */
const TAILOR: ListLayout = {
  id: 'tailor', label: 'Trabajar de sastre', background: 'sastreria', size: [432, 475],
  list: [32, 144, 208, 184], materials: [268, 256, 107, 80], amounts: [377, 256, 22, 80], picture: [319, 123],
  desc: [264, 256, 137, 17], descSize: 11, quantity: [264, 376, 31, 17], minus: [224, 376, 17, 21], plus: [312, 376, 17, 21],
  build: [235, 423, 130, 27], cancel: [72, 423, 130, 27], close: [400, 0, 34, 27], closeArt: 'boton-cerrar',
};

class ListCraftForm {
  readonly root: HTMLElement;
  readonly objects: ListBox; readonly names: ListBox; readonly values: ListBox;
  readonly picture: HTMLElement; readonly desc: HTMLElement; readonly quantity: HTMLInputElement;
  constructor(parent: HTMLElement, readonly layout: ListLayout, callbacks: { select: (index: number) => void; material: (row: number) => void; build: () => void; close: () => void }) {
    const { id } = layout;
    this.root = make('section', 'craft-window', parent, `${id}-window`); this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', layout.label);
    place(this.root, Math.floor((1024 - layout.size[0]) / 2), Math.floor((768 - layout.size[1]) / 2), ...layout.size);
    void loadInterface(layout.background).then(url => { this.root.style.backgroundImage = `url("${url}")`; }).catch(() => {});
    // The caption label is a lightweight control: VB6 draws it under the list boxes, so it comes first in the DOM.
    this.desc = make('span', 'craft-desc', this.root, `${id}-desc`); place(this.desc, ...layout.desc); this.desc.style.fontSize = `${layout.descSize}px`;
    this.objects = new ListBox(this.root, `${id}-objects`, 'Objetos', layout.list, index => callbacks.select(index));
    this.names = new ListBox(this.root, `${id}-materials`, 'Materiales', layout.materials, row => callbacks.material(row));
    this.values = new ListBox(this.root, `${id}-amounts`, 'Cantidades', layout.amounts);
    this.picture = make('div', 'craft-picture', this.root, `${id}-picture`); place(this.picture, layout.picture[0], layout.picture[1], 32, 32);
    this.quantity = make('input', 'craft-quantity', this.root, `${id}-quantity`); this.quantity.value = '1'; this.quantity.maxLength = 3;
    this.quantity.inputMode = 'numeric'; this.quantity.setAttribute('aria-label', 'Cantidad'); place(this.quantity, ...layout.quantity);
    this.quantity.addEventListener('input', () => { this.quantity.value = this.quantity.value.replace(/\D/g, '').slice(0, 3); });
    const step = (delta: number) => { this.quantity.value = String(Math.max(0, Number(this.quantity.value || 0) + delta)); };
    if (id === 'alchemy') {
      pressButton(this.root, `${id}-minus`, 'Menos', 'boton-sm-menos-off', ...layout.minus, () => step(-1));
      pressButton(this.root, `${id}-plus`, 'Más', 'boton-sm-mas-off', ...layout.plus, () => step(1));
    } else {
      // Image2 / Image3 only change the number; they have no artwork of their own.
      for (const [name, rect, delta] of [['minus', layout.minus, -1], ['plus', layout.plus, 1]] as const) {
        const button = make('button', 'craft-button', this.root, `${id}-${name}`); button.type = 'button'; button.setAttribute('aria-label', delta < 0 ? 'Menos' : 'Más');
        place(button, ...rect); button.onclick = () => step(delta);
      }
    }
    hoverButton(this.root, `${id}-build`, 'Elaborar', 'boton-elaborar-over', ...layout.build, callbacks.build);
    hoverButton(this.root, `${id}-cancel`, 'Cancelar', 'boton-cancelar-over', ...layout.cancel, callbacks.close);
    if (layout.closeArt) {
      const button = make('button', 'craft-button', this.root, `${id}-close`); button.type = 'button'; button.setAttribute('aria-label', 'Cerrar'); place(button, ...layout.close); button.onclick = callbacks.close;
      void Promise.all(['default', 'over'].map(state => loadInterface(`${layout.closeArt}-${state}`))).then(([normal, over]) => {
        button.style.backgroundImage = `url("${normal}")`; button.onpointerenter = () => { button.style.backgroundImage = `url("${over}")`; }; button.onpointerleave = () => { button.style.backgroundImage = `url("${normal}")`; };
      }).catch(() => {});
    } else { const button = make('button', 'craft-button', this.root, `${id}-close`); button.type = 'button'; button.setAttribute('aria-label', 'Salir'); place(button, ...layout.close); button.onclick = callbacks.close; }
    windows.watchElement(`${id}-window`, this.root, callbacks.close);
    this.root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); callbacks.close(); } });
  }
  get visible() { return !this.root.hidden; }
  amount() { return Number(this.quantity.value || 0); }
  show() { this.quantity.value = '1'; this.names.set([]); this.values.set([]); this.desc.textContent = ''; this.picture.replaceChildren(); this.root.hidden = false; }
  hide() { this.root.hidden = true; }
  async draw(art: (grh: number) => Promise<HTMLCanvasElement>, grh: number) {
    this.picture.replaceChildren();
    if (grh > 0) this.picture.append(await art(grh).catch(() => document.createElement('canvas')));
  }
}

/** Items the three graphical inventories of frmCrafteo are made of. */
interface StationTypeInfo { window: string; inventoryGrh: number; iconGrh: number }
const SLOT = 35;

export class CraftingExtraUI {
  private session: Session | undefined;
  private ini: Ini | undefined;
  private loadingIni = false;
  private revision = -1;
  private readonly alchemy: ListCraftForm;
  private readonly tailor: ListCraftForm;
  private alchemyList: number[] = [];
  private tailorList: number[] = [];
  /** FrmSastre.indice: 1 clothes (vestimenta), 2 hats (gorros). */
  private tailorTab: 1 | 2 = 1;
  private readonly tailorButtons: HTMLButtonElement[] = [];
  // frmCrafteo
  private readonly station: HTMLElement;
  private readonly inventoryBackdrop: HTMLElement;
  private readonly slotsUser: SlotView[] = []; private readonly slotsItems: SlotView[] = []; private readonly slotsCatalyst: SlotView[] = [];
  private readonly resultBox: HTMLElement; private readonly percent: HTMLElement; private readonly cost: HTMLElement; private readonly typeIcon: HTMLElement;
  private selected = { user: 0, items: 0, catalyst: 0 };
  private stationTypes: Map<number, StationTypeInfo> | undefined;
  private stationKey = '';
  private loadingTypes = false;
  private readonly art: Pick<ClassicUI, 'itemArt' | 'slotBackground'>;

  constructor(root: HTMLElement, private readonly ui: ClassicUI, private readonly renderer: WorldRenderer, private readonly report: (message: string) => void) {
    this.art = ui;
    const itemArt = (grh: number) => this.ui.itemArt(grh);
    this.alchemy = new ListCraftForm(root, ALCHEMY, {
      select: index => void this.pickAlchemy(index),
      material: () => void this.alchemy.draw(itemArt, ALCHEMY_MATERIAL_GRH),
      build: () => this.buildAlchemy(), close: () => this.closeAlchemy(),
    });
    this.tailor = new ListCraftForm(root, TAILOR, {
      select: index => void this.pickTailor(index),
      material: row => void this.tailor.draw(itemArt, this.tailorSkinGrh(row)),
      build: () => this.buildTailor(), close: () => this.closeTailor(),
    });
    // Command1 (vestimenta, 76,88) and Command2 (gorros, 146,88): the hover bitmap marks the open list.
    const tabs: [number, string, number, number, number, number][] = [[1, 'sastreria_vestimentahover', 76, 88, 44, 39], [2, 'sastreria_gorroshover', 146, 88, 44, 39]];
    for (const [tab, art, x, y, w, h] of tabs) {
      const button = make('button', 'craft-tab', this.tailor.root, `tailor-tab-${tab === 1 ? 'clothes' : 'hats'}`); button.type = 'button';
      button.setAttribute('aria-label', tab === 1 ? 'Vestimenta' : 'Gorros'); button.title = button.getAttribute('aria-label')!; place(button, x, y, w, h);
      button.onclick = () => this.selectTailorTab(tab as 1 | 2);
      void loadInterface(art).then(url => { button.dataset.art = url; this.paintTailorTab(); }).catch(() => {});
      this.tailorButtons[tab] = button;
    }
    // frmCrafteo: 9000 x 5070 twips = 600 x 338, over the form's own PicInven (24,40, 552x245).
    this.station = make('section', 'craft-window cf-window', root, 'crafting-station'); this.station.hidden = true;
    this.station.setAttribute('role', 'dialog'); this.station.setAttribute('aria-label', 'Crafteo');
    place(this.station, Math.floor((1024 - 600) / 2), Math.floor((768 - 338) / 2), 600, 338);
    const pic = make('div', 'cf-pic', this.station, 'crafting-inventory'); place(pic, 24, 40, 552, 245);
    this.inventoryBackdrop = make('div', 'cf-backdrop', pic); this.inventoryBackdrop.style.pointerEvents = 'none';
    const grid = (views: SlotView[], count: number, perRow: number, x: number, y: number, kind: 'user' | 'items' | 'catalyst') => {
      for (let i = 0; i < count; i++) {
        const button = make('button', 'bt-slot cf-slot', pic); button.type = 'button'; button.draggable = true;
        place(button, x + (i % perRow) * SLOT + 1, y + Math.floor(i / perRow) * SLOT + 1, 32, 32);
        button.dataset.kind = kind; button.dataset.slot = String(i + 1);
        button.onclick = () => this.select(kind, i + 1);
        button.addEventListener('dragstart', event => { event.dataTransfer?.setData('text/plain', `${kind}:${i + 1}`); this.select(kind, i + 1); });
        button.addEventListener('dragover', event => event.preventDefault());
        button.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); this.dropOn(event.dataTransfer?.getData('text/plain') ?? '', kind, i + 1); });
        views.push({ button, key: '', token: 0 });
      }
    };
    // InvCraftUser: 42 slots, 210 wide at (250,0); InvCraftItems: 5 slots, 175 wide at (25,180); InvCraftCatalyst: 1 slot at (100,90).
    grid(this.slotsUser, 42, 6, 250, 0, 'user'); grid(this.slotsItems, MAX_CRAFT_SLOTS, 5, 25, 180, 'items'); grid(this.slotsCatalyst, 1, 1, 100, 90, 'catalyst');
    // Dropping outside every slot (Drop = 0 and GetSlot = 0) does nothing.
    pic.addEventListener('dragover', event => event.preventDefault()); pic.addEventListener('drop', event => event.preventDefault());
    this.typeIcon = make('div', 'cf-grh', pic); place(this.typeIcon, 100, 15, 32, 32);
    this.resultBox = make('div', 'cf-grh', pic); place(this.resultBox, 100, 15, 32, 32);
    this.percent = make('span', 'cf-text cf-percent', pic); place(this.percent, 25, 60, 120, 16);
    this.cost = make('span', 'cf-text cf-cost', pic); place(this.cost, 25, 140, 190, 16);
    const push = (id: string, label: string, x: number, y: number, w: number, onClick: () => void) => {
      const button = make('button', 'cf-button', this.station, id); button.type = 'button'; button.textContent = label; place(button, x, y, w, 25); button.onclick = onClick; return button;
    };
    push('crafting-remove', 'Quitar objeto', 48, 296, 97, () => this.removeSelected());
    push('crafting-craft', 'Craftear', 216, 296, 97, () => this.session?.crafting.craft());
    push('crafting-add', 'Agregar objeto', 328, 296, 97, () => { if (this.selected.user > 0) this.session?.crafting.addCraftItem(this.selected.user, 0); });
    push('crafting-catalyst', 'Agregar catalizador', 440, 296, 105, () => { if (this.selected.user > 0) this.session?.crafting.addCatalyst(this.selected.user); });
    push('crafting-close', 'X', 568, 0, 25, () => this.closeStation()).setAttribute('aria-label', 'Cerrar');
    windows.watchElement('crafting-station', this.station, () => this.closeStation());
    this.station.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.closeStation(); } });
  }

  get windowOpen() { return this.alchemy.visible || this.tailor.visible || !this.station.hidden; }
  closeAll() { if (this.alchemy.visible) this.closeAlchemy(); if (this.tailor.visible) this.closeTailor(); if (!this.station.hidden) this.closeStation(); }
  private closeAlchemy() { this.alchemy.hide(); this.session?.craftingState.closeWindow(); }
  private closeTailor() { this.tailor.hide(); this.session?.craftingState.closeWindow(); }
  /** Form_Unload: only a station that was opened by the server tells it so (Comerciando). */
  private closeStation() { if (!this.station.hidden) { this.station.hidden = true; this.session?.crafting.closeCrafting(); } }
  private name(object: number) { return this.session?.catalog?.get(object)?.name ?? `Objeto ${object}`; }
  private typeOf = (object: number) => this.session?.catalog?.get(object)?.type ?? 0;
  private itemArt = (grh: number) => this.ui.itemArt(grh);

  // ---- frmAlqui ------------------------------------------------------------------------------------------------------------
  private async pickAlchemy(index: number) {
    const object = this.alchemyList[index]; if (object === undefined || !this.ini) return;
    const materials = alchemyMaterials(this.ini, object);
    this.alchemy.names.set(materials.map(material => material.name)); this.alchemy.values.set(materials.map(material => String(material.amount)));
    this.alchemy.desc.textContent = this.session?.catalog?.get(object)?.text ?? '';
    await this.alchemy.draw(this.itemArt, this.session?.catalog?.get(object)?.grh ?? 0);
  }
  /** Command3_Click: nothing selected is a message box; otherwise build, and the form closes. */
  private buildAlchemy() {
    const object = this.alchemyList[this.alchemy.objects.index];
    if (object === undefined) { this.report(MSG_SELECT_OBJECT); return; }
    this.session?.crafting.buildAlchemy(object, this.alchemy.amount());
    this.closeAlchemy();
  }

  // ---- FrmSastre -----------------------------------------------------------------------------------------------------------
  private tailorSkinGrh(row: number): number {
    const fixed = TAILOR_SKIN_GRH[row as 0 | 1 | 2]; if (fixed) return fixed;
    const object = TAILOR_SKIN_OBJECTS[row]; return object ? this.session?.catalog?.get(object)?.grh ?? 0 : 0;
  }
  private paintTailorTab() {
    this.tailorButtons.forEach((button, tab) => { if (button) button.style.backgroundImage = tab === this.tailorTab && button.dataset.art ? `url("${button.dataset.art}")` : ''; });
  }
  /** Command1_Click / Command2_Click. */
  private selectTailorTab(tab: 1 | 2) {
    this.tailorTab = tab;
    const lists = splitTailor(this.session!.craftingState.tailor, this.typeOf);
    this.tailorList = tab === 1 ? lists.clothes : lists.hats;
    this.tailor.objects.set(this.tailorList.map(object => this.name(object)));
    this.tailor.names.set([]); this.tailor.values.set([]); this.paintTailorTab();
  }
  private async pickTailor(index: number) {
    const object = this.tailorList[index]; if (object === undefined || !this.ini) return;
    const info = this.session?.catalog?.get(object), materials = tailorMaterials(this.ini, object);
    this.tailor.names.set(materials.map(material => material.name)); this.tailor.values.set(materials.map(material => String(material.amount)));
    this.tailor.desc.textContent = `Defensa: ${info?.minDef ?? 0}/${info?.maxDef ?? 0}`;
    await this.tailor.draw(this.itemArt, info?.grh ?? 0);
  }
  private buildTailor() {
    const object = this.tailorList[this.tailor.objects.index];
    if (object === undefined) { this.report(MSG_SELECT_OBJECT); return; }
    this.session?.crafting.buildTailor(object, this.tailor.amount());
    this.closeTailor();
  }

  // ---- frmCrafteo ----------------------------------------------------------------------------------------------------------
  private select(kind: 'user' | 'items' | 'catalyst', slot: number) { this.selected[kind] = slot; this.render(true); }
  /** BtnQuitarObjeto_Click: the selected catalyst first, else the selected crafting slot. */
  private removeSelected() {
    const crafting = this.session?.crafting; if (!crafting) return;
    if (this.selected.catalyst > 0) crafting.removeCatalyst(0);
    else if (this.selected.items > 0) crafting.removeCraftItem(this.selected.items, 0);
  }
  /** InvCraftUser / InvCraftItems / InvCraftCatalyst _ItemDropped. */
  private dropOn(data: string, targetKind: 'user' | 'items' | 'catalyst', target: number) {
    const [kind, text] = data.split(':'), drag = Number(text), crafting = this.session?.crafting;
    if (!crafting || !(drag > 0) || !kind) return;
    const state = this.session!.craftingState, inventory = this.session!.ui.inventory;
    if (kind === 'user') {
      if (targetKind === 'user') { this.session!.inventoryActions.move(drag, target); return; }
      if (targetKind === 'items') { if (state.craftItems.has(target)) crafting.removeCraftItem(target, 0); crafting.addCraftItem(drag, target); return; }
      if (state.catalyst) crafting.removeCatalyst(0);
      crafting.addCatalyst(drag); return;
    }
    if (targetKind === 'items' && kind === 'items') { if (drag !== target) crafting.moveCraftItem(drag, target); return; }
    if (targetKind !== 'user') return; // a crafting slot dropped on the catalyst slot, or the catalyst on a crafting slot: nothing
    // Back to the inventory: an occupied slot of another object sends it to any free slot (Drop = 0).
    const dragged = kind === 'items' ? state.craftItems.get(drag) : state.catalyst?.object;
    let drop = target; const occupant = inventory.get(target)?.object;
    if (occupant && dragged !== occupant) drop = 0;
    if (kind === 'items') crafting.removeCraftItem(drag, drop); else crafting.removeCatalyst(drop);
  }

  private render(force = false) {
    const session = this.session; if (!session || this.station.hidden) return;
    const state = session.craftingState, catalog = session.catalog;
    const grhOf = (object: number) => catalog?.get(object)?.grh ?? 0;
    const label = (kind: string) => kind;
    this.slotsUser.forEach((view, i) => {
      const item = session.ui.inventory.get(i + 1);
      void paintSlot(view, this.art, i + 1, { object: item?.object ?? 0, amount: item?.amount ?? 0, grh: item ? grhOf(item.object) : 0, equipped: item?.equipped ?? false, name: item ? this.name(item.object) : '' }, this.selected.user === i + 1, label('Inventario'));
    });
    this.slotsItems.forEach((view, i) => {
      const object = state.craftItems.get(i + 1) ?? 0;
      void paintSlot(view, this.art, i + 1, { object, amount: object ? 1 : 0, grh: grhOf(object), name: object ? this.name(object) : '' }, this.selected.items === i + 1, label('Crafteo'));
    });
    this.slotsCatalyst.forEach((view, i) => {
      const catalyst = state.catalyst;
      void paintSlot(view, this.art, i + 1, { object: catalyst?.object ?? 0, amount: catalyst?.amount ?? 0, grh: catalyst ? grhOf(catalyst.object) : 0, name: catalyst ? this.name(catalyst.object) : '' }, this.selected.catalyst === i + 1, label('Catalizador'));
    });
    const info = this.stationTypes?.get(state.craftingType);
    const result = state.result;
    // DrawInterfaceCrafting: the result and its odds and price, otherwise the type's icon.
    const key = `${state.craftingType}/${result?.object ?? 0}/${result?.percent ?? 0}/${result?.price ?? 0}/${state.catalystPercent}`;
    if (force && key === this.stationKey) return;
    this.stationKey = key;
    this.typeIcon.hidden = !!result; this.resultBox.hidden = !result;
    if (result) {
      this.percent.textContent = `${result.percent}%`;
      // MENSAJE_554 ("Costo: ") + PonerPuntos(price) + MENSAJE_555 ("monedas de oro"): the original joins them with no space.
      this.cost.textContent = `Costo: ${String(Math.trunc(result.price)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}monedas de oro`;
      void this.draw(this.resultBox, grhOf(result.object));
    } else { this.percent.textContent = ''; this.cost.textContent = ''; if (info) void this.draw(this.typeIcon, info.iconGrh); }
    this.percent.hidden = !result; this.cost.hidden = !result;
  }
  private async draw(box: HTMLElement, grh: number) {
    box.replaceChildren(); if (grh <= 0) return;
    try { box.append(await grhCanvas(this.renderer, grh)); } catch { /* the slot stays empty without art */ }
  }
  /** crafteo.ini: [Name] ID, Ventana (a bitmap file name), Inventario (grh), Icono (grh). */
  private loadStationTypes() {
    if (this.stationTypes || this.loadingTypes) return;
    this.loadingTypes = true;
    void fetchText('init/crafteo.ini').then(text => {
      const ini = parseIni(text), types = new Map<number, StationTypeInfo>();
      for (const section of ini.values()) {
        const id = Number(section.get('id')); if (!Number.isFinite(id)) continue;
        types.set(id, { window: (section.get('ventana') ?? '').replace(/\.bmp$/i, ''), inventoryGrh: Number(section.get('inventario')) || 0, iconGrh: Number(section.get('icono')) || 0 });
      }
      this.stationTypes = types; this.revision = -1;
    }).catch(error => { this.loadingTypes = false; this.report(String(error)); });
  }
  private openStation(type: number) {
    const info = this.stationTypes?.get(type);
    this.station.hidden = false; this.selected = { user: 0, items: 0, catalyst: 0 }; this.stationKey = '';
    if (info) {
      void loadInterface(info.window).then(url => { this.station.style.backgroundImage = `url("${url}")`; }).catch(() => {});
      void this.draw(this.inventoryBackdrop, info.inventoryGrh);
    }
  }

  update(session: Session | undefined) {
    if (this.session !== session) { this.session = session; this.revision = -1; this.alchemy.hide(); this.tailor.hide(); this.station.hidden = true; }
    if (!session) return;
    if (!this.ini && !this.loadingIni) { this.loadingIni = true; void loadObjectIni().then(ini => { this.ini = ini; }).catch(error => { this.loadingIni = false; this.report(String(error)); }); }
    this.loadStationTypes();
    const state = session.craftingState;
    // The station repaints with the inventory too (slot updates while it is open).
    if (!this.station.hidden && state.open === 'crafting') this.render();
    if (state.revision === this.revision) return;
    this.revision = state.revision;
    if (state.open === 'alchemy') {
      this.alchemyList = state.alchemy.filter(object => object !== 0);
      this.alchemy.objects.set(this.alchemyList.map(object => this.name(object)));
      if (!this.alchemy.visible) { this.alchemy.show(); this.alchemy.objects.set(this.alchemyList.map(object => this.name(object))); }
    } else this.alchemy.hide();
    if (state.open === 'tailor') {
      if (!this.tailor.visible) { this.tailor.show(); this.selectTailorTab(1); } else this.selectTailorTab(this.tailorTab);
    } else this.tailor.hide();
    if (state.open === 'crafting') { if (this.station.hidden) this.openStation(state.craftingType); this.render(); }
    else if (!this.station.hidden) this.station.hidden = true;
  }
}
