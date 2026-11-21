/*
 * Key ring (FrmKeyInv.frm), item moving and deleting (frmMain.Inventario_ItemDropped / imgDeleteItem_Click) and the papyrus form
 * (Protocol.HandleShowPapiro): state and the Write* packets. The windows are keyring-ui.ts, papiro-ui.ts and inventory-extras.ts.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 */
import { KeyringClientPacketId as KC, KeyringServerPacketId as KS, MAX_KEYS } from '@ao/protocol';
import type { ClientPacket, ServerPacket } from '@ao/protocol';
import { ServerPacketId as S } from '@ao/protocol';
import type { ClassicState } from './ui-state.js';
import type { ItemsState } from './items-state.js';

export { MAX_KEYS };
/** Declares.bas MAX_INVENTORY_SLOTS, the highest slot the server accepts (getMaxInventorySlots). */
export const MAX_INVENTORY_SLOTS = 42;

/** What the server keeps in UserList(i).Keys, as UpdateUserKey delivers it: slot (1..10) to key object. */
export class KeyringState {
  revision = 0;
  readonly keys = new Map<number, number>();
  /** frmMensajePapiro is visible. */
  papiroOpen = false;

  receive(packet: ServerPacket) {
    switch (packet.id) {
      // HandleUpdateUserKey -> InvKeys.SetItem(Slot, Llave, ...): a slot outside 1..MAX_KEYS is ignored (SetItem exits), object 0 empties it.
      case KS.UpdateUserKey:
        if (packet.slot < 1 || packet.slot > MAX_KEYS) return;
        if (packet.key > 0) this.keys.set(packet.slot, packet.key); else this.keys.delete(packet.slot);
        break;
      case KS.ShowPapiro: this.papiroOpen = true; break;
      // HandleDisconnect resets the inventories, the key ring included (For i = 1 To MAX_KEYS: InvKeys.ClearSlot(i)). The server sends
      // the keys (EnviarLlaves) BEFORE Logged, so a reset there would wipe them.
      case S.Disconnect: this.keys.clear(); this.papiroOpen = false; break;
      default: return;
    }
    this.revision++;
  }
  closePapiro() { if (this.papiroOpen) { this.papiroOpen = false; this.revision++; } }
  /** FrmKeyInv.Form_Activate: an empty ring says so (MENSAJE_571). */
  get empty() { return this.keys.size === 0; }
}

export interface InventoryActionsDeps {
  send: (packet: ClientPacket) => void;
  ready: () => boolean;
  now: () => number;
  ui: ClassicState;
  items: ItemsState;
}

export class InventoryActions {
  private lastUseKey = -Infinity;
  constructor(private readonly deps: InventoryActionsDeps) {}

  /** FrmKeyInv.interface_DblClick: MainTimer.Check(UseItemWithDblClick), then WriteUseKey(slot) for the selected key. */
  useKey(slot: number, keyring: KeyringState): boolean {
    if (!this.deps.ready() || !keyring.keys.has(slot)) return false;
    const interval = this.deps.items.intervals.useItemClick, now = this.deps.now();
    if (interval > 0 && now - this.lastUseKey < interval) return false;
    this.lastUseKey = now;
    this.deps.send({ id: KC.UseKey, slot });
    return true;
  }
  /** Inventario_ItemDropped: Drop > 0 and Drag <> Drop send WriteItemMove(Drag, Drop). The server answers with the slot updates. */
  move(from: number, to: number): boolean {
    if (!this.deps.ready() || !(to > 0) || from === to || !(from >= 1 && from <= MAX_INVENTORY_SLOTS) || to > MAX_INVENTORY_SLOTS) return false;
    this.deps.send({ id: KC.Moveitem, from, to });
    return true;
  }
  /**
   * imgDeleteItem_Click without a selection says so in the console; the confirm box (MsgBox yes/no) belongs to the UI.
   * WriteDeleteItem(slot) sends isSkin False first. The server only deletes in a safe zone, alive and unequipped, and says why not.
   */
  deleteSelected(slot: number, confirmed: boolean): 'no-selection' | 'cancelled' | 'sent' | 'not-ready' {
    if (!(slot >= 1 && slot <= MAX_INVENTORY_SLOTS) || !this.deps.ui.inventory.has(slot)) return 'no-selection';
    if (!confirmed) return 'cancelled';
    if (!this.deps.ready()) return 'not-ready';
    this.deps.send({ id: KC.DeleteItem, skin: false, slot });
    return 'sent';
  }
}
