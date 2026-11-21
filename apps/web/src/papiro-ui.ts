/*
 * frmMensajePapiro, adapted from frmMensajePapiro.frm: the 772x618 "board" bitmap with black made transparent (MakeFormTransparent),
 * centred over the main window, closed by the X at 656,48 or when it loses focus (Form_LostFocus). The server sends ShowPapiro when
 * a sign object without text is clicked (WorldActions.HandleSignAction). The links are the form's Label controls.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE. Artwork is read only from the local mount.
 */
import { loadInterface } from './interface-assets.js';
import type { Session } from './session.js';

/** Label controls: left, top, width, height (twips / 15), caption, text colour (VB6 BGR value), link. */
export const PAPIRO_LINKS: readonly { id: string; box: readonly [number, number, number, number]; text: string; color: string; center?: boolean; url: string }[] = [
  { id: 'news', box: [219, 215, 81, 17], text: 'Ir a novedades', color: '#0000c0', url: 'https://steamcommunity.com/app/1956740/allnews/' },
  { id: 'events', box: [219, 255, 121, 17], text: 'Ver próximos eventos', color: '#0000c0', url: 'https://discord.com/channels/761213868352471040/1225542315507056762' },
  { id: 'manual', box: [219, 294.67, 369, 17], text: 'Ir al manual', color: '#0000c0', url: 'https://www.argentumonline.com.ar/wiki' },
  { id: 'guide', box: [219, 335, 89, 17], text: 'Ir a Guía', color: '#0000c0', url: 'https://www.argentumonline.com.ar/wiki/guia-general/skills-clases' },
  { id: 'rules', box: [219, 375, 97, 17], text: 'Ir al reglamento', color: '#0000ff', url: 'https://www.argentumonline.com.ar/reglamento' },
  { id: 'patreon', box: [219, 415, 68, 33], text: 'Ayudar con Patreon', color: '#0000c0', center: true, url: 'https://www.patreon.com/nolandstudios' },
  { id: 'cafecito', box: [304, 415, 73, 33], text: 'Ayudar con Cafecito', color: '#0000c0', center: true, url: 'https://cafecito.app/nolandstudios' },
  { id: 'stream1', box: [424, 240, 153, 17], text: 'Argentum Online Oficial', color: '#0000c0', center: true, url: 'https://www.twitch.tv/argentumonlineoficial' },
  { id: 'stream2', box: [448, 264, 105, 17], text: 'Plus', color: '#0000c0', center: true, url: 'https://www.twitch.tv/Plus_1986' },
];

/** Form.MakeFormTransparent(Me, vbBlack): pure black pixels of the bitmap become see-through. */
async function blackToTransparent(url: string): Promise<string> {
  const image = new Image(); image.src = url; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) if (!pixels.data[i] && !pixels.data[i + 1] && !pixels.data[i + 2]) pixels.data[i + 3] = 0;
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}

export class PapiroUI {
  private root: HTMLElement | undefined;
  private session: Session | undefined;
  constructor(private readonly parent: HTMLElement, private readonly open: (url: string) => void = url => { window.open(url, '_blank', 'noopener,noreferrer'); }) {}

  get isOpen() { return !!this.root; }
  update(session: Session | undefined) {
    if (session !== this.session) { this.session = session; this.hide(); }
    if (!session) return;
    if (session.keyring.papiroOpen && !this.root) this.show(session);
    if (!session.keyring.papiroOpen && this.root) this.hide();
  }
  close() { this.session?.keyring.closePapiro(); this.hide(); }
  private hide() { this.root?.remove(); this.root = undefined; }

  private show(session: Session) {
    const root = document.createElement('section'); this.root = root; root.id = 'papiro-window'; root.className = 'papiro-window';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Mensaje');
    Object.assign(root.style, { left: `${Math.round((1024 - 773) / 2)}px`, top: `${Math.round((768 - 618) / 2)}px`, width: '773px', height: '618px' });
    root.tabIndex = -1;
    void loadInterface('board').then(blackToTransparent).then(url => { if (this.root === root) root.style.backgroundImage = `url("${url}")`; }).catch(() => { root.classList.add('papiro-plain'); });
    for (const link of PAPIRO_LINKS) {
      const label = document.createElement('a'); label.className = 'papiro-link'; label.id = `papiro-${link.id}`; label.href = link.url; label.textContent = link.text;
      label.target = '_blank'; label.rel = 'noopener noreferrer';
      const [x, y, w, h] = link.box;
      Object.assign(label.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, color: link.color, textAlign: link.center ? 'center' : 'left' });
      label.addEventListener('click', event => { event.preventDefault(); this.open(link.url); });
      root.append(label);
    }
    // Image1_Click: Unload Me.
    const close = document.createElement('button'); close.type = 'button'; close.className = 'papiro-close'; close.setAttribute('aria-label', 'Cerrar'); close.title = 'Cerrar';
    Object.assign(close.style, { left: '656px', top: '48px', width: '33px', height: '33px' });
    close.onclick = () => this.close(); root.append(close);
    // Form_Load centres the form; Form_LostFocus unloads it, Escape is the browser's way out too.
    root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.close(); } });
    root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget as Node | null)) window.setTimeout(() => { if (this.root === root && !root.contains(document.activeElement)) this.close(); }, 0); });
    this.parent.append(root); root.focus();
    void session;
  }
}
