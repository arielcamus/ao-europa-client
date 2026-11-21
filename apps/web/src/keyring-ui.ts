/*
 * FrmKeyInv (the key ring, "llavero"), adapted from FrmKeyInv.frm and frmMain.cmdLlavero_Click: a 240x188 form with the
 * "ventanallavero" bitmap, a black 175x70 picture box at 33,83 drawing the keys 32x32 with 3 px of space (5 per row, MAX_KEYS = 10),
 * the key name label at 16,153 and the X at 210,1. frmMain.cmdLlavero_Click puts it with its horizontal centre at 890 and its bottom at 555.
 * Double click on a key sends WriteUseKey. Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 */
import { MAX_KEYS } from './keyring.js';
import { loadInterface } from './interface-assets.js';
import { VbWindow } from './vb-window.js';
import type { Session } from './session.js';

export interface KeyringArt {
  itemArt: (grh: number) => Promise<HTMLCanvasElement>;
  slotBackground: (grh: number) => Promise<{ image: string; position: string }>;
}
/** GRH_INVENTORYSLOT_EXTRA, the slot picture clsGrapchicalInventory draws behind every key. */
const SLOT_GRH = 47742;
const ITEM_SIZE = 32, SPACE = 3, PER_ROW = Math.floor(175 / (ITEM_SIZE + SPACE));
/** JsonLanguage MENSAJE_571 (Languages/1.json). */
export const EMPTY_KEYRING_TEXT = 'Aquí aparecerán las llaves que consigas';

export class KeyringUI {
  private window: VbWindow | undefined;
  private session: Session | undefined;
  private selected = 0;
  private revision = -1;
  private slots: HTMLButtonElement[] = [];
  private name: HTMLElement | undefined;
  private renderToken = 0;

  constructor(private readonly parent: HTMLElement, private readonly art: KeyringArt, private readonly objectName: (object: number) => string,
    private readonly grh: (object: number) => number) {}

  get isOpen() { return this.window?.isOpen === true; }
  /** frmMain.cmdLlavero_Click: open it, or CerrarLlavero when it is already visible. */
  toggle() { if (this.isOpen) this.close(); else this.open(); }
  close() { this.window?.close(); }

  private open() {
    const session = this.session; if (!session) return;
    this.selected = 0;
    const win = new VbWindow(this.parent, { id: 'keyring-window', art: 'ventanallavero', size: [240, 188], title: 'Llavero', onClose: () => { this.window = undefined; this.slots = []; } });
    this.window = win;
    // FrmKeyInv.Left = frmMain.Left + 890 - Width \ 2; Top = frmMain.Top + 555 - Height.
    win.root.style.left = `${890 - 120}px`; win.root.style.top = `${555 - 188}px`;
    const picture = win.add(document.createElement('div'), [33, 83, 175, 70]); picture.className = 'keyring-box'; picture.style.background = '#000';
    this.slots = [];
    for (let i = 0; i < MAX_KEYS; i++) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'keyring-slot'; button.dataset.slot = String(i + 1);
      Object.assign(button.style, { position: 'absolute', left: `${(i % PER_ROW) * (ITEM_SIZE + SPACE)}px`, top: `${Math.floor(i / PER_ROW) * (ITEM_SIZE + SPACE)}px`, width: '32px', height: '32px' });
      // interface_MouseUp selects the slot under the mouse; interface_DblClick uses the selected key (InvKeys.IsItemSelected).
      button.addEventListener('click', () => { this.selected = session.keyring.keys.has(i + 1) ? i + 1 : 0; this.mark(); });
      button.addEventListener('dblclick', () => { this.selected = session.keyring.keys.has(i + 1) ? i + 1 : 0; this.mark(); if (this.selected) session.inventoryActions.useKey(this.selected, session.keyring); });
      // interface_MouseMove names the key under the mouse; Form_MouseMove clears it (when the ring is not empty).
      button.addEventListener('pointerenter', () => { const key = session.keyring.keys.get(i + 1); if (key) this.setName(this.objectName(key)); });
      picture.append(button); this.slots.push(button);
    }
    win.root.addEventListener('pointermove', event => { if (event.target === win.root && !session.keyring.empty) this.setName(''); });
    this.name = win.add(document.createElement('div'), [16, 153, 209, 32]); this.name.className = 'keyring-name';
    Object.assign(this.name.style, { textAlign: 'center', font: 'bold 11px Tahoma, Arial, sans-serif', color: '#fff', whiteSpace: 'normal', pointerEvents: 'none' });
    const close = win.closeButton([210, 1, 31, 28]);
    void loadInterface('boton-cerrar-default').catch(() => { close.remove(); win.command('X', [210, 1, 31, 28], () => win.close()); });
    win.root.tabIndex = -1; win.root.focus();
    this.revision = -1; this.render();
  }
  private setName(text: string) { if (this.name) this.name.textContent = text; }
  private mark() { this.slots.forEach((button, i) => button.setAttribute('aria-pressed', String(i + 1 === this.selected))); }

  update(session: Session | undefined) {
    if (session !== this.session) { this.session = session; this.close(); }
    if (!session || !this.isOpen) return;
    if (session.keyring.revision !== this.revision) this.render();
  }
  private render() {
    const session = this.session; if (!session || !this.window) return;
    this.revision = session.keyring.revision;
    const token = ++this.renderToken;
    if (this.selected && !session.keyring.keys.has(this.selected)) this.selected = 0;
    // Form_Activate: an empty ring says so.
    if (session.keyring.empty) this.setName(EMPTY_KEYRING_TEXT);
    this.slots.forEach(async (button, i) => {
      const object = session.keyring.keys.get(i + 1), grh = object ? this.grh(object) : 0;
      button.title = object ? this.objectName(object) : 'Vacía';
      button.setAttribute('aria-label', `Llave ${i + 1}: ${object ? this.objectName(object) : 'vacía'}`);
      const [background, art] = await Promise.all([this.art.slotBackground(SLOT_GRH), grh ? this.art.itemArt(grh) : undefined]);
      if (token !== this.renderToken) return;
      button.style.backgroundImage = background.image; button.style.backgroundPosition = background.position;
      button.replaceChildren(); if (art) button.append(art);
    });
    this.mark();
  }
}
