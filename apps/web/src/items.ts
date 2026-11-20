/*
 * Item actions, following ModGameplayUI.UserOrEquipItem/UseItemKey,
 * modBindKeys.TirarItem/AgarrarItem and frmComerciar. Each action builds the
 * exact VB6 Write* packet; sequence counters come from the session's one PacketCounters. AGPL-3.0-or-later; see NOTICE.
 */
import { ItemsClientPacketId as IC, GOLD_SLOT } from '@ao/protocol';
import type { ClientPacket } from '@ao/protocol';
import type { ClassicState } from './ui-state.js';
import type { ItemsState } from './items-state.js';
import { ObjType } from './object-catalog.js';
import type { ObjectCatalog } from './object-catalog.js';
import type { PacketFamily } from './packet-counters.js';

export { GOLD_SLOT };
export interface ItemsDeps {
  send: (packet: ClientPacket) => void;
  now: () => number;
  ready: () => boolean;
  position: () => { x: number; y: number } | undefined;
  ui: ClassicState;
  state: ItemsState;
  catalog: () => ObjectCatalog | undefined;
  /** session.next: the shared per-family counter (useItem, useItemU, equipItem, drop). */
  next: (family: PacketFamily) => number;
}

export class ItemsController {
  private last = { useItem: -Infinity, useItemU: -Infinity, drop: -Infinity };
  constructor(private readonly deps: ItemsDeps) {}

  private get dead() { return this.deps.ui.stats.hp === 0; }
  private elapsed(action: keyof ItemsController['last'], interval: number) {
    const now = this.deps.now();
    if (interval > 0 && now - this.last[action] < interval) return false;
    this.last[action] = now; return true;
  }
  private slotItem(slot: number) { return this.deps.ui.inventory.get(slot); }
  private warn(text: string) { this.deps.ui.message(text); return false; }

  /** UseItemKey: the use key sends WriteUseItemU for the selected slot. */
  useKey(slot: number): boolean {
    const item = this.slotItem(slot);
    if (!this.deps.ready() || !item || this.deps.state.shopOpen) return false;
    const info = this.deps.catalog()?.get(item.object);
    // An equipped projectile weapon asks the server for a target without the pacing check.
    const projectile = item.equipped && info?.type === ObjType.Weapon && info.projectile;
    if (!projectile && !this.elapsed('useItemU', this.deps.state.intervals.useItemKey)) return false;
    this.deps.send({ id: IC.UseItemU, slot, counter: this.deps.next('useItemU') });
    return true;
  }
  /** WriteUseItem: clicks and double clicks (ActiveInventoryTab = eInventory). */
  private use(slot: number): boolean {
    if (!this.elapsed('useItem', this.deps.state.intervals.useItemClick)) return false;
    this.deps.send({ id: IC.UseItem, slot, fromInventory: true, counter: this.deps.next('useItem') });
    return true;
  }
  /** WriteEquipItem (the equip key and the double click on gear). Dead users get the classic notice. */
  equip(slot: number): boolean {
    if (!this.deps.ready() || !this.slotItem(slot)) return false;
    if (this.dead) return this.warn('¡Estás muerto!');
    this.deps.send({ id: IC.EquipItem, slot, skin: false, counter: this.deps.next('equipItem') });
    return true;
  }
  /** UserOrEquipItem: what a double click does depends on the object type. */
  activate(slot: number, inShop = false): boolean {
    const item = this.slotItem(slot);
    if (!this.deps.ready() || !item || (this.deps.state.shopOpen && !inShop)) return false;
    const info = this.deps.catalog()?.get(item.object);
    const equipped = item.equipped;
    switch (info?.type) {
      case ObjType.Armour: case ObjType.Shield: case ObjType.Magical: case ObjType.Arrows: case ObjType.Helmet: case ObjType.Rings: case ObjType.Stains:
        return equipped ? this.use(slot) : this.equip(slot);
      case ObjType.Weapon:
        if (info.projectile && equipped) return this.use(slot);
        return equipped ? false : this.equip(slot);
      case ObjType.Tools: return equipped ? this.use(slot) : this.equip(slot);
      case ObjType.Donor: return equipped ? false : this.equip(slot);
      default: return this.use(slot);
    }
  }
  /** TirarItem asks before destroying; frmCantidad asks for the amount of a stack. */
  dropNeedsAmount(slot: number): boolean {
    if (slot === GOLD_SLOT) return (this.deps.ui.stats.gold ?? 0) > 0;
    return (this.slotItem(slot)?.amount ?? 0) > 1;
  }
  destroys(slot: number): boolean {
    const item = this.slotItem(slot);
    return !!item && slot !== GOLD_SLOT && !!this.deps.catalog()?.get(item.object)?.destroys;
  }
  /** WriteDrop at the user's own tile. Gold uses the pseudo slot 200. */
  drop(slot: number, amount: number): boolean {
    const position = this.deps.position();
    if (!this.deps.ready() || !position || amount < 1) return false;
    if (this.dead) return this.warn('¡Estás muerto!');
    if (this.deps.state.shopOpen) return this.warn('No podés tirar objetos mientras comerciás.');
    if (slot !== GOLD_SLOT && !this.slotItem(slot)) return false;
    if (!this.elapsed('drop', this.deps.state.intervals.dropItem)) return false;
    this.deps.send({ id: IC.Drop, slot, amount, counter: this.deps.next('drop'), x: position.x, y: position.y });
    return true;
  }
  /** WritePickUp: always the user's own tile, destination slot 0 (first free). */
  pickUp(): boolean {
    const position = this.deps.position();
    if (!this.deps.ready() || !position) return false;
    if (this.dead) return this.warn('¡Estás muerto!');
    if (this.deps.state.shopOpen) return this.warn('No podés agarrar objetos mientras comerciás.');
    this.deps.send({ id: IC.PickUp, x: position.x, y: position.y, slot: 0 });
    return true;
  }
  // Opening an NPC shop is a LeftClick on the NPC: the session's leftClick (one map-click handler, shared counter).
  /** cmdComprar_Click: the client checks gold first and says so in the console. */
  buy(slot: number, amount: number): boolean {
    const offer = this.deps.state.shopSlots.get(slot);
    if (!this.deps.ready() || !this.deps.state.shopOpen || !offer || !Number.isInteger(amount) || amount <= 0) return false;
    if ((this.deps.ui.stats.gold ?? 0) < offer.value * amount) return this.warn('No tienes suficiente oro.');
    this.deps.send({ id: IC.CommerceBuy, slot, amount: Math.min(amount, 0x7fff) });
    return true;
  }
  /** cmdVender_Click sells min(typed amount, stack). */
  sell(slot: number, amount: number): boolean {
    const item = this.slotItem(slot);
    if (!this.deps.ready() || !this.deps.state.shopOpen || !item || !Number.isInteger(amount) || amount <= 0) return false;
    this.deps.send({ id: IC.CommerceSell, slot, amount: Math.min(amount, item.amount) });
    return true;
  }
  closeShop(): boolean {
    if (!this.deps.ready() || !this.deps.state.shopOpen) return false;
    this.deps.send({ id: IC.CommerceEnd });
    this.deps.state.closeShop(); // Form_Unload hides the window at once; the server's CommerceEnd confirms.
    return true;
  }
}
