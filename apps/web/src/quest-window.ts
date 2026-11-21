/*
 * The two quest forms, adapted 2026-11-20 from client FrmQuest.frm (FrmQuests, the quest log opened by the Quests button) and
 * frmQuestInfo.frm (FrmQuestInfo, the offer an NPC or a quest item makes). Positions are the original VB6 twips / 15, relative
 * to each form; the artwork is es_ventanadetallemision.bmp / es_ventananuevamision.bmp and the *-over buttons from the local mount.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty. See NOTICE.
 */
import { windows } from './window-stack.js';
import './quest-window.css';
import { fetchText } from './assets.js';
import { loadInterface } from './interface-assets.js';
import { Icons } from './icons.js';
import { makeDraggable } from './window-drag.js';
import type { QuestVoice } from './quest-voice.js';
import { QuestCatalog, detailsView, offerView } from './quests.js';
import type { QuestRow } from './quests.js';
import type { Session } from './session.js';
import type { WorldRenderer } from './renderer.js';

type Box = readonly [left: number, top: number, width: number, height: number];
function node<T extends HTMLElement = HTMLDivElement>(parent: HTMLElement, className: string, box?: Box, tag = 'div'): T {
  const el = document.createElement(tag) as T; el.className = className;
  if (box) { el.style.left = `${box[0]}px`; el.style.top = `${box[1]}px`; el.style.width = `${box[2]}px`; el.style.height = `${box[3]}px`; }
  parent.append(el); return el;
}

/** One quest form: background art, hover buttons, the two item tables, the preview boxes and the MsgBox stand-in. */
class Form {
  readonly root: HTMLElement;
  readonly title: HTMLElement; readonly repeatable: HTMLElement; readonly description: HTMLElement; readonly info: HTMLElement;
  readonly mainList: HTMLElement; readonly objectives: HTMLElement; readonly rewards: HTMLElement;
  previewToken = 0; rewardToken = 0;
  readonly preview: HTMLElement; readonly previewLabel: HTMLElement; readonly rewardIcon: HTMLElement; readonly rewardLabel: HTMLElement;
  constructor(parent: HTMLElement, id: string, label: string, readonly size: readonly [number, number], layout: Record<string, Box>, readonly art: string) {
    this.root = node(parent, 'quest-form', [Math.floor((1024 - size[0]) / 2), Math.floor((768 - size[1]) / 2), size[0], size[1]]);
    this.root.id = id; this.root.hidden = true; this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', label);
    this.title = node(this.root, 'q-title', layout.titulo);
    this.repeatable = node(this.root, 'q-repeatable', layout.lblRepetible); this.repeatable.textContent = 'Misión repetible'; this.repeatable.hidden = true;
    this.description = node(this.root, 'q-rich q-center', layout.description);
    this.info = node(this.root, 'q-rich q-left', layout.info ?? [0, 0, 0, 0]); if (!layout.info) this.info.hidden = true;
    this.mainList = node(this.root, 'q-main-list', layout.list); this.mainList.setAttribute('role', 'listbox');
    this.objectives = node(this.root, 'q-table', layout.ListView1); this.objectives.setAttribute('role', 'listbox'); this.objectives.setAttribute('aria-label', 'Objetivos');
    this.rewards = node(this.root, 'q-table q-small', layout.ListView2); this.rewards.setAttribute('role', 'listbox'); this.rewards.setAttribute('aria-label', 'Recompensas');
    this.preview = node(this.root, 'q-preview', layout.PlayerView);
    this.previewLabel = node(this.root, 'q-label', layout.npclbl);
    this.rewardIcon = node(this.root, 'q-reward-icon', layout.picture1); this.rewardIcon.hidden = true;
    this.rewardLabel = node(this.root, 'q-label', layout.objetolbl);
    void loadInterface(art).then(url => { this.root.style.backgroundImage = `url("${url}")`; }).catch(() => {});
    makeDraggable(this.root); // FrmQuest / frmQuestInfo Form_MouseDown: MoverForm
  }
  get visible() { return !this.root.hidden; }
  /** An invisible button over the form's artwork; its `-over` bitmap shows while the pointer is on it (Image*_MouseMove). */
  hotspot(label: string, box: Box, over: string | undefined, action: () => void): HTMLButtonElement {
    const button = node<HTMLButtonElement>(this.root, 'q-hotspot', box, 'button');
    button.type = 'button'; button.setAttribute('aria-label', label); button.title = label;
    if (over) {
      void loadInterface(over).then(url => {
        button.addEventListener('mouseenter', () => { button.style.backgroundImage = `url("${url}")`; });
        button.addEventListener('mouseleave', () => { button.style.backgroundImage = ''; });
      }).catch(() => {});
    }
    button.addEventListener('click', action);
    return button;
  }
  /** MsgBox(vbOKOnly / vbYesNo + vbExclamation, "Advertencia"). */
  message(text: string, buttons: { label: string; action?: () => void }[]) {
    this.root.querySelector('.q-msgbox')?.remove();
    const box = node(this.root, 'q-msgbox'); box.setAttribute('role', 'alertdialog');
    const title = node(box, 'q-msg-title'); title.textContent = 'Advertencia';
    const body = node(box, 'q-msg-text'); body.textContent = text;
    const row = node(box, 'q-msg-buttons');
    for (const entry of buttons) {
      const button = node<HTMLButtonElement>(row, 'q-msg-button', undefined, 'button'); button.type = 'button'; button.textContent = entry.label;
      button.addEventListener('click', () => { box.remove(); entry.action?.(); });
    }
    box.querySelector('button')?.focus();
  }
}

