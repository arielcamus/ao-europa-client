/*
 * Sound options, the PanelAudio of frmOpciones (Música / Efectos / Ambiente / Pasos on-off checks and volume bars, plus the "invertir
 * canales" check), drawn over configuracion-audio.bmp at the VB6 control positions (twips / 15). Same ranges as the VB6 scroll bars:
 * -4000 (quiet) .. 0 (full). Settings persist in localStorage. The panel lives inside the options window (options-ui.ts), which owns
 * its tabs and visibility. Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty. See ../../../LICENSE.
 */
import './audio-options.css';
import { MIN_VOLUME } from './audio-rules.js';
import type { AudioSettings } from './audio-rules.js';
import type { AudioEngine } from './audio-engine.js';

type Flag = 'musicEnabled' | 'fxEnabled' | 'stepsEnabled' | 'ambientEnabled';
type Volume = 'volMusic' | 'volFx' | 'volSteps' | 'volAmbient';
/** PanelAudio: check at (17, y), volume bar at (264, bar). Rows follow the artwork's captions top to bottom. */
const ROWS: ReadonlyArray<{ id: string; label: string; flag: Flag; volume: Volume; y: number; bar: number }> = [
  { id: 'music', label: 'Música', flag: 'musicEnabled', volume: 'volMusic', y: 46, bar: 40 },
  { id: 'fx', label: 'Efectos', flag: 'fxEnabled', volume: 'volFx', y: 73, bar: 120 },
  { id: 'ambient', label: 'Ambiente', flag: 'ambientEnabled', volume: 'volAmbient', y: 100, bar: 200 },
  { id: 'steps', label: 'Pasos', flag: 'stepsEnabled', volume: 'volSteps', y: 181, bar: 280 },
];

export class AudioOptions {
  readonly root = document.createElement('div');
  private readonly inputs = new Map<string, HTMLInputElement>();
  constructor(parent: HTMLElement, private readonly engine: AudioEngine, private readonly onClick: () => void = () => {}) {
    const root = this.root;
    root.id = 'audio-options'; root.hidden = true; root.className = 'opt-panel';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Opciones de sonido');
    // The artwork has no "Sonido" master caption; the master switch sits in the first column header, as a check above the list.
    root.append(this.check('all', 'Sonido', 'audioEnabled', 228, 12));
    for (const row of ROWS) {
      root.append(this.check(row.id, row.label, row.flag, 17, row.y));
      root.append(this.range(row.id, row.label, row.volume, row.bar));
    }
    root.append(this.check('invert', 'Invertir canales', 'invertChannels', 17, 154));
    root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.hide(); } });
    parent.append(root);
    this.engine.subscribe(settings => this.sync(settings));
    this.sync(engine.settings);
  }
  private check(id: string, label: string, flag: keyof AudioSettings, x: number, y: number) {
    const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.audio = `${id}-on`; check.className = 'opt-check';
    check.style.left = `${x}px`; check.style.top = `${y}px`; check.setAttribute('aria-label', label); check.title = label;
    check.addEventListener('change', () => { this.onClick(); this.engine.update({ [flag]: check.checked }); });
    this.inputs.set(`${id}-on`, check);
    return check;
  }
  private range(id: string, label: string, volume: Volume, y: number) {
    const range = document.createElement('input'); range.type = 'range'; range.dataset.audio = `${id}-volume`; range.className = 'opt-range';
    range.style.top = `${y}px`;
    range.min = String(MIN_VOLUME); range.max = '0'; range.step = '10'; range.setAttribute('aria-label', `Volumen de ${label.toLowerCase()}`);
    range.addEventListener('input', () => this.engine.update({ [volume]: Number(range.value) }));
    this.inputs.set(`${id}-volume`, range);
    return range;
  }
  /** Mirror the engine's settings into the controls (also after another tab or a restore). */
  sync(settings: AudioSettings) {
    const on = (id: string, value: boolean) => { const input = this.inputs.get(`${id}-on`); if (input) input.checked = value; };
    on('all', settings.audioEnabled); on('invert', settings.invertChannels);
    for (const row of ROWS) {
      on(row.id, settings[row.flag]);
      const range = this.inputs.get(`${row.id}-volume`);
      if (range) { range.value = String(settings[row.volume]); range.disabled = !settings.audioEnabled || !settings[row.flag]; }
    }
  }
  get visible() { return !this.root.hidden; }
  show() { this.root.hidden = false; this.sync(this.engine.settings); }
  hide() { this.root.hidden = true; }
}
