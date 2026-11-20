/*
 * Items state: NPC shop, strength/agility, damage/resistance
 * bonuses and server intervals, following the classic client Handle*
 * procedures (Protocol.bas). AGPL-3.0-or-later; see NOTICE.
 */
import { ServerPacketId as S, ItemsServerPacketId as IS } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';

export interface ShopSlot { slot: number; object: number; amount: number; value: number; elementalTags: number; canUse: number }
export interface Attributes { strength: number; agility: number; strengthBase: number; agilityBase: number; drugCounter: number }
export interface ActionIntervals { dropItem: number; useItemKey: number; useItemClick: number }

export class ItemsState {
  revision = 0;
  // Ground objects live in the doors store (session.mapObjects, ObjectCreate/ObjectDelete), drawn by the renderer's object pass.
  /** The NPC's inventory, filled by ChangeNPCInventorySlot before CommerceInit opens the window. */
  shopSlots = new Map<number, ShopSlot>();
  shopOpen = false;
  shopName = '';
  attributes: Attributes | undefined;
  damageBonus = 0;
  resistanceBonus = 0;
  intervals: ActionIntervals = { dropItem: 0, useItemKey: 0, useItemClick: 0 };
  /** Last pickup announcement (ShowPickUpObj); the classic client floats it over the map. */
  pickedUp: { object: number; amount: number; at: number } | undefined;
  pickups = 0;

  receive(packet: ServerPacket) {
    switch (packet.id) {
      case S.ChangeMap: this.closeShop(); break;
      case S.Intervals:
        this.intervals = { dropItem: packet.dropItem, useItemKey: packet.useItemKey, useItemClick: packet.useItemClick };
        return;
      case IS.ChangeNPCInventorySlot:
        if (packet.slot < 1 || packet.slot > 42) throw new Error('Invalid shop slot');
        if (packet.object > 0 && packet.amount > 0) this.shopSlots.set(packet.slot, { ...packet });
        else this.shopSlots.delete(packet.slot);
        break;
      case IS.CommerceInit: this.shopOpen = true; this.shopName = packet.npcName; break;
      case IS.CommerceEnd: this.closeShop(); break;
      case IS.FYA:
        this.attributes = { strength: packet.strength, agility: packet.agility, strengthBase: packet.strengthBase, agilityBase: packet.agilityBase, drugCounter: packet.drugCounter };
        break;
      case IS.UpdateDM: this.damageBonus = packet.value; break;
      case IS.UpdateRM: this.resistanceBonus = packet.value; break;
      case IS.ShowPickUpObj: this.pickedUp = { object: packet.object, amount: packet.amount, at: ++this.pickups }; break;
      default: return;
    }
    this.revision++;
  }
  closeShop() { this.shopOpen = false; this.shopName = ''; this.shopSlots.clear(); }
}
