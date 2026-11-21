/*
 * GM / admin state (wp12), 2026-11-21, from client Protocol.bas HandlePrivilegios, HandleUserOnline, HandleUserNameList,
 * HandleShowSOSForm, HandleShowGMPanelForm, HandleSpawnList, HandleShowMOTDEditionForm, HandleDebugDataResponse, HandleUpdateUserKey.
 * No DOM: gm-ui.ts draws the forms. Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 */
import { GmServerPacketId as G, GM_LIST_SEPARATOR, GM_SOS_FIELD } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';

export interface SosRow { name: string; query: string; type: string; date: string }
export interface PanelForm { head: number; body: number; casco: number; arma: number; escudo: number }

export class GmState {
  revision = 0;
  /** EsGM: set by HandlePrivilegios right after login. */
  isGM = false;
  /** frmMain.onlines: "Online: N" (UserOnline), shown to GMs other than counsellors. */
  online: number | undefined;
  /** frmPanelgm.cboListaUsus, filled by UserNameList. */
  userNames: string[] = [];
  /** frmPanelgm.List1/List2 rows from ShowSOSForm (the player queries waiting for a GM). */
  sos: SosRow[] = [];
  /** ShowGMPanelForm: the GM's own head/body/helmet/weapon/shield; `opened` counts how many times the server asked to show the panel. */
  panel: PanelForm | undefined;
  panelOpened = 0;
  /** SpawnListt: ListaCompleta; `spawnOpened` counts how many times frmSpawnList was asked to show. */
  spawnFull = false;
  spawnOpened = 0;
  /** ShowMOTDEditionForm: the MOTD text frmCambiaMotd starts with; `motdOpened` counts requests. */
  motd = '';
  motdOpened = 0;
  /** DebugDataResponse lines (the VB6 client appends them to logs\RemoteError.log). */
  debugLines: string[] = [];
  /** UpdateUserKey: key slot -> object index (FrmKeyInv). */
  keys = new Map<number, number>();
  /** ShowPapiro / ShowForumForm / GuardNotice counters: forms the classic client shows nothing for or stubs. */
  papiros = 0;
  guardNotices = 0;
  forumMessages: { title: string; message: string }[] = [];

  receive(packet: ServerPacket): void {
    switch (packet.id) {
      case G.Privilegios: this.isGM = packet.isGM; this.revision++; break;
      case G.UserOnline: this.online = packet.count; this.revision++; break;
      case G.UserNameList: this.userNames = packet.list === '' ? [] : packet.list.split(GM_LIST_SEPARATOR); this.revision++; break;
      case G.ShowSOSForm:
        this.sos = packet.list === '' ? [] : packet.list.split(GM_LIST_SEPARATOR).map(row => {
          const [name = '', query = '', type = '', date = ''] = row.split(GM_SOS_FIELD);
          return { name, query, type, date };
        });
        this.revision++; break;
      case G.ShowGMPanelForm: this.panel = { head: packet.head, body: packet.body, casco: packet.casco, arma: packet.arma, escudo: packet.escudo }; this.panelOpened++; this.revision++; break;
      case G.SpawnListt: this.spawnFull = packet.listaCompleta; this.spawnOpened++; this.revision++; break;
      case G.ShowMOTDEditionForm: this.motd = packet.motd; this.motdOpened++; this.revision++; break;
      case G.DebugDataResponse: this.debugLines.push(...packet.messages.filter(message => message !== '')); this.revision++; break;
      case G.UpdateUserKey: this.keys.set(packet.slot, packet.llave); this.revision++; break;
      case G.ShowPapiro: this.papiros++; break;
      case G.GuardNotice: this.guardNotices++; break;
      case G.AddForumMsg: this.forumMessages.push({ title: packet.title, message: packet.message }); break;
    }
  }
}
