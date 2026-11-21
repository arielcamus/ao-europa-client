/*
 * The hotkey bar (TileEngine_RenderScreen: DrawHotkey / the arrow, frmMain.OnDragEnd / HandleHotkeyArrowInput): ten 32 px slots every
 * 36 px from x=188, 45 px above the bottom of the 736x608 renderer, labelled with the key bound to each (GetHotkeyLabel). A spell is put
 * on a slot by dragging it from the spell list with the RIGHT mouse button (frmMain.picHechiz_MouseDown, only IsBindable spells);
 * the bound key then sends UseHKeySlot. The bar exists only when the server enables "hotokey-enabled" (SendClientToggles).
 * AGPL-3.0-or-later; see NOTICE. Artwork is read only from the local mount.
 */
import './options.css';
import { HOTKEY_COUNT, HotkeyType } from '@ao/protocol';
import { make } from './bank-trade-dom.js';
import { hotkeyLabel } from './key-bindings.js';
import { getActiveBindings } from './keymap.js';
import { spellTables } from './spells.js';
import type { GraphicFrame } from './assets.js';
import type { Session } from './session.js';

export const HOTKEY_X = 188, HOTKEY_FROM_BOTTOM = 45, HOTKEY_STEP = 36, HOTKEY_SIZE = 32;
const GRH_INVENTORYSLOT = 47743, GRH_ARROW_HIDE = 19204, GRH_ARROW_SHOW = 19205;
/** hotkey_arrow_posx = 200 + 36 * 5 - 26 and posy = 10 from the bottom. */
const ARROW_X = 200 + 36 * 5 - 26;
const VIEWPORT = { width: 736, height: 608 };

export interface HotkeyArt {
  itemArt(grh: number): Promise<HTMLCanvasElement>;
  slotBackground(grh: number): Promise<{ image: string; position: string }>;
  graphic(grh: number): Promise<GraphicFrame>;
}
/** The slot under a point of the renderer (OnDragEnd), or -1: x inside 188..548 and y within the 36 px row. */
export function hotkeySlotAt(x: number, y: number, height = VIEWPORT.height): number {
  if (x > HOTKEY_X && x < HOTKEY_X + HOTKEY_STEP * HOTKEY_COUNT && y > height - HOTKEY_FROM_BOTTOM && y < height - HOTKEY_FROM_BOTTOM + HOTKEY_STEP) return Math.floor((x - HOTKEY_X) / HOTKEY_STEP);
  return -1;
}

