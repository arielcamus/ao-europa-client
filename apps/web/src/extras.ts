/*
 * State of the events, battleground lobby, invasion bar, premium shop, skins packets, 2026-11-21, from the classic client
 * Protocol.bas (HandleInvasionInfo, HandleShopInit, HandleUpdateShopClienteCredits, HandleShopPjsInit, HandleReportLobbyList,
 * HandleChangeSkinSlot, HandleNotificarClienteSeguido, HandleAntiCheat*) and frmMain.Evento_Timer. No DOM: extras-ui.ts draws it.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 *
 * What the classic client does that this one does not, on purpose:
 *  - AntiCheatMessage / AntiCheatStartSession drive the native EasyAntiCheat library (AOACClient.dll). A browser has no such module, so
 *    they are decoded and dropped; there is nothing to answer.
 *  - The premium shop (frmShopAO20) and the character marketplace (frmShopPjsAO20) are AO20 online services that are not in the
 *    classic source; the player gets one console line instead of a window.
 *  - Remort and the Hoo* packets are HOO-only (next-gen client) and are not implemented at all (Ariel, 21 Nov: pre-HOO only).
 */
import { ExtrasServerPacketId as X, ServerPacketId as S } from '@ao/protocol';
import type { LobbyEntry, ServerPacket, ShopItem, SkinSlot } from '@ao/protocol';

/** frmMain.Evento.Interval: the invasion bar disappears 10 s after the last InvasionInfo. */
export const INVASION_MS = 10_000;
export const SHOP_MESSAGE = 'La tienda premium no está disponible en este cliente.';
export const MARKET_MESSAGE = 'El mercado de personajes no está disponible en este cliente.';

export interface InvasionState { invasion: number; lifePercent: number; timePercent: number; at: number }

export class ExtrasState {
  revision = 0;
  invasion: InvasionState | undefined;
  credits = 0;
  shopItems: ShopItem[] = [];
  /** NotificarClienteSeguido: a GM is following this client. */
  followed = false;
  /** The last ReportLobbyList; the lobby window shows it while defined. */
  lobbies: LobbyEntry[] | undefined;
  skins = new Map<number, SkinSlot>();
  /** Packets of anti-cheat we dropped, for the status line of the tests. */
  antiCheatDropped = 0;

  constructor(private readonly clock: () => number, private readonly message: (text: string) => void) {}

  receive(packet: ServerPacket): void {
    switch (packet.id) {
      case X.InvasionInfo: this.invasion = { invasion: packet.invasion, lifePercent: packet.lifePercent, timePercent: packet.timePercent, at: this.clock() }; this.revision++; break;
      case X.ShopInit: this.shopItems = packet.items; this.credits = packet.credits; this.message(SHOP_MESSAGE); this.revision++; break;
      case X.UpdateShopClienteCredits: this.credits = packet.credits; this.revision++; break;
      case X.ShopPjsInit: this.message(MARKET_MESSAGE); break;
      case X.NotificarClienteSeguido: this.followed = packet.followed !== 0; this.revision++; break;
      case X.ReportLobbyList: this.lobbies = packet.lobbies; this.revision++; break;
      case X.ChangeSkinSlot: if (packet.slot > 0) this.skins.set(packet.slot, packet); this.revision++; break;
      case X.AntiCheatMessage: case X.AntiCheatStartSession: this.antiCheatDropped++; break;
      // HandleChangeMap / HandleLogged: InvasionActual = 0 and the Evento timer stops.
      case S.ChangeMap: if (this.invasion) { this.invasion = undefined; this.revision++; } break;
      default: break;
    }
  }
  /** frmMain.Evento_Timer: InvasionActual = 0 after INVASION_MS. True when the bar was cleared. */
  tick(): boolean {
    if (this.invasion && this.clock() - this.invasion.at >= INVASION_MS) { this.invasion = undefined; this.revision++; return true; }
    return false;
  }
  closeLobbies() { if (this.lobbies) { this.lobbies = undefined; this.revision++; } }
}
