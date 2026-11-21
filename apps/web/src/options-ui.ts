/*
 * frmOpciones: the options window, drawn over the VB6 artwork (configuracion-vacio / -jugabilidad / -video / -audio, the tab and
 * close buttons) at the original positions (twips / 15). Three tabs like BtnSolapa(0..2); the audio tab is audio-options.ts. Options
 * this client implements are live; the rest of the VB6 checks are drawn disabled with their artwork captions so nothing pretends to work.
 * The key editor (frmCustomKeys) opens from the "Configurar teclas" button. AGPL-3.0-or-later; see NOTICE.
 */
import './options.css';
import { loadInterface } from './interface-assets.js';
import { make, place, artButton, windowBackground } from './bank-trade-dom.js';
import type { AudioOptions } from './audio-options.js';
import type { OptionsSettings, GameOptions } from './options-settings.js';
import type { KeysUI } from './keys-ui.js';

type Tab = 'jugabilidad' | 'video' | 'audio';
const TABS: ReadonlyArray<{ id: Tab; label: string; x: number }> = [
  { id: 'jugabilidad', label: 'Jugabilidad', x: 20 }, { id: 'video', label: 'Video', x: 186 }, { id: 'audio', label: 'Audio', x: 352 },
];
const UNAVAILABLE = 'Aún no disponible en este cliente.';

