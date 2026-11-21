/*
 * Smith (frmHerrero) and carpenter (frmCarp) windows, adapted 2026-11-20 from the classic client forms.
 * Geometry is the original VB6 twips / 15, centred over the 1024x768 main window (StartUpPosition = CenterOwner).
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty. See NOTICE.
 * Artwork and object data are read only from the local mount.
 */
import { windows } from './window-stack.js';
import { loadInterface } from './interface-assets.js';
import { loadObjectIni } from './object-catalog.js';
import type { Ini } from './assets.js';
import { SMITH_MATERIAL_GRH, carpenterMaterialGrh, carpenterMaterials, smithMaterials, splitDefenses } from './crafting-recipes.js';
import type { SmithTab } from './crafting-recipes.js';
import type { ClassicUI } from './classic-ui.js';
import type { Session } from './session.js';
import './crafting.css';

const place = (node: HTMLElement, x: number, y: number, width: number, height: number) => {
  Object.assign(node.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
};
const make = <T extends keyof HTMLElementTagNameMap>(tag: T, className: string, parent?: HTMLElement, id = '') => {
  const node = document.createElement(tag); node.className = className; if (id) node.id = id; parent?.append(node); return node;
};
/** A button that is only artwork: default, over and off bitmaps from the interface folder. */
function artButton(parent: HTMLElement, id: string, label: string, art: string, x: number, y: number, width: number, height: number, onClick: () => void) {
  const button = make('button', 'craft-button', parent, id); button.type = 'button'; button.setAttribute('aria-label', label);
  place(button, x, y, width, height); button.onclick = onClick;
  void Promise.all(['default', 'over'].map(state => loadInterface(`${art}-${state}`))).then(([normal, over]) => {
    button.style.backgroundImage = `url("${normal}")`;
    button.onpointerenter = () => { button.style.backgroundImage = `url("${over}")`; };
    button.onpointerleave = () => { button.style.backgroundImage = `url("${normal}")`; };
  }).catch(() => { /* the control stays usable without artwork */ });
  return button;
}

/** VB.ListBox: flat, black, white Tahoma 8.25; one selected row. */
class ListBox {
  readonly element: HTMLElement;
  private rows: HTMLElement[] = [];
  private selected = -1;
  constructor(parent: HTMLElement, id: string, label: string, rect: readonly [number, number, number, number], private readonly onSelect?: (index: number) => void) {
    this.element = make('div', 'craft-list', parent, id); this.element.setAttribute('role', 'listbox'); this.element.setAttribute('aria-label', label);
    place(this.element, ...rect);
  }
  get index() { return this.selected; }
  set(items: readonly string[]) {
    this.selected = -1;
    this.rows = items.map((text, i) => {
      const row = make('div', 'craft-row'); row.setAttribute('role', 'option'); row.setAttribute('aria-selected', 'false'); row.textContent = text;
      if (this.onSelect) row.onclick = () => { this.select(i); this.onSelect?.(i); };
      return row;
    });
    this.element.replaceChildren(...this.rows);
  }
  select(index: number) {
    this.rows.forEach((row, i) => row.setAttribute('aria-selected', String(i === index)));
    this.selected = index;
  }
}

/** The part both forms share: material lists, picture, description, quantity box and the +/- / build / accept / close buttons. */
class CraftForm {
  readonly root: HTMLElement;
  readonly objects: ListBox; readonly names: ListBox; readonly values: ListBox;
  readonly picture: HTMLElement; readonly desc: HTMLElement; readonly quantity: HTMLInputElement;
  constructor(parent: HTMLElement, readonly kind: 'smith' | 'carpenter', background: string, size: readonly [number, number],
    layout: { list: readonly [number, number, number, number]; quantity: readonly [number, number, number, number]; desc: readonly [number, number, number, number] },
    readonly callbacks: { select: (index: number) => void; material: (row: number) => void; build: () => void; close: () => void }) {
    this.root = make('section', 'craft-window', parent, `${kind}-window`); this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', kind === 'smith' ? 'Trabajar con Herrería' : 'Trabajar de carpintero');
    place(this.root, Math.floor((1024 - size[0]) / 2), Math.floor((768 - size[1]) / 2), size[0], size[1]);
    void loadInterface(background).then(url => { this.root.style.backgroundImage = `url("${url}")`; }).catch(() => {});
    this.objects = new ListBox(this.root, `${kind}-objects`, 'Objetos', layout.list, index => callbacks.select(index));
    this.names = new ListBox(this.root, `${kind}-materials`, 'Materiales', [256, 168, 123, 80], row => callbacks.material(row));
    this.values = new ListBox(this.root, `${kind}-amounts`, 'Cantidades', [384, 168, 43, 80]);
    this.picture = make('div', 'craft-picture', this.root, `${kind}-picture`); place(this.picture, 326, 123, 32, 32);
    this.desc = make('span', 'craft-desc', this.root, `${kind}-desc`); place(this.desc, ...layout.desc);
    this.quantity = make('input', 'craft-quantity', this.root, `${kind}-quantity`); this.quantity.value = '1'; this.quantity.maxLength = 3;
    this.quantity.inputMode = 'numeric'; this.quantity.setAttribute('aria-label', 'Cantidad'); place(this.quantity, ...layout.quantity);
    this.quantity.addEventListener('input', () => { this.quantity.value = this.quantity.value.replace(/\D/g, '').slice(0, 3); });
    // cmdMenos_Click / cmdMas_Click: the box is only bounded below by 0 and above by 9999 on the +.
    artButton(this.root, `${kind}-minus`, 'Menos', 'boton-sm-menos', 316, 281, 21, 21, () => { const n = Number(this.quantity.value || 0); if (n > 0) this.quantity.value = String(n - 1); });
    artButton(this.root, `${kind}-plus`, 'Más', 'boton-sm-mas', 400, 281, 21, 21, () => { const n = Number(this.quantity.value || 0); if (n <= 9999) this.quantity.value = String(n + 1); });
    artButton(this.root, `${kind}-build`, 'Construir', 'boton-construir', 277, 312, 132, 28, callbacks.build);
    artButton(this.root, `${kind}-accept`, 'Aceptar', 'boton-aceptar', kind === 'smith' ? 169 : 168, 382, 132, 28, callbacks.close);
    artButton(this.root, `${kind}-close`, 'Cerrar', 'boton-cerrar', 440, 0, 28, 28, callbacks.close);
    windows.watchElement(`${kind}-window`, this.root, callbacks.close);
    this.root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); callbacks.close(); } });
  }
  get visible() { return !this.root.hidden; }
  amount() { return Number(this.quantity.value || 0); }
  show() { this.quantity.value = '1'; this.names.set([]); this.values.set([]); this.desc.textContent = ''; this.picture.replaceChildren(); this.root.hidden = false; }
  hide() { this.root.hidden = true; }
  async draw(ui: ClassicUI, grh: number) {
    this.picture.replaceChildren();
    if (grh > 0) this.picture.append(await ui.itemArt(grh).catch(() => document.createElement('canvas')));
  }
}

