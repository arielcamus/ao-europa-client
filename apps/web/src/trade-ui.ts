/*
 * Player-to-player trade: the trade window (frmComerciarUsu.frm), the request text window (frmUserRequest.frm) and the in-world
 * yes/no question that asks the other player (TileEngine_RenderScreen "Pregunta", answered in frmMain.renderer_MouseDown).
 * Geometry is the original VB6 twips / 15. AGPL-3.0-or-later; see NOTICE. Artwork is read only from the local mount.
 */
import { TRADE_OFFER_SLOTS } from '@ao/protocol';
import { make, place, artButton, digitsInput, windowBackground, paintSlot, withDots } from './bank-trade-dom.js';
import type { SlotView } from './bank-trade-dom.js';
import { loadObjectCatalog } from './object-catalog.js';
import type { ObjectCatalog } from './object-catalog.js';
import { sharedLocale } from './chat-locale.js';
import type { SlotArt } from './bank-trade-dom.js';
import type { Session } from './session.js';

/** frmComerciarUsu.Form_Load: the red warning that opens RecTxt (AddtoRichTextBox 255, 19, 19). */
/** The server keeps ONE offer per side (HandleUserCommerceOffer: ComUsu.Objeto > 0 -> locale 1142): an item or gold, not six independent slots. */
export const TRADE_RULE = 'Solo puedes hacer una oferta: un objeto o un monto de oro. Para cambiarla, rechaza y vuelve a empezar.';
export const TRADE_WARNING = 'Antes de aceptar la transacción asegúrate de tener suficiente espacio en tu inventario, de lo contrario los items sobrantes caerán al piso.';
const INVENTORY_SLOTS = 42;
const CHAT_PLACEHOLDER = 'Escribe un mensaje...';
/** Pregunta hit areas, frmMain.renderer_MouseDown (viewport pixels). */
export const QUESTION_HIT = { no: [419, 243, 434, 261], yes: [443, 243, 459, 261] } as const;

export class TradeUI {
  private session: Session | undefined;
  private catalog: ObjectCatalog | undefined;
  private revision = -1; private dirty = true;
  private readonly trade: HTMLElement;
  private readonly inventory: SlotView[] = []; private readonly mineView: SlotView[] = []; private readonly otherView: SlotView[] = [];
  private selected = 0; private selectedMine = 0; private selectedOther = 0;
  private readonly amount: HTMLInputElement; private readonly goldInput: HTMLInputElement;
  private readonly myGold: HTMLElement; private readonly myOfferGold: HTMLElement; private readonly otherGold: HTMLElement;
  private readonly itemName: HTMLElement; private readonly mineName: HTMLElement; private readonly otherName: HTMLElement;
  private readonly log: HTMLElement; private readonly chatBox: HTMLInputElement;
  private readonly request: HTMLElement; private readonly requestText: HTMLTextAreaElement; private shownRequests = 0;
  private readonly question: HTMLElement; private readonly questionText: HTMLElement; private shownQuestion = 0;

