/*
 * frmMain buttons that had no handler yet (audit of the pinned classic client 619e69d): the four experience read-out buttons
 * (btnTotalExp, btnExp, btnExp2, btnExpRemaining), imgManual / imgMAO (open the web page after a MsgBox), CombateIcon / globalIcon
 * (ChatCombate / ChatGlobal toggles, WriteMacroPos) and imgBugReport (opens FrmGmAyuda). Positions are in classic-layout.ts / index.html.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE. Artwork is read only from the local mount.
 */
import { ExtrasClientPacketId } from '@ao/protocol';
import type { ClientPacket } from '@ao/protocol';
import type { Session } from './session.js';
import { loadInterface } from './interface-assets.js';
import { EXP_BUTTONS, EXP_LABEL_IDS, expCaptions } from './exp-display.js';
import type { ExpMode } from './exp-display.js';

const WIKI = 'https://www.argentumonline.com.ar/wiki';
const MAO = 'https://www.argentumonline.com.ar/mercadoao';
/** JsonLanguage MENSAJE_PAGINA_WEB_YESNO / MENSAJE_PAGINA_WEB: the MsgBox shown before leaving the game for a web page. */
export const OPEN_PAGE_TEXT = 'Abrir el navegador. Deseas abrir el navegador ahora.';

export interface FrmMainButtonsDeps {
  element: (id: string) => HTMLElement;
  /** MsgBox vbYesNo. */
  confirm: (text: string, yes: () => void) => void;
  openUrl: (url: string) => void;
  send: (packet: ClientPacket) => void;
  /** frmMain.imgBugReport_Click: FrmGmAyuda.Show. */
  openBugReport: () => void;
}

export class FrmMainButtons {
  private mode: ExpMode = 'total';
  private session: Session | undefined;
  private art = new Map<string, string>();
  private shown = '';

  constructor(private readonly deps: FrmMainButtonsDeps) {}

  init() {
    const { element } = this.deps;
    for (const button of EXP_BUTTONS) element(button.id).addEventListener('click', () => this.setMode(button.mode));
    // imgManual_Click / imgMAO_Click: a map with MapDat.Seguro = 1 opens the page at once; the client does not read that map flag, so it always asks.
    element('manual').addEventListener('click', () => this.page(WIKI));
    element('mao').addEventListener('click', () => this.page(MAO));
    element('chat-combat-icon').addEventListener('click', () => this.toggleChat('combat'));
    element('chat-global-icon').addEventListener('click', () => this.toggleChat('global'));
    for (const name of ['info', 'infoapretado', 'global', 'globalapretado']) void loadInterface(name).then(url => { this.art.set(name, url); this.shown = ''; }).catch(() => undefined);
    // imgBugReport (2880,3120 1020x495 twips) sits in the info panel, over the artwork already baked into ventanaprincipal_info.
    const menu = element('menu-actions');
    const bug = document.createElement('button'); bug.type = 'button'; bug.className = 'hotspot'; bug.id = 'bug-report'; bug.setAttribute('aria-label', 'Reportar un bug');
    bug.style.cssText = 'position:absolute;left:192px;top:208px;width:68px;height:33px';
    bug.addEventListener('click', () => this.deps.openBugReport());
    menu.append(bug);
    this.paintMode();
  }

  private page(url: string) { this.deps.confirm(OPEN_PAGE_TEXT, () => this.deps.openUrl(url)); }

  /** frmMain.ChangeExperienceDisplayMode: exactly one of the four labels is visible. */
  setMode(mode: ExpMode) { this.mode = mode; this.paintMode(); }
  get expMode() { return this.mode; }
  private paintMode() {
    for (const [key, id] of Object.entries(EXP_LABEL_IDS)) this.deps.element(id).hidden = key !== this.mode;
  }

  /** frmMain.CombateIcon_Click / GlobalIcon_Click: flip the flag, swap the picture, WriteMacroPos. */
  private toggleChat(which: 'combat' | 'global') {
    const options = this.session?.options;
    if (!options || !this.session?.ready) return;
    if (which === 'combat') options.chatCombat = options.chatCombat === 0 ? 1 : 0; else options.chatGlobal = options.chatGlobal === 0 ? 1 : 0;
    options.bindKeysSeen = true; options.revision++;
    this.deps.send({ id: ExtrasClientPacketId.MacroPossent, chatCombat: options.chatCombat, chatGlobal: options.chatGlobal });
    this.paintIcons();
  }
  private paintIcons() {
    const options = this.session?.options; if (!options) return;
    const key = `${options.chatCombat}${options.chatGlobal}`;
    if (key === this.shown) return;
    this.shown = key;
    const paint = (id: string, name: string) => { const url = this.art.get(name); if (url) this.deps.element(id).style.backgroundImage = `url("${url}")`; };
    paint('chat-combat-icon', options.chatCombat === 1 ? 'infoapretado' : 'info');
    paint('chat-global-icon', options.chatGlobal === 1 ? 'globalapretado' : 'global');
  }

  /** UpdateExpBar: the four captions, every frame (cheap: only changed text is written). */
  update(session: Session | undefined) {
    this.session = session;
    if (!session) return;
    const stats = session.ui.stats;
    const captions = expCaptions(stats.experience, stats.nextLevel);
    for (const [mode, id] of Object.entries(EXP_LABEL_IDS)) {
      const el = this.deps.element(id), text = captions[mode as ExpMode];
      if (el.textContent !== text) el.textContent = text;
    }
    this.paintIcons();
    session.ui.chat.globalEnabled = () => !session.options.bindKeysSeen || session.options.chatGlobal === 1;
    if (session.options.bindKeysSeen) session.ui.chatCombate = session.options.chatCombat === 1;
  }
}