const SMITH_TABS: readonly { tab: SmithTab; art: string; rect: readonly [number, number, number, number]; stretch?: boolean; label: string }[] = [
  { tab: 'weapons', art: 'boton-espada', rect: [107, 90, 30, 34], label: 'Armas' },
  { tab: 'armors', art: 'boton-armadura', rect: [150, 90, 34, 36], stretch: true, label: 'Armaduras' },
  { tab: 'helmets', art: 'boton-casco', rect: [24, 90, 30, 34], label: 'Cascos' },
  { tab: 'shields', art: 'boton-escudo', rect: [70, 91, 30, 34], label: 'Escudos' },
  { tab: 'runes', art: 'boton-runas', rect: [190, 93, 34, 34], stretch: true, label: 'Runas' },
];

export class CraftingUI {
  private session: Session | undefined;
  private ini: Ini | undefined;
  private revision = -1;
  private readonly smith: CraftForm;
  private readonly carpenter: CraftForm;
  private tab: SmithTab = 'helmets';
  private readonly tabButtons = new Map<SmithTab, HTMLButtonElement>();
  /** Objects behind each row of the current list (the VB6 arrays the ListIndex points into). */
  private smithList: number[] = [];
  private carpenterList: number[] = [];
  private loadingIni = false;

  constructor(private readonly ui: ClassicUI, root: HTMLElement, private readonly report: (message: string) => void) {
    // frmHerrero: ClientWidth 7050 / 15 = 470, ClientHeight 6525 / 15 = 435.
    this.smith = new CraftForm(root, 'smith', 'ventanaherreria', [470, 435],
      { list: [32, 155, 185, 184], quantity: [351, 285, 36, 17], desc: [256, 260, 169, 17] },
      { select: index => void this.pickSmith(index), material: row => void this.smith.draw(this.ui, SMITH_MATERIAL_GRH[row] ?? 0), build: () => this.buildSmith(), close: () => this.closeSmith() });
    for (const spec of SMITH_TABS) {
      const button = make('button', 'craft-tab', this.smith.root, `smith-tab-${spec.tab}`); button.type = 'button'; button.setAttribute('aria-label', spec.label);
      button.title = spec.label; place(button, ...spec.rect);
      if (spec.stretch) button.style.backgroundSize = '100% 100%';
      button.onclick = () => this.selectTab(spec.tab);
      button.onpointerenter = () => { if (this.tab !== spec.tab) void this.tabArt(spec.tab, 'off'); };
      button.onpointerleave = () => { if (this.tab !== spec.tab) button.style.backgroundImage = ''; };
      this.tabButtons.set(spec.tab, button);
    }
    // frmCarp: 7065 / 15 = 471 by 435.
    this.carpenter = new CraftForm(root, 'carpenter', 'ventanacarpinteria', [471, 435],
      { list: [35, 96, 180, 236], quantity: [347, 283, 44, 17], desc: [248, 262, 185, 17] },
      { select: index => void this.pickCarpenter(index), material: row => void this.carpenter.draw(this.ui, carpenterMaterialGrh(row)), build: () => this.buildCarpenter(), close: () => this.closeCarpenter() });
  }

