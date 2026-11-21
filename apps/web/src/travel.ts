/*
 * Travel form state (FrmViajes.frm), adapted 2026-11-21 from client Protocol.bas HandleViajarForm / HandleChangeMap and
 * FrmViajes.cmdViajar_Click. No DOM here: travel-ui.ts draws it. Copyright (C) 2022-2026 Noland Studios.
 * AGPL-3.0-or-later; no warranty. See NOTICE.
 */
import { PetsTravelServerPacketId as PS, ServerPacketId as S } from '@ao/protocol';
import type { ClientPacket, ServerPacket, TravelDestination } from '@ao/protocol';

export class TravelState {
  revision = 0;
  /** Destinos(1..n), as the last ViajarForm sent them; undefined while FrmViajes is not shown. */
  destinations: TravelDestination[] | undefined;
  /** ViajarInterface: the NPC's Interface byte. The classic client stores it and never reads it again. */
  viajarInterface = 0;

  receive(packet: ServerPacket): void {
    if (packet.id === PS.ViajarForm) {
      this.destinations = packet.destinations; this.viajarInterface = packet.interface; this.revision++;
    } else if (packet.id === S.ChangeMap) this.close(); // HandleChangeMap: If FrmViajes.visible Then Unload FrmViajes
  }
  /** The list row text of Protocol.HandleViajarForm: `<city> - <cost> monedas`. */
  static rowText(destination: TravelDestination): string { return `${destination.city} - ${destination.cost} monedas`; }
  /** cmdViajar_Click: `destination` is the 1-based list index; nothing selected (0) sends nothing. Unloads the form first. */
  travel(destination: number): ClientPacket | undefined {
    const row = this.destinations?.[destination - 1];
    if (!row || destination <= 0) return undefined;
    this.close();
    return { id: 252, destination, cost: row.cost };
  }
  close(): void { if (this.destinations) { this.destinations = undefined; this.revision++; } }
}
