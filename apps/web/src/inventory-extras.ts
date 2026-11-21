/*
 * What frmMain does around the inventory picture box that the first items work left out (wp04):
 *  - ObjLbl, the item info label at 776,476 (picInv_MouseMove): "Name (amount)" and the damage / defence / text of the object under the mouse;
 *  - moving items: clsGrapchicalInventory drags with the RIGHT mouse button; dropping on another slot sends WriteItemMove, dropping on the
 *    world is TirarItem (the drop key) for that slot;
 *  - imgDeleteItem_Click: the delete button (19x22 at 760,488) with the yes/no MsgBox, then WriteDeleteItem.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE. Artwork is read only from the local mount.
 */
import { loadInterface } from './interface-assets.js';
import { ObjType } from './object-catalog.js';
import type { ObjectInfo } from './object-catalog.js';
import type { ClassicUI } from './classic-ui.js';
import type { Session } from './session.js';

/** e_ElementalTags (Declares.bas): Fire 1, Water 2, Earth 4, Wind 8. */
export function elementalTagsText(tags: number): string {
  if (tags === 0) return '[Normal]';
  return [[1, 'Fuego'], [2, 'Agua'], [4, 'Tierra'], [8, 'Viento']].filter(([bit]) => (tags & (bit as number)) !== 0).map(([, name]) => `[${name}]`).join('');
}
/** picInv_MouseMove: the ObjLbl caption for an inventory slot (JsonLanguage DAMAGE "Daño: ", DEFENSE "Defensa: "). */
export function objectLabel(info: ObjectInfo | undefined, object: number, amount: number, slotTags: number): string {
  const head = `${info?.name ?? `Objeto ${object}`} (${amount})`;
  switch (info?.type) {
    case ObjType.Weapon: return `${head}\n${'Daño: '}${info.minHit}/${info.maxHit} ${elementalTagsText(info.elementalTags | slotTags)}`;
    case ObjType.Armour: case ObjType.Helmet: case ObjType.Shield: return `${head}\n${'Defensa: '}${info.minDef}/${info.maxDef}`;
    default: return `${head}\n${info?.text ?? ''}`;
  }
}
/** ObjLbl.FontSize: 7 pt under 100 characters, 6 pt up to 150 (VB6 leaves the design size 6.75 pt beyond that); 1 pt = 4/3 px. */
export const labelFontPx = (length: number) => (length < 100 ? 7 : length > 100 && length < 150 ? 6 : 6.75) * 4 / 3;

const NO_SELECTION_TEXT = 'No tienes seleccionado ningún ítem.';
const DELETE_TEXT = '¿Seguro que desea eliminar el ítem?', DELETE_TITLE = 'Eliminar objeto';

export interface InventoryExtrasHooks {
  /** TirarItem for the selected slot (the drop key's path, with its amount form and destroy question). */
  dropSelected: () => void;
  /** IsDialogOpen / IsMovementBlocked / IsDragDropBlockedByPanel: true when dragging onto the world must do nothing. */
  dropBlocked: () => boolean;
}

export class InventoryExtras {
  private session: Session | undefined;
  private readonly label: HTMLElement;
  private readonly ghost: HTMLElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly confirm: HTMLElement;
  private drag: { slot: number } | undefined;
  private pendingDelete = 0;