// Positions are the .frm twips divided by 15.
const logLayout: Record<string, Box> = {
  titulo: [264, 113, 217, 17], lblRepetible: [325, 125, 97, 17], description: [256, 142, 217, 217], info: [29, 256, 212, 105],
  list: [37, 120, 197, 80], ListView1: [489, 112, 147, 103], ListView2: [659, 200, 126, 147], PlayerView: [488, 253, 149, 81],
  npclbl: [488, 336, 147, 35], picture1: [704, 123, 32, 32], objetolbl: [664, 168, 113, 29],
};
const offerLayout: Record<string, Box> = {
  titulo: [256, 120, 225, 17], lblRepetible: [320, 136, 97, 17], description: [264, 160, 209, 193], list: [40, 128, 189, 176],
  ListView1: [487, 112, 150, 104], ListView2: [656, 200, 131, 152], PlayerView: [489, 255, 146, 79],
  npclbl: [488, 336, 145, 32], picture1: [705, 122, 32, 32], objetolbl: [656, 168, 129, 33],
};
const BG = 'rgb(11,11,11)', REWARD_BG = 'rgb(19,14,11)';

export class QuestWindows {
  private readonly log: Form;
  private readonly offers: Form;
  private readonly icons: Icons;
  private session: Session | undefined;
  /** PlayQuestDescAudio / StopQuestDescAudio (main.ts sets it once the audio engine exists). */
  voice: QuestVoice | undefined;
  private voiced: { log: number; offers: number } = { log: -1, offers: -1 };
  private logRevision = -1; private offerRevision = -1;
  private logSelected = -1; private offerSelected = 0;
  private picks = { log: { objective: 0, reward: 0 }, offers: { objective: 0, reward: 0 } };

  constructor(parent: HTMLElement, private readonly renderer: WorldRenderer, readonly catalog = new QuestCatalog(), private readonly report: (message: string) => void = () => {}) {
    this.icons = new Icons(renderer);
    // FrmQuests: Image3 close, Image1 Abandonar, Image2 Aceptar (just closes the form).
    this.log = new Form(parent, 'quest-log', 'Misiones en curso', [817, 433], logLayout, 'ventanadetallemision');
    this.log.hotspot('Cerrar', [784, 0, 25, 25], undefined, () => this.closeLog());
    this.log.hotspot('Abandonar', [259, 382, 132, 28], 'boton-abandonar-over', () => this.abandon());
    this.log.hotspot('Aceptar', [427, 382, 132, 28], 'boton-aceptar-over', () => this.closeLog());
    // FrmQuestInfo: Image3 close, Image1 Rechazar (closes), Image2 Aceptar (WriteQuestAccept, then closes).
    this.offers = new Form(parent, 'quest-offers', 'Nueva misión', [821, 437], offerLayout, 'ventananuevamision');
    this.offers.hotspot('Cerrar', [784, 0, 33, 25], undefined, () => this.closeOffers());
    this.offers.hotspot('Rechazar', [259, 382, 132, 28], 'boton-rechazar-over', () => this.closeOffers());
    this.offers.hotspot('Aceptar', [427, 382, 132, 28], 'boton-aceptar-over', () => this.accept());
    // Escape belongs to the window stack (window-stack.ts): it closes the top-most window only.
    windows.watchElement('quest-log', this.log.root, () => this.closeLog(), true);
    windows.watchElement('quest-offers', this.offers.root, () => this.closeOffers(), true);
  }
  async init() {
    this.catalog.load(await fetchText('init/sp_localindex.dat'));
    this.logRevision = this.offerRevision = -1;
  }
  get logOpen() { return this.log.visible; }
  get offersOpen() { return this.offers.visible; }

