/*
 * A small DOM stand-in for the VB6 forms of the classic client (borderless forms with a bitmap Picture, graphical-button images,
 * list boxes and text boxes at fixed pixel positions). Positions are the .frm values / 15 (twips to pixels).
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE. Artwork is read only from the local mount.
 */
import { loadInterface } from './interface-assets.js';
import { windows } from './window-stack.js';

/** left, top, width, height in form pixels. */
export type Box = readonly [number, number, number, number];

export interface WindowOptions {
  id: string;
  /** Interface bitmap (frm Picture), e.g. `ventanagrupo`; a form without one is a plain light-grey VB form. */
  art?: string;
  size: readonly [number, number];
  title: string;
  /** Called when the window is closed by Escape, the X button or `close()`. */
  onClose?: () => void;
  /** A top-level panel (opened from the info menu): opening it closes the other panels. Windows opened from inside a panel stay on top of it. */
  panel?: boolean;
}

const place = (el: HTMLElement, [x, y, w, h]: Box) => { el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.width = `${w}px`; el.style.height = `${h}px`; };

export class VbList {
  readonly el = document.createElement('div');
  private items: string[] = [];
  private selected = -1;
  onSelect: ((index: number) => void) | undefined;
  onDoubleClick: ((index: number) => void) | undefined;
  constructor(box: Box, light = false) {
    this.el.className = `vb-list${light ? ' vb-light' : ''}`; this.el.tabIndex = 0; this.el.setAttribute('role', 'listbox'); place(this.el, box);
    this.el.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); this.select(Math.min(this.items.length - 1, Math.max(0, this.selected + (event.key === 'ArrowDown' ? 1 : -1)))); }
      if (event.key === 'Enter' && this.selected >= 0) this.onDoubleClick?.(this.selected);
    });
  }
  get count() { return this.items.length; }
  get index() { return this.selected; }
  get value() { return this.items[this.selected] ?? ''; }
  set(items: readonly string[]) {
    this.items = [...items]; this.selected = -1;
    this.el.replaceChildren(...this.items.map((text, index) => {
      const row = document.createElement('div'); row.className = 'vb-row'; row.setAttribute('role', 'option'); row.textContent = text;
      row.addEventListener('click', () => this.select(index));
      row.addEventListener('dblclick', () => { this.select(index); this.onDoubleClick?.(index); });
      return row;
    }));
  }
  select(index: number) {
    this.selected = index;
    [...this.el.children].forEach((row, i) => row.setAttribute('aria-selected', String(i === index)));
    this.el.children[index]?.scrollIntoView({ block: 'nearest' });
    this.onSelect?.(index);
  }
}

export class VbWindow {
  readonly root = document.createElement('div');
  private closed = false;
  constructor(private readonly parent: HTMLElement, private readonly options: WindowOptions) {
    const [w, h] = options.size;
    this.root.id = options.id; this.root.className = `vb-window${options.art ? '' : ' vb-plain'}`;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', options.title);
    this.root.style.width = `${w}px`; this.root.style.height = `${h}px`;
    // Centered over the 1024x768 classic screen (StartUpPosition = center screen / center owner).
    this.root.style.left = `${Math.round((1024 - w) / 2)}px`; this.root.style.top = `${Math.round((768 - h) / 2)}px`;
    if (options.art) void loadInterface(options.art).then(url => { this.root.style.backgroundImage = `url("${url}")`; }).catch(() => { this.root.classList.add('vb-plain'); });
    this.root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.close(); } });
    parent.append(this.root);
    windows.watch(options.id, () => !this.closed, () => this.close(), options.panel === true);
  }
  get isOpen() { return !this.closed; }
  add<T extends HTMLElement>(el: T, box: Box): T { place(el, box); this.root.append(el); return el; }
  /** A clickable image control (VB6 `Image` with a clsGraphicalButton): `art` is the `boton-<name>` stem. */
  button(art: string, box: Box, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'vb-art'; button.setAttribute('aria-label', label); button.title = label;
    void Promise.all([loadInterface(`${art}-default`), loadInterface(`${art}-over`)]).then(([normal, over]) => {
      button.style.setProperty('--normal', `url("${normal}")`); button.style.setProperty('--over', `url("${over}")`); button.classList.add('vb-art-ready');
    }).catch(() => { button.classList.remove('vb-art-ready'); });
    button.addEventListener('click', onClick);
    return this.add(button, box);
  }
  /** A plain VB CommandButton. */
  command(label: string, box: Box, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'vb-command'; button.textContent = label;
    button.addEventListener('click', onClick);
    return this.add(button, box);
  }
  label(text: string, box: Box, className = ''): HTMLElement {
    const el = document.createElement('div'); el.className = `vb-label ${className}`.trim(); el.textContent = text; return this.add(el, box);
  }
  list(box: Box, light = false): VbList { const list = new VbList(box, light); this.root.append(list.el); return list; }
  input(box: Box, options: { maxLength?: number; multiline?: boolean; light?: boolean; readOnly?: boolean } = {}): HTMLInputElement | HTMLTextAreaElement {
    const el = options.multiline ? document.createElement('textarea') : document.createElement('input');
    el.className = `vb-text${options.light ? ' vb-light' : ''}`; el.autocomplete = 'off'; el.spellcheck = false;
    if (options.maxLength) el.maxLength = options.maxLength;
    el.readOnly = !!options.readOnly;
    return this.add(el, box);
  }
  /** Close button (cmdCerrar): the X of the bitmap forms. */
  closeButton(box: Box, art = 'boton-cerrar'): HTMLButtonElement { return this.button(art.replace(/-(default|over|off)$/, ''), box, 'Cerrar', () => this.close()); }
  focus() { (this.root.querySelector('input, textarea, [tabindex]') as HTMLElement | null)?.focus(); }
  close() {
    if (this.closed) return;
    this.closed = true; this.root.remove(); windows.unwatch(this.options.id); this.options.onClose?.();
  }
}

/** A single-select combo box (VB6 ComboBox, Style 2 dropdown list). */
export function combo(items: readonly string[], selected = -1): HTMLSelectElement {
  const select = document.createElement('select'); select.className = 'vb-combo';
  items.forEach((text, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = text; select.append(option); });
  select.selectedIndex = selected;
  return select;
}
