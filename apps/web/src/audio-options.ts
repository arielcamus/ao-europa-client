/*
 * Sound options, the audio part of frmOpciones (Music / Effects / Steps / Ambient on-off checks and volume bars, plus the
 * "invert channels" check). Same ranges as the VB6 scroll bars: -4000 (quiet) .. 0 (full). Settings persist in localStorage.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty. See ../../../LICENSE.
 */
import './audio-options.css';
import { MIN_VOLUME } from './audio-rules.js';
import type { AudioSettings } from './audio-rules.js';
import type { AudioEngine } from './audio-engine.js';

type Flag = 'musicEnabled' | 'fxEnabled' | 'stepsEnabled' | 'ambientEnabled';
type Volume = 'volMusic' | 'volFx' | 'volSteps' | 'volAmbient';
const ROWS: ReadonlyArray<{ id: string; label: string; flag: Flag; volume: Volume }> = [
  { id: 'music', label: 'Música', flag: 'musicEnabled', volume: 'volMusic' },
  { id: 'fx', label: 'Efectos', flag: 'fxEnabled', volume: 'volFx' },
  { id: 'steps', label: 'Pasos', flag: 'stepsEnabled', volume: 'volSteps' },
  { id: 'ambient', label: 'Ambiente', flag: 'ambientEnabled', volume: 'volAmbient' },
];

export class AudioOptions {
  readonly root = document.createElement('div');
  private readonly inputs = new Map<string, HTMLInputElement>();
  constructor(parent: HTMLElement, private readonly engine: AudioEngine, private readonly onClick: () => void = () => {}) {
    const root = this.root;
    root.id = 'audio-options'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Opciones de sonido');
    const title = document.createElement('h2'); title.textContent = 'Sonido'; root.append(title);
    root.append(this.row('all', 'Sonido', 'audioEnabled'));
    for (const row of ROWS) root.append(this.row(row.id, row.label, row.flag, row.volume));
    root.append(this.row('invert', 'Invertir canales', 'invertChannels'));
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'audio-close'; close.textContent = 'Cerrar';
    close.addEventListener('click', () => this.hide());
    root.append(close);
    root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.hide(); } });
    parent.append(root);
    this.engine.subscribe(settings => this.sync(settings));
    this.sync(engine.settings);
  }
  private row(id: string, label: string, flag: keyof AudioSettings, volume?: Volume) {
    const row = document.createElement('div'); row.className = 'audio-row';
    const text = document.createElement('label');
    const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.audio = `${id}-on`;
    check.addEventListener('change', () => { this.onClick(); this.engine.update({ [flag]: check.checked }); });
    text.append(check, label); row.append(text);
    this.inputs.set(`${id}-on`, check);
    if (volume) {
      const range = document.createElement('input'); range.type = 'range'; range.dataset.audio = `${id}-volume`;
      range.min = String(MIN_VOLUME); range.max = '0'; range.step = '10'; range.setAttribute('aria-label', `Volumen de ${label.toLowerCase()}`);
      range.addEventListener('input', () => this.engine.update({ [volume]: Number(range.value) }));
      row.append(range); this.inputs.set(`${id}-volume`, range);
    }
    return row;
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
  show() { this.root.hidden = false; this.sync(this.engine.settings); this.inputs.get('all-on')?.focus(); }
  hide() { this.root.hidden = true; }
  toggle() { if (this.visible) this.hide(); else this.show(); }
}