  /** Unload FrmQuests (the server's list is forgotten; Form_Unload). */
  closeLog() { this.session?.quests.closeList(); this.log.root.hidden = true; this.logSelected = -1; this.voiced.log = -1; this.voice?.stop(); /* Form_Unload: StopQuestDescAudio */ }
  /** Unload FrmQuestInfo (also done by a click on the game screen, frmMain.Form_MouseDown). */
  closeOffers() { this.session?.quests.closeOffers(); this.offers.root.hidden = true; this.voiced.offers = -1; this.voice?.stop(); }
  closeAll() { this.closeLog(); this.closeOffers(); }

  private abandon() {
    const session = this.session; if (!session) return;
    if (!session.quests.list.length) { this.log.message('¡No tienes ninguna misión!', [{ label: 'Aceptar' }]); return; }
    if (this.logSelected < 0) { this.log.message('¡Primero debes seleccionar una misión!', [{ label: 'Aceptar' }]); return; }
    const slot = this.logSelected + 1;
    this.log.message('¿Estás seguro que deseas abandonar la misión? Todos los items relacionados a la misión seran eliminados.', [
      { label: 'Sí', action: () => {
        session.abandonQuest(slot);
        // FrmQuests clears its description, title and tables at once; the server's fresh QuestListSend refills the form.
        session.quests.details = undefined; session.quests.revision++; this.logSelected = -1;
      } },
      { label: 'No' },
    ]);
  }
  private accept() {
    const session = this.session; if (!session || this.offerSelected < 0 || this.offerSelected >= session.quests.offers.length) return;
    session.acceptQuest(this.offerSelected + 1);
    this.closeOffers();
  }

  update(session: Session | undefined) {
    if (this.session !== session) {
      this.session = session; this.log.root.hidden = true; this.offers.root.hidden = true;
      this.logRevision = this.offerRevision = -1; this.logSelected = -1; this.offerSelected = 0;
    }
    if (!session || !this.catalog.ready) return;
    const quests = session.quests;
    if (quests.listOpen && !this.log.visible) { this.log.root.hidden = false; this.logSelected = -1; }
    else if (!quests.listOpen && this.log.visible) this.log.root.hidden = true;
    if (quests.offersOpen && !this.offers.visible) { this.offers.root.hidden = false; this.offerSelected = 0; this.picks.offers = { objective: 0, reward: 0 }; }
    else if (!quests.offersOpen && this.offers.visible) this.offers.root.hidden = true;
    if (quests.revision === this.logRevision && quests.revision === this.offerRevision) return;
    if (this.log.visible && quests.revision !== this.logRevision) { this.logRevision = quests.revision; this.renderLog(); }
    if (this.offers.visible && quests.revision !== this.offerRevision) { this.offerRevision = quests.revision; this.renderOffers(); }
  }

