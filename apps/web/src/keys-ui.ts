/*
 * frmCustomKeys: the key-binding editor. One row per binding of DefaultKey.ini (34), a key box that captures the next key
 * (txConfig_KeyUp, AlreadyBinded refuses a key used elsewhere), the "Clásica" / "Moderna" presets (Option1 / Option2), Guardar and
 * Restaurar (cmdAccion 0 / 1). The mouse-action combos (ACCION1..3) are not part of this client. AGPL-3.0-or-later; see NOTICE.
 */
import './options.css';
import { make } from './bank-trade-dom.js';
import { ACTION_LABELS, KeyBindings, NUM_BINDS, keyName } from './key-bindings.js';
import type { Bindings } from './key-bindings.js';
import { DEFAULTS_CLASSIC, DEFAULTS_MODERN, getActiveBindings, vbKeyCode } from './keymap.js';

const sameTable = (a: Bindings, b: Readonly<Record<number, number>>) => { for (let i = 1; i <= NUM_BINDS; i++) if (a[i] !== b[i]) return false; return true; };

export class KeysUI {
  readonly root: HTMLElement;
  private draft: Bindings = {};
  private readonly boxes = new Map<number, HTMLElement>();
  private readonly message: HTMLElement;
  private readonly ask: HTMLElement;
  private readonly presetInputs = new Map<string, HTMLInputElement>();
  constructor(parent: HTMLElement, private readonly bindings: KeyBindings, private readonly onChange: () => void = () => {}) {
    const root = this.root = make('section', '', parent, 'keys'); root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Configuración de controles');
    make('h2', '', root).textContent = 'Configuración de controles';
    const presets = make('div', 'keys-presets', root);
    make('span', '', presets).textContent = 'Configuración rápida:';
    for (const [id, label] of [['classic', 'Clásica'], ['modern', 'Moderna']] as const) {
      const wrap = make('label', '', presets), radio = make('input', '', wrap); radio.type = 'radio'; radio.name = 'keys-preset'; radio.dataset.preset = id;
      wrap.append(label); radio.addEventListener('click', () => this.applyPreset(id)); this.presetInputs.set(id, radio);
    }
    const list = make('div', 'keys-list', root, 'keys-list');
    for (let action = 1; action <= NUM_BINDS; action++) {
      const row = make('div', 'keys-row', list); make('span', '', row).textContent = ACTION_LABELS[action as keyof typeof ACTION_LABELS];
      const box = make('button', 'keys-box', row); box.type = 'button'; box.dataset.action = String(action);
      box.addEventListener('keydown', event => this.capture(action, event));
      this.boxes.set(action, box);
    }
    this.ask = make('div', 'keys-ask', root); this.ask.hidden = true;
    make('span', '', this.ask).textContent = '¿Guardar los cambios?';
    for (const [label, run] of [['Sí', () => { this.save(); this.hide(true); }], ['No', () => this.hide(true)], ['Cancelar', () => { this.ask.hidden = true; }]] as const) {
      const button = make('button', '', this.ask); button.type = 'button'; button.textContent = label; button.onclick = run;
    }
    const foot = make('div', 'keys-foot', root);
    this.message = make('span', 'keys-msg', foot);
    for (const [label, id, run] of [['Guardar', 'keys-save', () => { this.save(); this.hide(true); }], ['Restaurar', 'keys-restore', () => this.restore()], ['Cerrar', 'keys-close', () => this.hide()]] as const) {
      const button = make('button', '', foot, id); button.type = 'button'; button.textContent = label; button.onclick = run;
    }
    root.addEventListener('keydown', event => { if (event.key === 'Escape' && !(event.target as HTMLElement).classList.contains('keys-box')) { event.stopPropagation(); this.hide(); } });
  }
  /** txConfig_KeyUp: the next key pressed becomes the binding, unless another binding already uses it. */
  private capture(action: number, event: KeyboardEvent) {
    if (event.key === 'Tab') return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { this.hide(); return; }
    const code = vbKeyCode(event.code);
    const box = this.boxes.get(action)!;
    if (code === undefined) { this.message.textContent = 'Esa tecla no se puede asignar.'; return; }
    // The arrow keys walk implicitly (keymap.ts); only the four movement bindings may use them.
    if (code >= 37 && code <= 40 && (action < 14 || action > 17)) { box.dataset.bad = 'true'; this.message.textContent = 'Las flechas solo pueden asignarse al movimiento.'; return; }
    if (KeyBindings.taken(this.draft, code, action)) { box.dataset.bad = 'true'; this.message.textContent = `${keyName(code)} ya está asignada a otra acción.`; return; }
    box.dataset.bad = 'false'; this.message.textContent = ''; this.draft[action] = code; this.render();
  }
  private render() {
    for (const [action, box] of this.boxes) box.textContent = this.draft[action] ? keyName(this.draft[action]!) : '';
    this.presetInputs.get('classic')!.checked = sameTable(this.draft, DEFAULTS_CLASSIC);
    this.presetInputs.get('modern')!.checked = sameTable(this.draft, DEFAULTS_MODERN);
  }
  private save() { this.bindings.save(this.draft); this.onChange(); }
  /** Option1 / Option2: load the preset and save it at once. */
  private applyPreset(kind: 'classic' | 'modern') { this.draft = { ...this.bindings.preset(kind) }; this.message.textContent = ''; this.render(); this.onChange(); }
  /** cmdAccion(1) and the shipped layout: the modern defaults, forgetting the saved bindings. */
  private restore() { this.draft = { ...this.bindings.restore() }; this.message.textContent = ''; this.render(); this.onChange(); }
  get dirty() { return !sameTable(this.draft, getActiveBindings()); }
  get visible() { return !this.root.hidden; }
  show() { this.draft = { ...getActiveBindings() }; this.message.textContent = ''; this.ask.hidden = true; this.render(); this.root.hidden = false; this.boxes.get(1)?.focus(); }
  /** Form_QueryUnload: closing with unsaved changes asks first (inline, not a blocking box). */
  hide(force = false) {
    if (this.root.hidden) return;
    if (!force && this.dirty) { this.ask.hidden = false; return; }
    this.ask.hidden = true; this.root.hidden = true;
  }
}
