/*
 * DOM helpers shared by the bank and trade windows: absolutely placed VB6 controls (twips / 15), original
 * artwork buttons and 34x34 item slots. AGPL-3.0-or-later; see NOTICE. Artwork is read only from the local mount.
 */
import { loadInterface } from './interface-assets.js';
import type { ClassicUI } from './classic-ui.js';
/** The item picture and the cropped graphic helpers ClassicUI already provides (shared with the NPC shop). */
export type SlotArt = Pick<ClassicUI, 'itemArt' | 'slotBackground'>;

export const place = (node: HTMLElement, x: number, y: number, width: number, height: number) => {
  Object.assign(node.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
};
export const make = <T extends keyof HTMLElementTagNameMap>(tag: T, className = '', parent?: HTMLElement, id = '') => {
  const node = document.createElement(tag); if (className) node.className = className; if (id) node.id = id; parent?.append(node); return node;
};
/** PonerPuntos: thousands separated with dots. */
export const withDots = (value: number) => String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** A frmX image control with the clsGraphicalButton default / over artwork. */
export function artButton(parent: HTMLElement, id: string, label: string, art: string, x: number, y: number, width: number, height: number, onClick: () => void) {
  const button = make('button', 'art-button bt-button', parent, id); button.type = 'button'; button.setAttribute('aria-label', label);
  place(button, x, y, width, height); button.onclick = onClick;
  void Promise.all(['default', 'over'].map(state => loadInterface(`${art}-${state}`))).then(([normal, over]) => {
    button.style.backgroundImage = `url("${normal}")`;
    button.onpointerenter = () => { button.style.backgroundImage = `url("${over}")`; };
    button.onpointerleave = () => { button.style.backgroundImage = `url("${normal}")`; };
  }).catch(() => { /* the control stays usable without artwork */ });
  return button;
}
/** A text box that accepts digits only (KeyPress filters 48..57 and backspace). */
export function digitsInput(parent: HTMLElement, id: string, label: string, value: string, x: number, y: number, width: number, height: number, maxLength = 10) {
  const input = make('input', 'bt-input', parent, id); input.value = value; input.inputMode = 'numeric'; input.maxLength = maxLength;
  input.setAttribute('aria-label', label); place(input, x, y, width, height);
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, maxLength); });
  return input;
}
export const windowBackground = (node: HTMLElement, art: string) => {
  void loadInterface(art).then(url => { node.style.backgroundImage = `url("${url}")`; }).catch(() => { /* black window without artwork */ });
};

export interface SlotView { button: HTMLButtonElement; key: string; token: number }
export interface SlotContent { object: number; amount: number; grh: number; equipped?: boolean; name: string; locked?: boolean; frame?: number }
/** Paints one slot only when its content changed: item picture, frame, quantity, equipped marker. */
export async function paintSlot(view: SlotView, art: SlotArt, slot: number, content: SlotContent, selected: boolean, label: string) {
  const key = `${content.object}/${content.amount}/${content.grh}/${content.equipped ?? false}/${content.locked ?? false}/${content.frame ?? 0}`;
  view.button.setAttribute('aria-pressed', String(selected));
  view.button.setAttribute('aria-disabled', String(content.locked ?? false));
  const name = content.object ? content.name : content.locked ? 'Bloqueada' : 'Vacía';
  view.button.title = name; view.button.setAttribute('aria-label', `${label} ${slot}: ${name}${content.object ? ` × ${content.amount}` : ''}`);
  if (view.key === key) return;
  const token = ++view.token; view.key = key;
  const [picture, frame] = await Promise.all([
    content.object && content.grh ? art.itemArt(content.grh).catch(() => undefined) : undefined,
    content.frame ? art.slotBackground(content.frame).catch(() => undefined) : undefined,
  ]);
  if (token !== view.token) return;
  view.button.style.backgroundImage = frame?.image ?? ''; view.button.style.backgroundPosition = frame?.position ?? '';
  view.button.replaceChildren();
  if (picture) view.button.append(picture);
  if (content.object && content.amount > 1) { const quantity = make('span', 'quantity', view.button); quantity.textContent = String(content.amount); }
  if (content.equipped) { const marker = make('span', 'equipped', view.button); marker.textContent = '+'; }
}