  private renderLog() {
    const session = this.session!, quests = session.quests, form = this.log;
    form.mainList.replaceChildren();
    // The VB6 list shows ReadField(i, name, ";"), which is blank past the first row; the whole name is shown instead.
    quests.list.forEach((id, index) => {
      const row = node(form.mainList, 'q-row', undefined); row.textContent = this.catalog.questName(id);
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === this.logSelected));
      row.addEventListener('click', () => {
        this.logSelected = index; session.requestQuestDetails(index + 1);
        form.mainList.querySelectorAll('.q-row').forEach((other, i) => other.setAttribute('aria-selected', String(i === index)));
      });
    });
    const details = quests.details;
    if (!details) { this.fill(form, undefined, 'log'); return; }
    const view = detailsView(details, this.catalog);
    // HandleQuestDetails ends in PlayQuestDescAudio(questIndex): once per quest shown, not on every redraw.
    if (this.voiced.log !== details.questIndex) { this.voiced.log = details.questIndex; this.voice?.play(this.catalog.questAudio(details.questIndex)); }
    this.fill(form, { ...view, requirements: view.info }, 'log');
  }
  private renderOffers() {
    const session = this.session!, quests = session.quests, form = this.offers;
    form.mainList.replaceChildren();
    quests.offers.forEach((offer, index) => {
      const view = offerView(offer, this.catalog);
      const row = node(form.mainList, 'q-row q-offer-row'); row.style.color = view.color;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === this.offerSelected));
      const name = node(row, 'q-offer-name'); name.textContent = view.label;
      row.addEventListener('click', () => { this.offerSelected = index; this.picks.offers = { objective: 0, reward: 0 }; this.renderOffers(); });
    });
    const offer = quests.offers[this.offerSelected];
    // ListViewQuest_ItemClick / lstQuests_Click: PlayQuestDescAudio of the quest selected in the offer list.
    if (offer && this.voiced.offers !== offer.questIndex) { this.voiced.offers = offer.questIndex; this.voice?.play(this.catalog.questAudio(offer.questIndex)); }
    this.fill(form, offer ? offerView(offer, this.catalog) : undefined, 'offers');
  }

  /** Title, description, requirement text, both tables and the two previews of the quest on screen. */
  private fill(form: Form, view: { title: string; repeatable: boolean; description: string; requirements: string; objectives: QuestRow[]; rewards: QuestRow[] } | undefined, which: 'log' | 'offers') {
    form.title.textContent = view?.title ?? (which === 'offers' ? 'Misión' : '');
    form.repeatable.hidden = !view?.repeatable;
    form.description.textContent = view?.description ?? '';
    form.info.textContent = which === 'log' ? view?.requirements ?? '' : '';
    form.root.dataset.quest = view ? view.title : '';
    this.table(form.objectives, view?.objectives ?? [], which, 'objective');
    this.table(form.rewards, view?.rewards ?? [], which, 'reward');
    this.drawPreview(form, view?.objectives[this.picks[which].objective]);
    this.drawReward(form, view?.rewards[this.picks[which].reward]);
  }
  private table(parent: HTMLElement, rows: QuestRow[], which: 'log' | 'offers', kind: 'objective' | 'reward') {
    parent.replaceChildren();
    rows.forEach((row, index) => {
      const line = node(parent, 'q-trow'); line.setAttribute('role', 'option'); line.setAttribute('aria-selected', String(index === this.picks[which][kind]));
      const name = node(line, 'q-tname'); name.textContent = row.name;
      const amount = node(line, 'q-tamount'); amount.textContent = row.amount;
      line.addEventListener('click', () => {
        this.picks[which][kind] = index;
        parent.querySelectorAll('.q-trow').forEach((other, i) => other.setAttribute('aria-selected', String(i === index)));
        const form = which === 'log' ? this.log : this.offers;
        if (kind === 'objective') this.drawPreview(form, row); else this.drawReward(form, row);
      });
    });
  }
  /** ListView1_Click: the creature (DibujarNPC), object or spell icon of the selected objective, and its caption. */
  private drawPreview(form: Form, row: QuestRow | undefined) {
    const token = ++form.previewToken;
    form.preview.replaceChildren(); form.previewLabel.textContent = '';
    if (!row) return;
    form.previewLabel.textContent = `${row.name} (${row.amount})`;
    const draw = row.kind === 'npc'
      ? this.icons.npc(this.catalog.npcLook(row.id).body, this.catalog.npcLook(row.id).head, 149, 81, BG)
      : this.icons.graphic(row.kind === 'spell' ? this.catalog.spellIcon(row.id) : this.catalog.objGraphic(row.id), 149, 81, BG);
    void draw.then(canvas => { if (token === form.previewToken) form.preview.replaceChildren(canvas); }).catch(error => this.report(String(error)));
  }
  /** ListView2_Click: the reward's 32x32 icon (top-left) and "name\n(quantity)". */
  private drawReward(form: Form, row: QuestRow | undefined) {
    const token = ++form.rewardToken;
    form.rewardIcon.replaceChildren(); form.rewardLabel.textContent = '';
    form.rewardIcon.hidden = !row;
    if (!row) return;
    form.rewardLabel.textContent = `${row.name}\n(${row.amount})`;
    const grh = row.kind === 'spell' ? this.catalog.spellIcon(row.id) : this.catalog.objGraphic(row.id);
    void this.icons.graphic(grh, 32, 32, REWARD_BG).then(canvas => { if (token === form.rewardToken) form.rewardIcon.replaceChildren(canvas); }).catch(error => this.report(String(error)));
  }
}
