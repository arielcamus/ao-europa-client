/*
 * Fit a read-out into its VB6 label box. The labels are fixed-width boxes (stabar is 51 px, lblResis 22 px) and the browser's Tahoma Bold
 * is a little wider than VB6's, so "180 / 180" or "+19%" lost its last character to the box edge (Ariel, 22 Nov). AGPL-3.0-or-later.
 */
/** Approximate Tahoma Bold advance widths, in em. */
const ADVANCE: Record<string, number> = { ' ': .33, '/': .45, '%': 1.15, '+': .65, '.': .3, ',': .3, '—': 1 };
export const BASE_LABEL_PX = 11;
export const MIN_LABEL_PX = 7;
/** Extra px a read-out may take beyond its VB6 box: the label overflows evenly on both sides (style.css .label-fit), into the art around it. */
export const LABEL_SLACK = 8;

export function textWidthEm(text: string): number {
  let em = 0;
  for (const ch of text) em += ADVANCE[ch] ?? (/\d/.test(ch) ? .66 : .62);
  return em;
}
/** The largest font size (px, at most `base`, at least `min`) at which `text` fits `boxWidth`, with a 2 px margin. */
export function fitFontSize(text: string, boxWidth: number, base = BASE_LABEL_PX, min = MIN_LABEL_PX): number {
  const em = textWidthEm(text);
  if (em <= 0) return base;
  return Math.max(min, Math.min(base, Math.floor(((boxWidth - 2) / em) * 4) / 4));
}
/** Set the text of a label and shrink its font to fit its box. */
export function setFittedText(node: HTMLElement, text: string, boxWidth: number): void {
  node.textContent = text;
  const size = fitFontSize(text, boxWidth);
  node.style.fontSize = size >= BASE_LABEL_PX ? '' : `${size}px`;
}