  constructor(root: HTMLElement, viewport: HTMLElement, private readonly art: SlotArt, private readonly report: (message: string) => void) {
    void loadObjectCatalog().then(catalog => { this.catalog = catalog; this.dirty = true; }).catch(error => report(`Obj.dat: ${String(error)}`));

    // frmComerciarUsu.frm, 575x583 centred; ventanacomercio.bmp.
    this.trade = make('section', 'bt-window bt-trade', root, 'trade'); this.trade.hidden = true;
    this.trade.setAttribute('role', 'dialog'); this.trade.setAttribute('aria-label', 'Comercio seguro');
    place(this.trade, 224, 92, 576, 583); windowBackground(this.trade, 'ventanacomercio');
    const slots = (views: SlotView[], count: number, left: number, top: number, kind: 'inventory' | 'mine' | 'other') => {
      for (let i = 0; i < count; i++) {
        const button = make('button', 'bt-slot', this.trade); button.type = 'button';
        place(button, left + (i % 6) * 35, top + Math.floor(i / 6) * 35, 34, 34); button.dataset.slot = String(i + 1); button.dataset.kind = kind;
        button.onclick = () => this.select(kind, i + 1);
        views.push({ button, key: '', token: 0 });
      }
    };
    slots(this.inventory, INVENTORY_SLOTS, 49, 144, 'inventory'); slots(this.mineView, TRADE_OFFER_SLOTS, 318, 144, 'mine'); slots(this.otherView, TRADE_OFFER_SLOTS, 318, 245, 'other');
    this.itemName = make('span', 'bt-label bt-right', this.trade, 'trade-item-name'); place(this.itemName, 100, 440, 157, 14);
    this.mineName = make('span', 'bt-label bt-right', this.trade, 'trade-my-offer-name'); place(this.mineName, 380, 189, 150, 14);
    this.otherName = make('span', 'bt-label bt-right', this.trade, 'trade-other-offer-name'); place(this.otherName, 380, 288, 150, 14);
    this.myGold = make('span', 'bt-gold', this.trade, 'trade-my-gold'); place(this.myGold, 72, 440, 137, 17);
    this.myOfferGold = make('span', 'bt-gold', this.trade, 'trade-my-offer-gold'); place(this.myOfferGold, 344, 189, 89, 17);
    this.otherGold = make('span', 'bt-gold', this.trade, 'trade-other-gold'); place(this.otherGold, 344, 288, 89, 17);
    this.amount = digitsInput(this.trade, 'trade-amount', 'Cantidad', '1', 86, 402, 45, 13, 10);
    this.amount.addEventListener('change', () => { const value = Number(this.amount.value); this.amount.value = String(!Number.isFinite(value) || value < 1 ? 1 : Math.min(2147483647, value)); });
    this.goldInput = digitsInput(this.trade, 'trade-gold', 'Oro a ofrecer', '1', 56, 467, 117, 13, 10);
    artButton(this.trade, 'trade-minus', 'Menos', 'boton-sm-menos', 52, 399, 19, 19, () => { if (Number(this.amount.value) > 0) this.amount.value = String(Number(this.amount.value) - 1); });
    artButton(this.trade, 'trade-plus', 'Más', 'boton-sm-mas', 144, 399, 19, 19, () => { if (Number(this.amount.value) < 10000) this.amount.value = String(Number(this.amount.value) + 1); });
    artButton(this.trade, 'trade-offer', 'Ofrecer', 'boton-ofrecer', 185, 396, 75, 28, () => {
      if (this.selected > 0) this.session?.bankTradeActions.offerItem(this.selected, Number(this.amount.value));
    });
    artButton(this.trade, 'trade-offer-gold', 'Ofrecer oro', 'boton-ofrecer', 185, 460, 75, 28, () => {
      if (Number(this.goldInput.value) > 0) this.session?.bankTradeActions.offerGold(Number(this.goldInput.value));
    });
    artButton(this.trade, 'trade-reject', 'Rechazar', 'boton-rechazar', 138, 533, 132, 28, () => this.session?.bankTradeActions.rejectTrade());
    artButton(this.trade, 'trade-accept', 'Aceptar', 'boton-aceptar', 306, 533, 132, 28, () => this.session?.bankTradeActions.acceptTrade());
    artButton(this.trade, 'trade-close', 'Cerrar', 'boton-cerrar', 544, 0, 33, 33, () => this.session?.bankTradeActions.rejectTrade());
    this.log = make('div', 'bt-log', this.trade, 'trade-log'); place(this.log, 322, 349, 205, 111);
    this.log.setAttribute('role', 'log'); this.log.setAttribute('aria-label', 'Mensajes del comercio');
    this.chatBox = make('input', 'bt-chat', this.trade, 'trade-chat'); place(this.chatBox, 326, 466, 200, 18);
    this.chatBox.value = CHAT_PLACEHOLDER; this.chatBox.setAttribute('aria-label', 'Mensaje al otro jugador'); this.chatBox.maxLength = 255; this.chatBox.classList.add('placeholder');
    this.chatBox.addEventListener('focus', () => { if (this.chatBox.classList.contains('placeholder')) { this.chatBox.value = ''; this.chatBox.classList.remove('placeholder'); } });
    this.chatBox.addEventListener('blur', () => { if (!this.chatBox.value) { this.chatBox.value = CHAT_PLACEHOLDER; this.chatBox.classList.add('placeholder'); } });
    this.chatBox.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault(); event.stopPropagation();
      if (this.chatBox.value && this.session?.bankTradeActions.sendTradeChat(this.chatBox.value)) this.chatBox.value = '';
    });
    // Form_KeyPress 27 unloads the window; the client then tells the server with WriteUserCommerceEnd so nobody is left waiting.
    this.trade.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.session?.bankTradeActions.endTrade(); } });

    // frmUserRequest.frm: a plain tool window, 310x162, text box and a Cerrar button.
    this.request = make('section', 'bt-request', root, 'user-request'); this.request.hidden = true;
    this.request.setAttribute('role', 'dialog'); this.request.setAttribute('aria-label', 'Petición');
    place(this.request, 357, 303, 310, 162);
    const title = make('div', 'bt-request-title', this.request); title.textContent = 'Petición';
    this.requestText = make('textarea', 'bt-request-text', this.request, 'user-request-text'); this.requestText.readOnly = false;
    this.requestText.setAttribute('aria-label', 'Petición recibida'); place(this.requestText, 8, 28, 290, 105);
    const close = make('button', 'bt-request-close', this.request, 'user-request-close'); close.type = 'button'; close.textContent = 'Cerrar'; place(close, 8, 120, 290, 33);
    close.onclick = () => { this.request.hidden = true; };

    // The question box, drawn over the 736x608 world view.
    this.question = make('div', 'bt-question', viewport, 'question'); this.question.hidden = true;
    this.question.setAttribute('role', 'alertdialog'); this.question.setAttribute('aria-label', 'Pregunta');
    place(this.question, 283, 170, 190, 100);
    // A click on the box answers it; it must not also become a LeftClick on the world tile underneath.
    this.question.addEventListener('pointerdown', event => event.stopPropagation());
    const inner = make('div', 'bt-question-inner', this.question); place(inner, 5, 5, 180, 90);
    this.questionText = make('div', 'bt-question-text', inner, 'question-text'); place(this.questionText, 2, 5, 176, 50);
    const picture = make('div', 'bt-question-art', this.question); place(picture, 133, 63, 68, 28);
    void this.art.slotBackground(32120).then(frame => { picture.style.backgroundImage = frame.image; picture.style.backgroundPosition = frame.position; }).catch(() => {});
    for (const [id, label, [x1, y1, x2, y2], accept] of [['question-no', 'No', QUESTION_HIT.no, false], ['question-yes', 'Sí', QUESTION_HIT.yes, true]] as const) {
      const button = make('button', 'bt-question-hit', this.question, id); button.type = 'button'; button.setAttribute('aria-label', label); button.title = label;
      place(button, x1 - 283, y1 - 170, x2 - x1, y2 - y1); button.onclick = () => this.session?.bankTradeActions.answerQuestion(accept);
    }
  }

  get dialogOpen() { return !this.trade.hidden; }
  closeDialogs() { if (!this.trade.hidden) this.session?.bankTradeActions.endTrade(); }

  private select(kind: 'inventory' | 'mine' | 'other', slot: number) {
    if (kind === 'inventory') this.selected = this.session?.ui.inventory.has(slot) ? slot : 0;
    else if (kind === 'mine') this.selectedMine = slot; else this.selectedOther = slot;
    this.dirty = true; this.render();
  }
  private itemTitle(object: number, name: string) { return object ? this.catalog?.get(object)?.name ?? name : 'Vacío'; }

  update(session: Session | undefined) {
    if (this.session !== session) {
      this.session = session; this.revision = -1; this.trade.hidden = true; this.request.hidden = true; this.question.hidden = true;
      this.shownRequests = 0; this.shownQuestion = 0;
    }
    if (!session) return;
    const state = session.bankTrade;
    if (state.tradeOpen && this.trade.hidden) {
      this.trade.hidden = false; this.selected = 0; this.selectedMine = 0; this.selectedOther = 0; this.amount.value = '1'; this.goldInput.value = '1';
      this.chatBox.value = CHAT_PLACEHOLDER; this.chatBox.classList.add('placeholder'); this.dirty = true; this.trade.tabIndex = -1; this.trade.focus();
    }
    if (!state.tradeOpen && !this.trade.hidden) this.trade.hidden = true;
    if (state.requests.length > this.shownRequests) {
      this.requestText.value = state.requests.at(-1)!; this.shownRequests = state.requests.length; this.request.hidden = false;
    }
    const q = state.question;
    if (!q) { this.question.hidden = true; this.shownQuestion = 0; }
    else if (q.at !== this.shownQuestion) {
      this.shownQuestion = q.at; this.questionText.textContent = sharedLocale.message(q.messageId, q.param) || `Pregunta ${q.messageId}`; this.question.hidden = false;
    }
    const revision = state.revision + session.ui.revision;
    if (revision === this.revision && !this.dirty) return;
    this.revision = revision; this.dirty = false;
    if (!this.trade.hidden) this.render();
  }

  private render() {
    const session = this.session; if (!session) return;
    const state = session.bankTrade, catalog = this.catalog;
    // HandleChangeUserTradeSlot: lblMyGold shows what is left after the gold I put on the table.
    this.myGold.textContent = withDots((session.ui.stats.gold ?? 0) - state.mine.gold);
    this.myOfferGold.textContent = withDots(state.mine.gold); this.otherGold.textContent = withDots(state.other.gold);
    this.inventory.forEach((view, i) => {
      const slot = i + 1, item = session.ui.inventory.get(slot), info = item ? catalog?.get(item.object) : undefined;
      const locked = slot > 24 + session.ui.unlockedRows * 6;
      void paintSlot(view, this.art, slot, {
        object: item?.object ?? 0, amount: item?.amount ?? 0, grh: info?.grh ?? 0, equipped: item?.equipped ?? false,
        name: info?.name ?? `Objeto ${item?.object ?? 0}`, locked, frame: locked ? 1122 : slot > 24 ? 47742 : 47743,
      }, this.selected === slot, 'Inventario');
    });
    const offers = (views: SlotView[], offer: typeof state.mine, picked: number, label: string) => views.forEach((view, i) => {
      const item = offer.items[i]!;
      void paintSlot(view, this.art, i + 1, { object: item.object, amount: item.amount, grh: item.grh, name: item.name || `Objeto ${item.object}`, frame: 47743 }, picked === i + 1, label);
    });
    offers(this.mineView, state.mine, this.selectedMine, 'Mi oferta'); offers(this.otherView, state.other, this.selectedOther, 'Oferta del otro');
    const inv = this.selected ? session.ui.inventory.get(this.selected) : undefined;
    this.itemName.textContent = inv ? this.itemTitle(inv.object, '') : 'Vacío';
    const mine = this.selectedMine ? state.mine.items[this.selectedMine - 1] : undefined, other = this.selectedOther ? state.other.items[this.selectedOther - 1] : undefined;
    this.mineName.textContent = mine ? this.itemTitle(mine.object, mine.name) : 'Vacío';
    this.otherName.textContent = other ? this.itemTitle(other.object, other.name) : 'Vacío';
    const notices = state.tradeNotices.map(n => ({ text: sharedLocale.message(n.messageId, n.text) || `Mensaje ${n.messageId}`, warning: true }));
    const lines = [{ text: TRADE_WARNING, warning: true }, { text: TRADE_RULE, warning: false }, ...state.tradeChat.map(text => ({ text, warning: false })), ...notices];
    this.log.replaceChildren(...lines.map(line => { const row = make('div', line.warning ? 'bt-log-warning' : 'bt-log-line'); row.textContent = line.text; return row; }));
    this.log.scrollTop = this.log.scrollHeight;
  }
}
