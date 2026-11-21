/*
 * Items UI: equipped stat slots, strength/agility, gold actions, the drop amount
 * window (frmCantidad.frm) and the NPC shop window (frmComerciar.frm).
 * Geometry is the original VB6 twips / 15. AGPL-3.0-or-later; see NOTICE.
 * Artwork is read only from the local mount.
 */
import { windows } from './window-stack.js';
import { loadInterface } from './interface-assets.js';
import { controls } from './classic-layout.js';
import { GOLD_SLOT } from './items.js';
import { ObjType, itemInfo, usableSuffix } from './object-catalog.js';
import type { ClassicUI } from './classic-ui.js';
import type { Session } from './session.js';
import './items.css';
import { assetUrl } from './assets.js';

const BUFF_MULTIPLIER = 2, BUFF_FULL_RED = 204, BUFF_CHANNEL_MAX = 255;
/** frmMain.GetBuffColor: white until buffed, then fading to red. */
/** UpdateBuff at 619e69d (pinned FYA has no base): >= 35 is eHighBuff RGB(204,0,0), >= 25 eMinBuff RGB(204,100,100), else white. */
export function pinnedBuffColor(current: number): string {
  return current >= 35 ? 'rgb(204,0,0)' : current >= 25 ? 'rgb(204,100,100)' : '#fff';
}
export function buffColor(current: number, base: number | undefined): string {
  if (base === undefined) return pinnedBuffColor(current);
  if (base <= 0 || current <= base) return '#fff';
  const ratio = Math.min(1, (current - base) / (base * BUFF_MULTIPLIER - base));
  const red = Math.trunc(BUFF_CHANNEL_MAX - (BUFF_CHANNEL_MAX - BUFF_FULL_RED) * ratio), channel = Math.trunc(BUFF_CHANNEL_MAX * (1 - ratio));
  return `rgb(${red},${channel},${channel})`;
}
/** PonerPuntos: thousands separated with dots. */
export const withDots = (value: number) => String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const place = (node: HTMLElement, x: number, y: number, width: number, height: number) => {
  Object.assign(node.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
};
const make = <T extends keyof HTMLElementTagNameMap>(tag: T, className = '', parent?: HTMLElement, id = '') => {
  const node = document.createElement(tag); if (className) node.className = className; if (id) node.id = id; parent?.append(node); return node;
};
function artButton(parent: HTMLElement, id: string, label: string, art: string, x: number, y: number, width: number, height: number, onClick: () => void) {
  const button = make('button', 'art-button items-button', parent, id); button.type = 'button'; button.setAttribute('aria-label', label);
  place(button, x, y, width, height); button.onclick = onClick;
  void Promise.all(['default', 'over'].map(state => loadInterface(`${art}-${state}`))).then(([normal, over]) => {
    button.style.backgroundImage = `url("${normal}")`;
    button.onpointerenter = () => { button.style.backgroundImage = `url("${over}")`; };
    button.onpointerleave = () => { button.style.backgroundImage = `url("${normal}")`; };
  }).catch(() => { /* the control stays usable without artwork */ });
  return button;
}
const digitsOnly = (input: HTMLInputElement) => input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); });

interface SlotView { button: HTMLButtonElement; key: string; token: number }

export class ItemsUI {
  private session: Session | undefined;
  private revision = -1;
  private dirty = true;
  private readonly stat: Record<'weapon' | 'shield' | 'helmet' | 'armour' | 'resistance' | 'damage' | 'strength' | 'agility', HTMLElement>;
  private readonly shop: HTMLElement;
  private readonly shopNpc: SlotView[] = []; private readonly shopUser: SlotView[] = [];
  private shopSelected: { side: 'npc' | 'user'; slot: number } | undefined;
  private readonly shopName: HTMLElement; private readonly shopDesc: HTMLElement; private readonly shopCost: HTMLElement;
  private readonly shopAmount: HTMLInputElement;
  private readonly amountDialog: HTMLElement; private readonly amountInput: HTMLInputElement;
  private readonly confirm: HTMLElement; private readonly confirmText: HTMLElement;
  private pendingDestroy: { slot: number; amount: number } | undefined;
  private readonly card: HTMLElement; private readonly cardTitle: HTMLElement; private readonly cardImage: HTMLImageElement;