export class HotkeysUI {
  readonly root: HTMLElement;
  private session: Session | undefined;
  private readonly slots: HTMLElement[] = [];
  private readonly arrow: HTMLButtonElement;
  private readonly ghost: HTMLElement;
  private key = '';
  private drag: { spellSlot: number; index: number } | undefined;
  constructor(private readonly classic: HTMLElement, private readonly viewport: HTMLElement, private readonly art: HotkeyArt) {
    this.root = make('div', '', viewport, 'hotkeys'); this.root.hidden = true; this.root.setAttribute('role', 'group'); this.root.setAttribute('aria-label', 'Atajos de hechizos');
    for (let i = 0; i < HOTKEY_COUNT; i++) {
      const slot = make('div', 'hk-slot', this.root); slot.style.left = `${HOTKEY_X + i * HOTKEY_STEP}px`; slot.dataset.slot = String(i);
      void art.slotBackground(GRH_INVENTORYSLOT).then(frame => { slot.style.backgroundImage = frame.image; slot.style.backgroundPosition = frame.position; }).catch(() => {});
      make('span', 'hk-label', slot); this.slots.push(slot);
    }
    this.arrow = make('button', 'hk-arrow', this.root, 'hotkeys-arrow'); this.arrow.type = 'button'; this.arrow.style.left = `${ARROW_X}px`;
    this.arrow.setAttribute('aria-label', 'Mostrar u ocultar atajos'); this.arrow.onclick = () => this.session?.optionsActions.toggleHide();
    this.ghost = make('div', '', classic, 'hk-ghost'); this.ghost.hidden = true;
    // picHechiz_MouseDown, right button: start dragging a bindable spell. The classic UI keeps its own left-click handling.
    const spells = document.getElementById('spells');
    spells?.addEventListener('contextmenu', event => event.preventDefault());
    spells?.addEventListener('pointerdown', event => this.start(event));
    window.addEventListener('pointermove', event => this.move(event));
    window.addEventListener('pointerup', event => this.end(event));
    window.addEventListener('pointercancel', () => this.cancel());
  }
  private scale() { return this.classic.getBoundingClientRect().width / 1024 || 1; }
  private start(event: PointerEvent) {
    const s = this.session;
    if (event.button !== 2 || !s?.ready || !s.options.hotkeysEnabled) return;
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('.spell'), slot = Number(row?.dataset.slot);
    const index = s.ui.spells.get(slot)?.index ?? 0;
    if (!row || !(index > 0) || spellTables.spells.get(`hechizo${index}`)?.get('isbindable') !== '1') return;
    event.preventDefault(); this.drag = { spellSlot: slot, index };
    this.ghost.replaceChildren(); this.ghost.hidden = true;
    const icon = Number(spellTables.spells.get(`hechizo${index}`)?.get('iconoindex'));
    if (icon > 0) void this.art.itemArt(icon).then(canvas => { if (this.drag?.index === index) { this.ghost.replaceChildren(canvas); this.ghost.hidden = false; this.place(event); } }).catch(() => {});
  }
  private place(event: PointerEvent) {
    const rect = this.classic.getBoundingClientRect(), scale = this.scale();
    this.ghost.style.left = `${(event.clientX - rect.left) / scale - 16}px`; this.ghost.style.top = `${(event.clientY - rect.top) / scale - 16}px`;
  }
  private move(event: PointerEvent) { if (this.drag) this.place(event); }
  private cancel() { this.drag = undefined; this.ghost.hidden = true; }
  /** frmMain.OnDragEnd: dropping on a slot of the bar binds the spell (SetHotkey). */
  private end(event: PointerEvent) {
    const drag = this.drag; if (!drag) return;
    this.cancel();
    const rect = this.viewport.getBoundingClientRect(), scale = this.scale();
    const slot = hotkeySlotAt((event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale);
    if (slot >= 0 && !this.session?.options.hideHotkeys) this.session?.optionsActions.setHotkey(slot, drag.index, drag.spellSlot, HotkeyType.Spell);
  }

  update(session: Session | undefined, playing: boolean) {
    if (this.session !== session) { this.session = session; this.key = ''; this.cancel(); }
    const state = session?.options;
    this.root.hidden = !(state?.hotkeysEnabled && playing);
    if (!state || this.root.hidden) return;
    const bindings = getActiveBindings();
    const key = `${state.revision}/${state.hideHotkeys}/${[24, 25, 26, 27, 28, 29, 30, 31, 32, 33].map(a => bindings[a]).join(',')}`;
    if (key === this.key) return;
    this.key = key;
    state.hotkeys.forEach((entry, i) => {
      const slot = this.slots[i]!; slot.hidden = state.hideHotkeys;
      const label = slot.querySelector<HTMLElement>('.hk-label')!; label.textContent = hotkeyLabel(bindings[24 + i] ?? 0);
      slot.querySelector('canvas')?.remove(); slot.title = '';
      if (entry.index > 0 && entry.type === HotkeyType.Spell) {
        const data = spellTables.spells.get(`hechizo${entry.index}`), icon = Number(data?.get('iconoindex'));
        slot.title = data?.get('nombre') ?? `Hechizo ${entry.index}`;
        if (icon > 0) void this.art.itemArt(icon).then(canvas => { if (this.key === key) slot.insertBefore(canvas, label); }).catch(() => {});
      }
    });
    const grh = state.hideHotkeys ? GRH_ARROW_SHOW : GRH_ARROW_HIDE;
    void Promise.all([this.art.graphic(grh), this.art.slotBackground(grh)]).then(([frame, bg]) => {
      Object.assign(this.arrow.style, { width: `${frame.width}px`, height: `${frame.height}px`, top: `${VIEWPORT.height - 10}px`, backgroundImage: bg.image, backgroundPosition: bg.position });
    }).catch(() => {});
  }
}