  constructor(private readonly root: HTMLElement, private readonly ui: ClassicUI, private readonly hooks: InventoryExtrasHooks) {
    this.label = document.createElement('div'); this.label.id = 'obj-label'; this.label.className = 'obj-label'; this.label.hidden = true; this.label.setAttribute('aria-hidden', 'true');
    Object.assign(this.label.style, { left: '776px', top: '476px', width: '236px', height: '33px' });
    this.ghost = document.createElement('div'); this.ghost.id = 'inventory-drag'; this.ghost.className = 'inventory-drag'; this.ghost.hidden = true;
    this.deleteButton = document.createElement('button'); this.deleteButton.type = 'button'; this.deleteButton.id = 'delete-item'; this.deleteButton.className = 'delete-item art-button';
    this.deleteButton.setAttribute('aria-label', 'Eliminar objeto'); this.deleteButton.title = 'Eliminar objeto';
    Object.assign(this.deleteButton.style, { left: '760px', top: '488px', width: '19px', height: '22px' });
    this.deleteButton.onclick = () => this.askDelete();
    void Promise.all(['default', 'over'].map(state => loadInterface(`boton-borrar-item-${state}`))).then(([normal, over]) => {
      this.deleteButton.style.backgroundImage = `url("${normal}")`;
      this.deleteButton.onpointerenter = () => { this.deleteButton.style.backgroundImage = `url("${over}")`; };
      this.deleteButton.onpointerleave = () => { this.deleteButton.style.backgroundImage = `url("${normal}")`; };
    }).catch(() => { this.deleteButton.textContent = '×'; });
    // frmMain.MsgBox(MENSAJEBOX_ELIMINAR_ITEM, vbYesNo): a small modal question like the destroy one.
    this.confirm = document.createElement('section'); this.confirm.id = 'delete-confirm'; this.confirm.className = 'items-window items-confirm'; this.confirm.hidden = true;
    this.confirm.setAttribute('role', 'alertdialog'); this.confirm.setAttribute('aria-label', DELETE_TITLE);
    Object.assign(this.confirm.style, { left: '362px', top: '330px', width: '300px', height: '100px' });
    const text = document.createElement('p'); text.textContent = DELETE_TEXT; this.confirm.append(text);
    for (const [caption, accept] of [['Sí', true], ['No', false]] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'items-confirm-button'; button.textContent = caption;
      button.onclick = () => this.answer(accept); this.confirm.append(button);
    }
    this.confirm.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.answer(false); } });
    root.append(this.label, this.ghost, this.deleteButton, this.confirm);

    const inventory = root.querySelector<HTMLElement>('#inventory');
    if (!inventory) return;
    const slotOf = (node: EventTarget | null) => { const button = (node as HTMLElement | null)?.closest?.('.inventory-slot'); return button ? [...inventory.children].indexOf(button) + 1 : 0; };
    inventory.addEventListener('contextmenu', event => event.preventDefault());
    inventory.addEventListener('pointermove', event => this.hover(slotOf(event.target)));
    inventory.addEventListener('pointerleave', () => { this.label.hidden = true; });
    // clsGrapchicalInventory.InventoryWindow_MouseDown: only the right button starts a drag, and only on a slot with an object.
    inventory.addEventListener('pointerdown', event => {
      if (event.button !== 2) return;
      const slot = slotOf(event.target);
      if (!slot || !this.session?.ui.inventory.has(slot)) return;
      event.preventDefault(); this.drag = { slot }; this.showGhost(slot, event);
    });
    window.addEventListener('pointermove', event => { if (this.drag) this.placeGhost(event); });
    window.addEventListener('pointerup', event => { if (event.button === 2 && this.drag) this.drop(event, slotOf); });
    window.addEventListener('blur', () => this.cancelDrag());
  }

  get dialogOpen() { return !this.confirm.hidden; }
  closeDialogs() { this.confirm.hidden = true; this.pendingDelete = 0; this.cancelDrag(); }
  update(session: Session | undefined) {
    if (session !== this.session) { this.session = session; this.closeDialogs(); this.label.hidden = true; }
    // imgDeleteItem is part of the inventory tab (the spell tab hides it).
    this.deleteButton.hidden = !session || this.root.querySelector('#inventory')?.hasAttribute('hidden') === true;
  }

  private hover(slot: number) {
    const session = this.session, item = slot ? session?.ui.inventory.get(slot) : undefined;
    // picInv_MouseMove: no slot or an empty one hides ObjLbl.
    if (!session || !item || item.amount <= 0) { this.label.hidden = true; return; }
    const text = objectLabel(session.catalog?.get(item.object), item.object, item.amount, item.elementalTags);
    this.label.textContent = text; this.label.style.fontSize = `${labelFontPx(text.length)}px`; this.label.hidden = false;
  }

  private showGhost(slot: number, event: PointerEvent) {
    const info = this.session?.catalog?.get(this.session.ui.inventory.get(slot)?.object ?? 0);
    this.ghost.replaceChildren(); this.ghost.hidden = false; this.placeGhost(event);
    if (info?.grh) void this.ui.itemArt(info.grh).then(canvas => { if (this.drag?.slot === slot) this.ghost.replaceChildren(canvas); }).catch(() => {});
  }
  private placeGhost(event: PointerEvent) {
    const rect = this.root.getBoundingClientRect(), scale = rect.width / this.root.offsetWidth || 1;
    // DrawDraggedItem: the picture is centred on the mouse (16 px half size).
    this.ghost.style.left = `${(event.clientX - rect.left) / scale - 16}px`; this.ghost.style.top = `${(event.clientY - rect.top) / scale - 16}px`;
  }
  private cancelDrag() { this.drag = undefined; this.ghost.hidden = true; }

  /** InventoryWindow_MouseUp with Dragging > 0 and the right button. */
  private drop(event: PointerEvent, slotOf: (node: EventTarget | null) => number) {
    const drag = this.drag; if (!drag) return;
    this.cancelDrag();
    const session = this.session; if (!session) return;
    const under = document.elementsFromPoint(event.clientX, event.clientY);
    const target = under.map(node => slotOf(node)).find(slot => slot > 0) ?? 0;
    if (target > 0) {
      // ItemDropped: Drag <> Drop sends the move. The slot under the mouse becomes the selected one (empty ones deselect).
      session.inventoryActions.move(drag.slot, target);
    } else if (under.some(node => node.id === 'viewport') && !this.hooks.dropBlocked()) {
      // Dropped over the renderer: InvSelectedItem = Dragging, then TirarItem.
      this.ui.selectSlot(drag.slot); this.hooks.dropSelected(); return;
    }
    this.ui.selectSlot(target && session.ui.inventory.has(target) ? target : 0);
  }

  private askDelete() {
    const session = this.session; if (!session) return;
    const slot = this.ui.selectedSlot;
    if (session.inventoryActions.deleteSelected(slot, false) === 'no-selection') { session.ui.message(NO_SELECTION_TEXT); return; }
    this.pendingDelete = slot; this.confirm.hidden = false; this.confirm.querySelector('button')?.focus();
  }
  private answer(accept: boolean) {
    const slot = this.pendingDelete; this.pendingDelete = 0; this.confirm.hidden = true;
    if (accept) this.session?.inventoryActions.deleteSelected(slot, true);
  }
}