  constructor(private readonly ui: ClassicUI, private readonly root: HTMLElement, private readonly report: (message: string) => void) {
    const panel = root.querySelector<HTMLElement>('#stats-panel')!;
    const label = (key: keyof ItemsUI['stat'], text: string, control?: string, rect?: readonly [number, number, number, number]) => {
      const node = make('span', 'label items-stat', panel, `stat-${key}`); node.textContent = text;
      if (control) { node.dataset.vb = control; const [x, y, width, height] = controls[control]!; place(node, x, y, width, height); }
      else if (rect) place(node, ...rect);
      node.style.color = '#e0e0e0'; return node;
    };
    // frmMain: lblWeapon, lblShielder, lblHelm, lblArmor, lblResis, lbldm; Fuerzalbl/AgilidadLbl sit beside the gold.
    this.stat = {
      weapon: label('weapon', '0/0', 'lblWeapon'), shield: label('shield', '0/0', 'lblShielder'), helmet: label('helmet', '0/0', 'lblHelm'),
      armour: label('armour', '0/0', 'lblArmor'), resistance: label('resistance', '+0', 'lblResis'), damage: label('damage', '+0%', 'lbldm'),
      agility: label('agility', '', undefined, [199, 38, 14, 18]), strength: label('strength', '', undefined, [239, 38, 14, 18]),
    };
    this.stat.agility.style.color = this.stat.strength.style.color = '#fff';
    this.stat.agility.title = 'Agilidad'; this.stat.strength.title = 'Fuerza';
    // GldLbl_Click: clicking the gold selects it and opens frmCantidad.
    const goldButton = make('button', 'hotspot items-gold', panel, 'gold-button'); goldButton.type = 'button';
    place(goldButton, 32, 36, 60, 22); goldButton.setAttribute('aria-label', 'Oro'); goldButton.title = 'Tirar oro';
    goldButton.onclick = () => { this.ui.selectGold(); if ((this.session?.ui.stats.gold ?? 0) > 0) this.openAmount(); };

    // frmCantidad.frm, 291x193, shown over the main window.
    this.amountDialog = make('section', 'items-window', root, 'amount-dialog'); this.amountDialog.hidden = true;
    this.amountDialog.setAttribute('role', 'dialog'); this.amountDialog.setAttribute('aria-label', 'Cantidad');
    place(this.amountDialog, 366, 287, 291, 193);
    void loadInterface('cantidad').then(url => { this.amountDialog.style.backgroundImage = `url("${url}")`; }).catch(() => {});
    this.amountInput = make('input', 'items-input', this.amountDialog, 'amount-input'); this.amountInput.value = '1'; this.amountInput.inputMode = 'numeric';
    this.amountInput.setAttribute('aria-label', 'Cantidad a tirar'); place(this.amountInput, 94, 108, 104, 16); digitsOnly(this.amountInput);
    // cmdMas only adds below MAX_INVENTORY_OBJS (10000, gold too); cmdMenos stops at 0; Text1_Change caps typing at 10000 (items) or 100000 (gold).
    const bump = (delta: number) => { const value = Number(this.amountInput.value || 0); if (delta > 0 ? value < 10_000 : value > 0) this.amountInput.value = String(value + delta); };
    this.amountInput.addEventListener('input', () => { const cap = this.ui.selectedSlot === GOLD_SLOT ? 100_000 : 10_000; if (Number(this.amountInput.value) > cap) this.amountInput.value = String(cap); });
    artButton(this.amountDialog, 'amount-minus', 'Menos', 'boton-sm-menos', 64, 107, 21, 21, () => bump(-1));
    artButton(this.amountDialog, 'amount-plus', 'Más', 'boton-sm-mas', 208, 107, 21, 21, () => bump(1));
    artButton(this.amountDialog, 'amount-close', 'Cerrar', 'boton-cerrar', 260, 1, 31, 28, () => this.closeAmount());
    artButton(this.amountDialog, 'amount-drop', 'Tirar', 'boton-tirar', 29, 144, 112, 28, () => this.throwTyped());
    artButton(this.amountDialog, 'amount-drop-all', 'Tirar todo', 'boton-tirar-todo', 150, 145, 112, 28, () => this.throwAll());
    this.amountInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); this.throwTyped(); } });

    // The classic question box for objects that are destroyed when dropped.
    this.confirm = make('section', 'items-window items-confirm', root, 'destroy-confirm'); this.confirm.hidden = true;
    this.confirm.setAttribute('role', 'alertdialog'); this.confirm.setAttribute('aria-label', 'Confirmar');
    place(this.confirm, 362, 330, 300, 100);
    this.confirmText = make('p', '', this.confirm); this.confirmText.textContent = 'El item se destruira al tirarlo ¿Esta seguro?';
    for (const [text, accept] of [['Sí', true], ['No', false]] as const) {
      const button = make('button', 'items-confirm-button', this.confirm); button.type = 'button'; button.textContent = text;
      button.onclick = () => this.answerDestroy(accept);
    }

    // frmCollectibleCard.frm "Card Viewer" (6555x8970 twips = 437x598): the card picture and "Add to collection" (cmdAccept = UseItem of the slot).
    // The card art (Obj.dat CollectibleCardImgPathing under interface/) is not part of the local mount: the window then shows the object's name.
    this.card = make('section', 'items-window items-card', root, 'card-viewer'); this.card.hidden = true;
    this.card.setAttribute('role', 'dialog'); this.card.setAttribute('aria-label', 'Visualizador de cartas');
    place(this.card, 293, 0, 437, 598);
    this.cardTitle = make('p', 'items-card-title', this.card);
    this.cardImage = make('img', 'items-card-image', this.card); this.cardImage.alt = ''; this.cardImage.onerror = () => { this.cardImage.hidden = true; };
    const accept = make('button', 'items-confirm-button items-card-accept', this.card, 'card-accept'); accept.type = 'button'; accept.textContent = 'Añadir a la colección';
    accept.onclick = () => { this.session?.itemActions.acceptCard(); };
    const cancel = make('button', 'items-confirm-button items-card-cancel', this.card, 'card-cancel'); cancel.type = 'button'; cancel.textContent = 'Cerrar';
    cancel.onclick = () => { this.session?.itemActions.cancelCard(); };

    // frmComerciar.frm, 544x476 centred over frmMain; comerciar.bmp is 542x481.
    this.shop = make('section', 'items-window', root, 'shop'); this.shop.hidden = true;
    this.shop.setAttribute('role', 'dialog'); this.shop.setAttribute('aria-label', 'Comerciando con el NPC');
    place(this.shop, 241, 143, 542, 481);
    void loadInterface('comerciar').then(url => { this.shop.style.backgroundImage = `url("${url}")`; }).catch(() => {});
    const makeSlots = (views: SlotView[], side: 'npc' | 'user', left: number) => {
      for (let i = 0; i < 42; i++) {
        const button = make('button', 'items-slot', this.shop); button.type = 'button';
        place(button, left + (i % 6) * 35, 107 + Math.floor(i / 6) * 35, 34, 34);
        button.dataset.side = side; button.dataset.slot = String(i + 1);
        button.onclick = () => { this.shopSelected = { side, slot: i + 1 }; this.dirty = true; this.renderShop(); };
        if (side === 'user') button.ondblclick = () => { this.session?.itemActions.activate(i + 1, true); };
        views.push({ button, key: '', token: 0 });
      }
    };
    makeSlots(this.shopNpc, 'npc', 43); makeSlots(this.shopUser, 'user', 295);
    this.shopName = make('span', 'items-name', this.shop, 'shop-item-name'); place(this.shopName, 168, 374, 209, 25);
    this.shopDesc = make('span', 'items-desc', this.shop, 'shop-item-desc'); place(this.shopDesc, 168, 396, 209, 25);
    this.shopCost = make('span', 'items-cost', this.shop, 'shop-item-cost'); place(this.shopCost, 424, 370, 81, 17);
    this.shopAmount = make('input', 'items-input', this.shop, 'shop-amount'); this.shopAmount.value = '1'; this.shopAmount.inputMode = 'numeric';
    this.shopAmount.setAttribute('aria-label', 'Cantidad'); place(this.shopAmount, 245, 437, 54, 14); digitsOnly(this.shopAmount);
    this.shopAmount.addEventListener('input', () => { this.dirty = true; this.renderShop(); });
    const step = (delta: number) => { this.shopAmount.value = String(Math.min(10000, Math.max(1, Number(this.shopAmount.value || 0) + delta))); this.dirty = true; this.renderShop(); };
    artButton(this.shop, 'shop-minus', 'Menos', 'boton-sm-menos', 213, 435, 21, 21, () => step(-1));
    artButton(this.shop, 'shop-plus', 'Más', 'boton-sm-mas', 310, 434, 21, 21, () => step(1));
    artButton(this.shop, 'shop-buy', 'Comprar', 'boton-comprar', 55, 431, 122, 28, () => this.buy());
    artButton(this.shop, 'shop-sell', 'Vender', 'boton-vender', 367, 431, 122, 28, () => this.sell());
    artButton(this.shop, 'shop-close', 'Cerrar', 'boton-cerrar', 512, 0, 31, 28, () => this.closeShop());
    windows.watchElement('shop', this.shop, () => this.closeShop());
    windows.watchElement('card-viewer', this.card, () => { this.session?.itemActions.cancelCard(); this.card.hidden = true; });
    this.shop.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.closeShop(); } });
  }

  get shopVisible() { return !this.shop.hidden; }
  get dialogOpen() { return !this.amountDialog.hidden || !this.confirm.hidden || !this.shop.hidden; }

  /** TirarItem: one object drops at once, a stack asks for the amount, a destroyed object asks first. */
  dropSelected() {
    const session = this.session, slot = this.ui.selectedSlot;
    if (!session?.ready || !(slot > 0 && slot <= 42 || slot === GOLD_SLOT)) return;
    const actions = session.itemActions;
    if (session.items.shopOpen) { session.ui.message('No podés tirar objetos mientras comerciás.'); return; }
    if (actions.dropNeedsAmount(slot)) { this.openAmount(); return; }
    this.drop(slot, 1);
  }
  private drop(slot: number, amount: number) {
    const actions = this.session?.itemActions;
    if (!actions) return;
    if (actions.destroys(slot)) { this.pendingDestroy = { slot, amount }; this.confirm.hidden = false; this.confirm.querySelector('button')?.focus(); return; }
    actions.drop(slot, amount);
  }
  private answerDestroy(accept: boolean) {
    const pending = this.pendingDestroy; this.pendingDestroy = undefined; this.confirm.hidden = true;
    if (accept && pending) this.session?.itemActions.drop(pending.slot, pending.amount);
  }
  private openAmount() { this.amountInput.value = '1'; this.amountDialog.hidden = false; this.amountInput.focus(); this.amountInput.select(); }
  private closeAmount() { this.amountDialog.hidden = true; this.amountInput.blur(); }
  private throwTyped() {
    const slot = this.ui.selectedSlot, amount = Number(this.amountInput.value);
    if (!this.amountInput.value || !Number.isInteger(amount) || amount < 1) return;
    const max = slot === GOLD_SLOT ? 100_000 : 10_000;
    this.closeAmount(); this.drop(slot, Math.min(amount, max));
  }
  private throwAll() {
    const slot = this.ui.selectedSlot, session = this.session;
    if (!session || slot === 0) return;
    const amount = slot === GOLD_SLOT ? Math.min(session.ui.stats.gold ?? 0, 100_000) : session.ui.inventory.get(slot)?.amount ?? 0;
    this.closeAmount(); if (amount > 0) this.drop(slot, amount);
  }
  closeDialogs() {
    this.session?.itemActions.cancelCard(); this.card.hidden = true;
    this.closeAmount(); this.confirm.hidden = true; this.pendingDestroy = undefined;
    if (this.shopVisible) this.closeShop();
  }
  private closeShop() {
    this.session?.itemActions.closeShop(); this.shop.hidden = true; this.shopSelected = undefined;
  }
  private typedAmount() { const value = Number(this.shopAmount.value); return Number.isFinite(value) ? Math.trunc(value) : 0; }
  private buy() {
    const selected = this.shopSelected; if (selected?.side !== 'npc') return;
    this.session?.itemActions.buy(selected.slot, this.typedAmount());
  }
  private sell() {
    const selected = this.shopSelected; if (selected?.side !== 'user') return;
    this.session?.itemActions.sell(selected.slot, this.typedAmount());
  }

  update(session: Session | undefined) {
    if (this.session !== session) {
      this.session = session; this.revision = -1; this.shop.hidden = true; this.closeAmount(); this.confirm.hidden = true; this.shopSelected = undefined;
    }
    if (!session) return;
    const stats = session.ui.stats;
    const level = stats.level ?? session.characterLevel ?? 0;
    // UpdateGoldState: gold over the per-level cap shows red.
    const gold = element('gold');
    gold.style.color = (stats.gold ?? 0) > level * (stats.goldPerLevel ?? 0) ? '#ff0000' : '#ffff80';
    // frmCollectibleCard: open while a card slot is being viewed.
    const card = session.items.card;
    if (card && this.card.hidden) {
      const item = session.ui.inventory.get(card.slot), info = item ? session.catalog?.get(item.object) : undefined;
      this.cardTitle.textContent = info?.name ?? '';
      this.cardImage.hidden = !info?.cardImage;
      if (info?.cardImage) this.cardImage.src = assetUrl(`interface/${info.cardImage.replace(/\\/g, '/')}`);
      this.card.hidden = false;
    } else if (!card && !this.card.hidden) this.card.hidden = true;
    const open = session.items.shopOpen;
    if (open && this.shop.hidden) { this.shop.hidden = false; this.shopSelected = undefined; this.shopAmount.value = '1'; this.dirty = true; }
    if (!open && !this.shop.hidden) { this.shop.hidden = true; this.shopSelected = undefined; }
    const revision = session.items.revision + session.ui.revision;
    if (revision === this.revision && !this.dirty) return;
    this.revision = revision; this.dirty = false;
    this.renderStats(session);
    if (open) this.renderShop();
  }

  private renderStats(session: Session) {
    const catalog = session.catalog, equipped = { weapon: '0/0', shield: '0/0', helmet: '0/0', armour: '0/0' };
    if (catalog) for (const item of session.ui.inventory.values()) {
      if (!item.equipped) continue;
      const info = catalog.get(item.object); if (!info) continue;
      if (info.type === ObjType.Weapon) equipped.weapon = `${info.minHit}/${info.maxHit}`;
      else if (info.type === ObjType.Armour) equipped.armour = `${info.minDef}/${info.maxDef}`;
      else if (info.type === ObjType.Shield) equipped.shield = `${info.minDef}/${info.maxDef}`;
      else if (info.type === ObjType.Helmet) equipped.helmet = `${info.minDef}/${info.maxDef}`;
    }
    for (const key of ['weapon', 'shield', 'helmet', 'armour'] as const) this.stat[key].textContent = equipped[key];
    this.stat.resistance.textContent = `+${session.items.resistanceBonus}%`;
    this.stat.damage.textContent = `+${session.items.damageBonus}%`;
    const attributes = session.items.attributes;
    this.stat.strength.textContent = attributes ? String(attributes.strength) : '';
    this.stat.agility.textContent = attributes ? String(attributes.agility) : '';
    if (attributes) {
      this.stat.strength.style.color = buffColor(attributes.strength, attributes.strengthBase);
      this.stat.agility.style.color = buffColor(attributes.agility, attributes.agilityBase);
    }
  }

  private renderShop() {
    const session = this.session; if (!session) return;
    const catalog = session.catalog, state = session.items;
    const selected = this.shopSelected;
    const draw = (views: SlotView[], side: 'npc' | 'user') => views.forEach(async (view, i) => {
      const slot = i + 1;
      const npcSlot = side === 'npc' ? state.shopSlots.get(slot) : undefined;
      const userSlot = side === 'user' ? session.ui.inventory.get(slot) : undefined;
      const object = npcSlot?.object ?? userSlot?.object, amount = npcSlot?.amount ?? userSlot?.amount ?? 0;
      const locked = side === 'user' && slot > 24 + session.ui.unlockedRows * 6;
      const info = object ? catalog?.get(object) : undefined;
      const key = `${object ?? 0}/${amount}/${userSlot?.equipped ?? false}/${locked}/${side === 'user' ? session.ui.unlockedRows : 0}`;
      view.button.setAttribute('aria-pressed', String(selected?.side === side && selected.slot === slot));
      view.button.setAttribute('aria-disabled', String(locked));
      const name = info?.name ?? (object ? `Objeto ${object}` : locked ? 'Bloqueada' : 'Vacía');
      view.button.title = name; view.button.setAttribute('aria-label', `${side === 'npc' ? 'Oferta' : 'Inventario'} ${slot}: ${name}${object ? ` × ${amount}` : ''}`);
      if (view.key === key) return;
      const token = ++view.token; view.key = key;
      const [art, background] = await Promise.all([
        info?.grh && object ? this.ui.itemArt(info.grh) : undefined,
        this.ui.slotBackground(locked ? 1122 : side === 'user' && slot > 24 ? 47742 : 47743),
      ]);
      if (token !== view.token) return;
      view.button.style.backgroundImage = background.image; view.button.style.backgroundPosition = background.position;
      view.button.replaceChildren();
      if (art) view.button.append(art);
      if (object && amount > 1) { const quantity = make('span', 'quantity', view.button); quantity.textContent = String(amount); }
      if (userSlot?.equipped) { const marker = make('span', 'equipped', view.button); marker.textContent = '+'; }
    });
    draw(this.shopNpc, 'npc'); draw(this.shopUser, 'user');
    // DrawInterfaceComerciar: name + usability, description and the price for the typed amount.
    let offer: { object: number; value: number; canUse: number; amount: number } | undefined, quantity = this.typedAmount();
    if (selected?.side === 'npc') { const slot = state.shopSlots.get(selected.slot); if (slot) offer = slot; }
    else if (selected?.side === 'user') {
      const slot = session.ui.inventory.get(selected.slot);
      if (slot) { offer = { object: slot.object, value: slot.value, canUse: slot.canUse, amount: slot.amount }; quantity = Math.min(quantity, slot.amount); }
    }
    const info = offer ? catalog?.get(offer.object) : undefined;
    this.shopName.textContent = offer ? `${info?.name ?? `Objeto ${offer.object}`}${usableSuffix(offer.canUse)}` : '(Vacío)';
    this.shopDesc.textContent = offer ? itemInfo(info) : '';
    this.shopCost.textContent = offer ? withDots(Math.trunc(offer.value * Math.max(0, quantity))) : '0';
  }
}
const element = (id: string) => document.getElementById(id)!;