export class OptionsUI {
  readonly root: HTMLElement;
  private tab: Tab = 'jugabilidad';
  private readonly panels = new Map<Tab, HTMLElement>();
  private readonly tabButtons = new Map<Tab, HTMLButtonElement>();
  private readonly checks = new Map<string, HTMLInputElement>();
  constructor(parent: HTMLElement, private readonly audio: AudioOptions, private readonly settings: OptionsSettings, private readonly keys: KeysUI, private readonly onClick: () => void = () => {}) {
    const root = this.root = make('section', '', parent, 'options'); root.hidden = true; root.tabIndex = -1;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Opciones');
    windowBackground(root, 'configuracion-vacio');
    void loadInterface('check-amarillo').then(url => root.style.setProperty('--opt-check', `url("${url}")`)).catch(() => { /* a tick stays invisible without artwork */ });

    for (const tab of TABS) {
      const button = make('button', 'opt-tab', root, `options-tab-${tab.id}`); button.type = 'button'; place(button, tab.x, 80, 164, 28);
      button.setAttribute('role', 'tab'); button.setAttribute('aria-label', tab.label); button.onclick = () => { this.onClick(); this.select(tab.id); };
      this.tabButtons.set(tab.id, button);
    }
    this.panels.set('jugabilidad', this.gameplayPanel(root)); this.panels.set('video', this.videoPanel(root));
    this.panels.set('audio', audio.root); root.append(audio.root);
    windowBackground(this.panels.get('jugabilidad')!, 'configuracion-jugabilidad'); windowBackground(this.panels.get('video')!, 'configuracion-video');
    windowBackground(audio.root, 'configuracion-audio');

    artButton(root, 'options-keys', 'Configurar teclas', 'boton-config-teclas', 32, 452, 151, 28, () => { this.keys.show(); }).classList.add('opt-button');
    artButton(root, 'options-close', 'Cerrar', 'boton-cerrar', 505, 0, 29, 20, () => this.hide()).classList.add('opt-button');
    root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); if (!this.keys.visible) this.hide(); } });
    document.addEventListener('fullscreenchange', () => this.sync(this.settings.value));
    this.settings.subscribe(options => this.sync(options));
    this.select('jugabilidad'); this.sync(this.settings.value);
  }

  /** A check over the artwork's own box. `key` undefined draws it disabled (the option is not implemented in this client). */
  private check(panel: HTMLElement, id: string, label: string, x: number, y: number, key?: keyof GameOptions | 'fullscreen') {
    const input = make('input', 'opt-check', panel); input.type = 'checkbox'; input.dataset.option = id;
    place(input, x, y, 17, 17); input.setAttribute('aria-label', label); input.title = key ? label : `${label}: ${UNAVAILABLE.toLowerCase()}`;
    if (!key) input.disabled = true;
    else input.addEventListener('change', () => {
      this.onClick();
      if (key === 'fullscreen') {
        const request = input.checked ? document.documentElement.requestFullscreen?.() : document.fullscreenElement ? document.exitFullscreen?.() : undefined;
        void Promise.resolve(request).catch(() => { input.checked = Boolean(document.fullscreenElement); });
      } else this.settings.update({ [key]: input.checked });
    });
    this.checks.set(id, input); return input;
  }
  private combo(label: string, panel: HTMLElement, x: number, y: number, width: number, items: string[]) {
    const element = make('select', 'opt-select', panel); place(element, x, y, width, 21); element.disabled = true; element.title = UNAVAILABLE;
    element.setAttribute('aria-label', label);
    for (const item of items) element.append(new Option(item));
    return element;
  }
  /** PanelJugabilidad. */
  private gameplayPanel(root: HTMLElement) {
    const panel = make('div', 'opt-panel', root, 'options-panel-jugabilidad');
    this.check(panel, 'copy-dialog', 'Copiar diálogos a consola', 18, 43, 'copyDialogToConsole');
    this.check(panel, 'move-typing', 'Moverse al escribir', 18, 70, 'moveWhileTyping');
    this.combo('Lanzar hechizos', panel, 264, 72, 225, ['Bloqueo en soltar', 'Bloqueo al lanzar', 'Sin bloqueo']);
    this.check(panel, 'lock-spell-scroll', 'Bloquear scroll de lista de hechizos', 267, 97);
    this.check(panel, 'invert-click', 'Invertir click', 18, 213);
    this.check(panel, 'graphic-cursors', 'Cursores gráficos', 125, 213);
    make('span', 'opt-note', panel).textContent = 'Sensibilidad del mouse, idioma, estilo de equipo, texto de NPCs y tutorial: aún no disponibles.';
    return panel;
  }
  /** PanelVideo. Rows at y = 46, 73, 100, 127, 154, 181, 206, 231, 256, 281. */
  private videoPanel(root: HTMLElement) {
    const panel = make('div', 'opt-panel', root, 'options-panel-video');
    this.check(panel, 'fps', 'Mostrar FPS en pantalla', 18, 46, 'showFps');
    this.check(panel, 'move-window', 'Mover ventana de juego', 18, 73);
    this.check(panel, 'vsync', 'Sincronización vertical (vSync)', 18, 100);
    this.check(panel, 'breathing', 'Respiración de personajes', 18, 127);
    this.check(panel, 'fullscreen', 'Pantalla completa', 18, 154, 'fullscreen');
    this.check(panel, 'floor-items', 'Información de ítems en el suelo', 18, 181);
    this.check(panel, 'full-numbers', 'Números completos en el inventario', 18, 206);
    this.check(panel, 'exp-buttons', 'Botones en la barra de experiencia', 18, 231);
    this.check(panel, 'map-name', 'Nombre del mapa al cambiar de zona', 18, 256);
    this.check(panel, 'confirm-pet', 'Confirmación para liberar mascotas', 18, 281);
    this.check(panel, 'centered-minimap', 'Utilizar minimapa en modo continuo', 258, 46);
    return panel;
  }
  private sync(options: Readonly<GameOptions>) {
    const set = (id: string, value: boolean) => { const input = this.checks.get(id); if (input) input.checked = value; };
    set('copy-dialog', options.copyDialogToConsole); set('move-typing', options.moveWhileTyping); set('fps', options.showFps);
    set('fullscreen', Boolean(document.fullscreenElement));
  }
  /** BtnSolapa: the selected tab shows its "default" art, the others "off". */
  select(tab: Tab) {
    this.tab = tab;
    for (const [id, panel] of this.panels) panel.hidden = id !== tab;
    for (const t of TABS) {
      const button = this.tabButtons.get(t.id)!; button.setAttribute('aria-selected', String(t.id === tab));
      void loadInterface(`boton-${t.id}-${t.id === tab ? 'default' : 'off'}`).then(url => { if (this.tab === tab) button.style.backgroundImage = `url("${url}")`; }).catch(() => {});
    }
    if (tab === 'audio') this.audio.show(); else this.audio.hide();
  }
  get visible() { return !this.root.hidden; }
  show() { this.root.hidden = false; this.select(this.tab); this.sync(this.settings.value); this.root.focus(); }
  hide() { this.keys.hide(true); this.root.hidden = true; this.audio.hide(); }
  toggle() { if (this.visible) this.hide(); else this.show(); }
}
