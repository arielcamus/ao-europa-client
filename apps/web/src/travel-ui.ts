/*
 * FrmViajes (travel destinations of a Transporter NPC), adapted 2026-11-21 from FrmViajes.frm: 299x295 form with the
 * "ventanaviajes" bitmap, a black ListBox at 48,72 (206x128), the viajar button at 83,246 and the X at 267,0.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE. Artwork is read only from the local mount.
 */
import type { ClientPacket } from '@ao/protocol';
import { TravelState } from './travel.js';
import type { Session } from './session.js';
import { VbWindow } from './vb-window.js';
import { loadInterface } from './interface-assets.js';
import type { VbList } from './vb-window.js';

export class TravelUI {
  private window: VbWindow | undefined;
  private list: VbList | undefined;
  private revision = -1;
  private session: Session | undefined;

  constructor(private readonly parent: HTMLElement, private readonly send: (packet: ClientPacket | undefined) => void) {}

  get isOpen() { return this.window?.isOpen === true; }

  update(session: Session | undefined) {
    if (session !== this.session) { this.session = session; this.revision = -1; this.window?.close(); this.window = undefined; }
    if (!session || session.travel.revision === this.revision) return;
    this.revision = session.travel.revision;
    this.sync(session);
  }
  /** frmMain.renderer_MouseDown: If FrmViajes.visible Then Unload FrmViajes. */
  closeOnWorldClick() { this.window?.close(); }

  private sync(session: Session) {
    const destinations = session.travel.destinations;
    if (!destinations) { this.window?.close(); return; }
    this.window?.close();
    const win = new VbWindow(this.parent, { id: 'travel-window', art: 'ventanaviajes', size: [299, 295], title: 'Formulario de Viaje', onClose: () => { session.travel.close(); this.window = undefined; } });
    this.window = win;
    const list = win.list([48, 72, 206, 128]); this.list = list;
    list.set(destinations.map(TravelState.rowText));
    const travel = () => { const packet = session.travel.travel(list.index + 1); if (packet) { this.send(packet); win.close(); } };
    list.onDoubleClick = travel;
    // The shipped resources may lack the viajar/ventanaviajes bitmaps: then the plain VB buttons stand in so the form stays usable.
    const button = win.button('boton-viajar', [83, 246, 137, 33], 'Viajar', travel);
    void loadInterface('boton-viajar-default').catch(() => { button.remove(); win.command('Viajar', [83, 246, 137, 33], travel); });
    const close = win.closeButton([267, 0, 25, 25]);
    void loadInterface('boton-cerrar-default').catch(() => { close.remove(); win.command('X', [267, 0, 25, 25], () => win.close()); });
    win.focus();
  }
}
