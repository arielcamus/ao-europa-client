/*
 * Bank windows: the vault (frmBancoObj.frm, drawn by engine.DrawInterfaceBoveda) and the Goliath gold window (frmGoliath.frm).
 * Geometry is the original VB6 twips / 15. AGPL-3.0-or-later; see NOTICE. Artwork is read only from the local mount.
 */
import { windows } from './window-stack.js';
import { BANK_SLOTS } from '@ao/protocol';
import { make, place, artButton, digitsInput, windowBackground, paintSlot, withDots } from './bank-trade-dom.js';
import type { SlotView } from './bank-trade-dom.js';
import { loadObjectCatalog, itemInfo, usableSuffix } from './object-catalog.js';
import type { ObjectCatalog } from './object-catalog.js';
import { loadInterface } from './interface-assets.js';
import type { SlotArt } from './bank-trade-dom.js';
import type { Session } from './session.js';

type Side = 'vault' | 'user';
/** frmBancoObj.cantidad_Change: clamp to 1..MAX_INVENTORY_OBJS. */
const MAX_AMOUNT = 10000;
const INVENTORY_SLOTS = 42;

export class BankUI {
  private session: Session | undefined;
  private catalog: ObjectCatalog | undefined;
  private revision = -1;
  private dirty = true;
  private readonly bank: HTMLElement;
  private readonly vault: SlotView[] = []; private readonly inventory: SlotView[] = [];
  private selected: { side: Side; slot: number } | undefined;
  private lastSide: Side = 'user';
  private readonly name: HTMLElement; private readonly desc: HTMLElement; private readonly cost: HTMLElement; private readonly amount: HTMLInputElement;
  private readonly goliath: HTMLElement; private readonly frame: HTMLElement; private readonly goliathGold: HTMLElement; private readonly note: HTMLElement;
  private readonly datos: HTMLInputElement; private readonly depositAll: HTMLElement; private readonly nameBox: HTMLInputElement; private readonly frameArt: HTMLElement;
  private operation = 0;