  get windowOpen() { return this.smith.visible || this.carpenter.visible; }
  closeAll() { if (this.smith.visible) this.closeSmith(); if (this.carpenter.visible) this.closeCarpenter(); }

  private closeSmith() { this.smith.hide(); this.session?.craftingState.closeWindow(); }
  private closeCarpenter() { this.carpenter.hide(); this.session?.craftingState.closeWindow(); }
  private name(object: number) { return this.session?.catalog?.get(object)?.name ?? `Objeto ${object}`; }
  private typeOf = (object: number) => this.session?.catalog?.get(object)?.type ?? 0;

  /** The object numbers behind the selected tab, in the order the form lists them. */
  private tabObjects(tab: SmithTab): number[] {
    const state = this.session!.craftingState;
    switch (tab) {
      case 'weapons': return state.smithWeapons;
      case 'runes': return state.smithRunes;
      default: return splitDefenses(state.smithDefenses, this.typeOf)[tab === 'armors' ? 'armors' : tab === 'helmets' ? 'helmets' : 'shields'];
    }
  }
  private tabArt(tab: SmithTab, state: 'over' | 'off') {
    const spec = SMITH_TABS.find(item => item.tab === tab)!, button = this.tabButtons.get(tab)!;
    return loadInterface(`${spec.art}-${state}`).then(url => { button.style.backgroundImage = `url("${url}")`; }).catch(() => { /* runes art is not in every install */ });
  }
  /** Command1..5_Click: switch the list, highlight the tab, clear the others. */
  private selectTab(tab: SmithTab) {
    this.tab = tab;
    for (const [other, button] of this.tabButtons) if (other !== tab) button.style.backgroundImage = '';
    void this.tabArt(tab, 'over');
    this.smithList = this.tabObjects(tab);
    this.smith.objects.set(this.smithList.map(object => this.name(object)));
    this.smith.names.set([]); this.smith.values.set([]);
  }
  private async pickSmith(index: number) {
    const object = this.smithList[index]; if (object === undefined || !this.ini) return;
    const info = this.session?.catalog?.get(object), materials = smithMaterials(this.ini, object);
    this.smith.names.set(materials.map(material => material.name)); this.smith.values.set(materials.map(material => String(material.amount)));
    await this.smith.draw(this.ui, info?.grh ?? 0);
    // Case 5 (runes) never writes the caption; the others show the hit or the defence range.
    if (this.tab === 'weapons') this.smith.desc.textContent = `Golpe: ${info?.minHit ?? 0}/${info?.maxHit ?? 0}`;
    else if (this.tab !== 'runes') this.smith.desc.textContent = `Defensa: ${info?.minDef ?? 0}/${info?.maxDef ?? 0}`;
  }
  /** cmdConstruir_Click closes the form whatever happens. */
  private buildSmith() {
    const object = this.smithList[this.smith.objects.index];
    if (object !== undefined) this.session?.crafting.buildSmith(object, this.smith.amount());
    this.closeSmith();
  }

  private async pickCarpenter(index: number) {
    const object = this.carpenterList[index]; if (object === undefined || !this.ini) return;
    const info = this.session?.catalog?.get(object), materials = carpenterMaterials(this.ini, object);
    this.carpenter.names.set(materials.map(material => material.name)); this.carpenter.values.set(materials.map(material => String(material.amount)));
    this.carpenter.desc.textContent = info?.text ?? '';
    await this.carpenter.draw(this.ui, info?.grh ?? 0);
  }
  /** cmdConstruir_Click: nothing selected does nothing; the form closes after a request. */
  private buildCarpenter() {
    const object = this.carpenterList[this.carpenter.objects.index];
    if (object === undefined) return;
    this.session?.crafting.buildCarpenter(object, this.carpenter.amount());
    this.closeCarpenter();
  }

  update(session: Session | undefined) {
    if (this.session !== session) { this.session = session; this.revision = -1; this.smith.hide(); this.carpenter.hide(); }
    if (!session) return;
    session.crafting.tick();
    if (!this.ini && !this.loadingIni) { this.loadingIni = true; void loadObjectIni().then(ini => { this.ini = ini; }).catch(error => { this.loadingIni = false; this.report(String(error)); }); }
    const state = session.craftingState;
    if (state.revision === this.revision) return;
    this.revision = state.revision;
    if (state.open === 'smith' && !this.smith.visible) {
      this.carpenter.hide(); this.smith.show();
      // HandleShowBlacksmithForm fills the helmet list and the form loads with that tab selected.
      this.selectTab('helmets');
    } else if (state.open === 'smith') this.selectTab(this.tab); // a refreshed list while the form is up
    else if (state.open === 'carpenter' && !this.carpenter.visible) {
      this.smith.hide(); this.carpenter.show();
      this.carpenterList = state.carpenter;
      this.carpenter.objects.set(this.carpenterList.map(object => this.name(object)));
    } else if (state.open === 'carpenter') {
      // HandleCarpenterObjects refills the list.
      this.carpenterList = state.carpenter; this.carpenter.objects.set(this.carpenterList.map(object => this.name(object)));
    } else { this.smith.hide(); this.carpenter.hide(); }
  }
}