  constructor(root: HTMLElement, private readonly art: SlotArt, private readonly report: (message: string) => void) {
    void loadObjectCatalog().then(catalog => { this.catalog = catalog; this.dirty = true; }).catch(error => report(`Obj.dat: ${String(error)}`));

    // frmBancoObj.frm, 544x481 centred over frmMain; banco.bmp.
    this.bank = make('section', 'bt-window', root, 'bank'); this.bank.hidden = true;
    this.bank.setAttribute('role', 'dialog'); this.bank.setAttribute('aria-label', 'Bóveda del banco');
    place(this.bank, 240, 143, 544, 481); windowBackground(this.bank, 'banco');
    const grid = make('div', 'bt-grid', this.bank, 'bank-grid'); place(grid, 42, 107, 459, 244);
    void this.art.slotBackground(838).then(frame => { grid.style.backgroundImage = frame.image; grid.style.backgroundPosition = frame.position; }).catch(() => {});
    const makeSlots = (views: SlotView[], side: Side, left: number) => {
      for (let i = 0; i < (side === 'vault' ? BANK_SLOTS : INVENTORY_SLOTS); i++) {
        const button = make('button', 'bt-slot', grid); button.type = 'button';
        place(button, left + (i % 6) * 35, Math.floor(i / 6) * 35, 34, 34);
        button.dataset.side = side; button.dataset.slot = String(i + 1); button.draggable = true;
        button.onclick = () => this.select(side, i + 1);
        button.ondblclick = () => this.wholeStack(side, i + 1);
        button.addEventListener('dragstart', event => { event.dataTransfer?.setData('text/plain', `${side}:${i + 1}`); this.select(side, i + 1); });
        button.addEventListener('dragover', event => event.preventDefault());
        button.addEventListener('drop', event => { event.preventDefault(); this.dropOn(event.dataTransfer?.getData('text/plain') ?? '', side, i + 1); });
        views.push({ button, key: '', token: 0 });
      }
    };
    makeSlots(this.vault, 'vault', 0); makeSlots(this.inventory, 'user', 252);
    // Dropping on the other inventory's empty area is "GetSlot = 0": nothing happens, so the grid itself accepts no drops.
    this.name = make('span', 'bt-name', this.bank, 'bank-item-name'); place(this.name, 168, 380, 209, 17);
    this.desc = make('span', 'bt-desc', this.bank, 'bank-item-desc'); place(this.desc, 168, 394, 209, 33);
    this.cost = make('span', 'bt-cost', this.bank, 'bank-gold'); place(this.cost, 424, 368, 81, 17);
    this.amount = digitsInput(this.bank, 'bank-amount', 'Cantidad', '1', 246, 437, 54, 14, 5);
    this.amount.addEventListener('change', () => this.clampAmount());
    const step = (delta: number) => { this.amount.value = String(Math.min(MAX_AMOUNT, Math.max(1, Number(this.amount.value || 0) + delta))); };
    artButton(this.bank, 'bank-minus', 'Menos', 'boton-sm-menos', 213, 435, 21, 21, () => step(-1));
    artButton(this.bank, 'bank-plus', 'Más', 'boton-sm-mas', 310, 432, 21, 21, () => step(1));
    artButton(this.bank, 'bank-extract', 'Retirar', 'boton-retirar', 55, 431, 122, 28, () => this.typed('vault'));
    artButton(this.bank, 'bank-deposit', 'Depositar', 'boton-depositar', 367, 431, 122, 28, () => this.typed('user'));
    artButton(this.bank, 'bank-close', 'Cerrar', 'boton-cerrar', 512, 0, 33, 25, () => this.closeBank());
    this.bank.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); this.closeBank(); return; }
      if (event.target instanceof HTMLInputElement) return;
      this.arrow(event);
    });

    // frmGoliath.frm, 545x481; ventanabanco.bmp. The Retirar / Depositar / Transferir panel is frameRetirar.
    this.goliath = make('section', 'bt-window', root, 'goliath'); this.goliath.hidden = true;
    this.goliath.setAttribute('role', 'dialog'); this.goliath.setAttribute('aria-label', 'Operación bancaria');
    place(this.goliath, 240, 143, 545, 481); windowBackground(this.goliath, 'ventanabanco');
    this.goliathGold = make('span', 'bt-goliath-gold', this.goliath, 'goliath-gold'); place(this.goliathGold, 296, 87, 73, 17);
    artButton(this.goliath, 'goliath-close', 'Cerrar', 'boton-cerrar', 512, 0, 34, 28, () => this.closeGoliath());
    artButton(this.goliath, 'goliath-vault', 'Ver bóveda', 'boton-ver-boveda', 305, 334, 122, 28, () => this.session?.bankTradeActions.openVault());
    artButton(this.goliath, 'goliath-extract', 'Retirar', 'boton-retirar', 72, 415, 122, 28, () => this.openFrame(2, 'ventanabanco-retirar'));
    artButton(this.goliath, 'goliath-deposit', 'Depositar', 'boton-depositar', 211, 415, 122, 28, () => this.openFrame(1, 'ventanabanco-depositar'));
    artButton(this.goliath, 'goliath-transfer', 'Transferir', 'boton-transferir', 350, 415, 122, 28, () => this.openFrame(3, 'ventanabanco-transferir'));
    this.frame = make('div', 'bt-frame', this.goliath, 'goliath-frame'); this.frame.hidden = true; place(this.frame, 40, 140, 178, 222);
    this.frameArt = make('div', 'bt-frame-art', this.frame); place(this.frameArt, 0, 0, 178, 222);
    this.datos = digitsInput(this.frame, 'goliath-amount', 'Cantidad', '', 55, 80, 65, 14, 30);
    this.nameBox = make('input', 'bt-input', this.frame, 'goliath-name'); place(this.nameBox, 30, 136, 121, 17); this.nameBox.maxLength = 30; this.nameBox.setAttribute('aria-label', 'Nombre');
    this.nameBox.addEventListener('input', () => { this.nameBox.value = this.nameBox.value.replace(/[^A-Za-z ]/g, ''); });
    this.note = make('span', 'bt-note', this.frame, 'goliath-note'); place(this.note, 8, 200, 161, 17);
    const bump = (delta: number) => { this.datos.value = String(Math.min(10000, Math.max(1, Number(this.datos.value || 0) + delta))); };
    artButton(this.frame, 'goliath-minus', 'Menos', 'boton-sm-menos', 24, 77, 21, 21, () => bump(-1));
    artButton(this.frame, 'goliath-plus', 'Más', 'boton-sm-mas', 132, 76, 21, 21, () => bump(1));
    this.depositAll = artButton(this.frame, 'goliath-deposit-all', 'Depositar todo', 'boton-depositartodo', 25, 131, 132, 28, () => this.depositEverything());
    artButton(this.frame, 'goliath-accept', 'Aceptar', 'boton-aceptar', 25, 168, 132, 28, () => this.acceptFrame());
    windows.watchElement('bank', this.bank, () => this.closeBank()); windows.watchElement('goliath', this.goliath, () => this.closeGoliath());
    this.goliath.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.closeGoliath(); } });
    // Form_MouseDown: a click outside the panel hides it.
    this.goliath.addEventListener('pointerdown', event => { if (!this.frame.contains(event.target as Node)) this.frame.hidden = true; });
  }

  get dialogOpen() { return !this.bank.hidden || !this.goliath.hidden; }
  /** frmMain renderer_MouseDown unloads frmBancoObj and frmGoliath. */
  closeOnWorldClick() { this.closeBank(); this.closeGoliath(); }
  closeDialogs() { this.closeOnWorldClick(); }
  private closeBank() { this.session?.bankTradeActions.closeBank(); this.bank.hidden = true; this.selected = undefined; }
  private closeGoliath() { this.session?.bankTradeActions.closeGoliath(); this.goliath.hidden = true; this.frame.hidden = true; this.operation = 0; }

  private clampAmount() { const value = Number(this.amount.value); this.amount.value = String(!Number.isFinite(value) || value < 1 ? 1 : Math.min(MAX_AMOUNT, Math.trunc(value))); }
  private select(side: Side, slot: number) { this.selected = { side, slot }; this.lastSide = side; this.dirty = true; this.render(); }
  private stack(side: Side, slot: number) {
    const state = this.session; if (!state) return undefined;
    return side === 'vault' ? state.bankTrade.bankSlots.get(slot) : state.ui.inventory.get(slot);
  }
  /** cmdRetirar_Click / cmdDepositar_Click: the typed amount, capped at the stack, destination 0. */
  private typed(side: Side) {
    const selected = this.selected; if (selected?.side !== side) return;
    const amount = Number(this.amount.value); if (!Number.isFinite(amount) || amount <= 0) return;
    const stack = this.stack(side, selected.slot); if (!stack) return;
    const send = Math.min(amount, stack.amount);
    if (side === 'vault') this.session?.bankTradeActions.extract(selected.slot, send); else this.session?.bankTradeActions.deposit(selected.slot, send);
  }
  /** interface_DblClick: the whole stack. */
  private wholeStack(side: Side, slot: number) {
    const stack = this.stack(side, slot); if (!stack) return;
    if (side === 'vault') this.session?.bankTradeActions.extract(slot, stack.amount); else this.session?.bankTradeActions.deposit(slot, stack.amount);
  }
  /** InvBoveda_ItemDropped / InvBankUsu_ItemDropped. */
  private dropOn(data: string, side: Side, slot: number) {
    const [from, raw] = data.split(':'); const dragSlot = Number(raw);
    if (!(from === 'vault' || from === 'user') || !Number.isInteger(dragSlot)) return;
    const actions = this.session?.bankTradeActions; if (!actions) return;
    if (from === 'vault' && side === 'vault') actions.moveVault(dragSlot, slot);
    else if (from === 'vault' && side === 'user') {
      const stack = this.stack('vault', dragSlot); if (stack) actions.extract(dragSlot, Math.min(Number(this.amount.value) || 1, stack.amount), slot);
    } else if (from === 'user' && side === 'vault') {
      const stack = this.stack('user', dragSlot); if (stack) actions.deposit(dragSlot, Math.min(Number(this.amount.value) || 1, stack.amount), slot);
    }
    // Inside the user's own inventory the VB6 form sends WriteItemMove, which belongs to the items feature.
  }
  /** interface_KeyDown: arrows move the selection inside the grid that was last clicked. */
  private arrow(event: KeyboardEvent) {
    const current = this.selected?.side === this.lastSide ? this.selected.slot : 0, max = this.lastSide === 'vault' ? BANK_SLOTS : INVENTORY_SLOTS, columns = 6;
    let next = current;
    if (event.key === 'ArrowRight' && current < max) next = current + 1;
    else if (event.key === 'ArrowLeft' && current > 1) next = current - 1;
    else if (event.key === 'ArrowUp' && current > columns) next = current - columns;
    else if (event.key === 'ArrowDown' && current < max - columns) next = current + columns;
    else return;
    event.preventDefault(); this.select(this.lastSide, next);
  }

  // ---- Goliath ----
  private openFrame(operation: number, art: string) {
    this.operation = operation; this.datos.value = ''; this.note.textContent = '';
    this.nameBox.hidden = operation !== 3; this.depositAll.hidden = operation !== 1;
    void loadInterface(art).then(url => { this.frameArt.style.backgroundImage = `url("${url}")`; }).catch(() => {});
    this.frame.hidden = false; this.datos.focus();
  }
  private depositEverything() {
    const gold = this.session?.ui.stats.gold ?? 0;
    if (gold <= 0) { this.note.textContent = 'No tienes oro para depositar.'; return; }
    this.session?.bankTradeActions.depositGold(gold);
  }
  /** cmdAceptar_Click: 1 deposit, 2 withdraw, 3 transfer to another character's bank (TransFerGold, feat/options-extras). */
  private acceptFrame() {
    const actions = this.session?.bankTradeActions, state = this.session?.bankTrade; if (!actions || !state) return;
    const value = Number(this.datos.value), gold = this.session?.ui.stats.gold ?? 0;
    if (this.operation === 0) { this.closeGoliath(); return; }
    if (this.operation === 1) {
      if (!(value >= 1)) this.note.textContent = 'Cantidad inválida.';
      if (gold <= 0) { this.note.textContent = 'No tienes oro para depositar.'; return; }
      if (value >= 1) actions.depositGold(Math.min(value, gold));
    } else if (this.operation === 2) {
      if (!(value >= 1)) this.note.textContent = 'Cantidad inválida.';
      if (state.bankGold <= 0) { this.note.textContent = 'No tienes oro en la cuenta.'; return; }
      if (value >= 1) actions.extractGold(Math.min(value, state.bankGold));
    } else if (this.operation === 3) {
      // Negativos y ceros, then no gold in the account, then the destination name (MENSAJE_TRANSFERIR_NOMBRE_INVALIDO).
      if (!(value >= 1)) { this.note.textContent = 'Cantidad inválida.'; return; }
      if (state.bankGold <= 0) { this.note.textContent = 'No tienes oro en la cuenta.'; return; }
      const destination = this.nameBox.value.trim();
      if (destination) { this.session?.optionsActions.transferGold(Math.min(value, state.bankGold), destination); this.closeGoliath(); }
      else { this.note.textContent = '¡Nombre de destino inválido!'; this.datos.value = ''; }
    }
  }

  update(session: Session | undefined) {
    if (this.session !== session) {
      this.session = session; this.revision = -1; this.bank.hidden = true; this.goliath.hidden = true; this.frame.hidden = true; this.selected = undefined;
    }
    if (!session) return;
    const state = session.bankTrade;
    if (state.bankOpen && this.bank.hidden) { this.bank.hidden = false; this.selected = undefined; this.amount.value = '1'; this.dirty = true; this.bank.tabIndex = -1; this.bank.focus(); }
    if (!state.bankOpen && !this.bank.hidden) { this.bank.hidden = true; this.selected = undefined; }
    if (state.goliathOpen && this.goliath.hidden) { this.goliath.hidden = false; this.frame.hidden = true; this.operation = 0; this.dirty = true; }
    if (!state.goliathOpen && !this.goliath.hidden) { this.goliath.hidden = true; this.frame.hidden = true; }
    const revision = state.revision + session.ui.revision;
    if (revision === this.revision && !this.dirty) return;
    this.revision = revision; this.dirty = false;
    if (!this.goliath.hidden) { this.goliathGold.textContent = String(state.bankGold); }
    if (!this.bank.hidden) this.render();
  }

  private render() {
    const session = this.session; if (!session) return;
    const catalog = this.catalog, state = session.bankTrade, sel = this.selected;
    const draw = (views: SlotView[], side: Side) => views.forEach((view, i) => {
      const slot = i + 1, stack = side === 'vault' ? state.bankSlots.get(slot) : session.ui.inventory.get(slot);
      const object = stack?.object ?? 0, info = object ? catalog?.get(object) : undefined;
      const locked = side === 'user' && slot > 24 + session.ui.unlockedRows * 6;
      void paintSlot(view, this.art, slot, {
        object, amount: stack?.amount ?? 0, grh: info?.grh ?? 0, equipped: side === 'user' ? session.ui.inventory.get(slot)?.equipped ?? false : false,
        name: info?.name ?? `Objeto ${object}`, locked, frame: side === 'user' ? (locked ? 1122 : slot > 24 ? 47742 : 47743) : 0,
      }, sel?.side === side && sel.slot === slot, side === 'vault' ? 'Bóveda' : 'Inventario');
    });
    draw(this.vault, 'vault'); draw(this.inventory, 'user');
    // DrawInterfaceBoveda: name with the usability suffix, then GetInfo.
    const current = sel ? this.stack(sel.side, sel.slot) : undefined, info = current ? catalog?.get(current.object) : undefined;
    this.name.textContent = current ? `${info?.name ?? `Objeto ${current.object}`}${usableSuffix(current.canUse)}` : '(Vacío)';
    this.desc.textContent = current ? itemInfo(info) : '';
    this.cost.textContent = withDots(session.ui.stats.gold ?? 0);
  }
}
