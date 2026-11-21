/*
 * The gameplay and video options of frmOpciones that this client implements, remembered in localStorage (the VB6 client keeps them
 * in Configuracion.ini: OPCIONES/PermitirMoverse, OPCIONES/CopiarDialogoAConsola, VIDEO FPSFLAG). The sound options live in
 * audio-engine.ts. AGPL-3.0-or-later; no warranty. See ../../../LICENSE.
 */
export interface GameOptions {
  /** FPSFLAG: the "Fps: n" label. */
  showFps: boolean;
  /** PermitirMoverse ("Moverse al escribir"): the movement keys still walk while the chat box has focus. */
  moveWhileTyping: boolean;
  /** CopiarDialogoAConsola ("Copiar diálogos a consola"): player speech bubbles are also written to the console. */
  copyDialogToConsole: boolean;
  /** OPCIONES/CenteredMinimap ("Utilizar minimapa en modo continuo"): VB6 reads `GetSettingAsByte(..., 1)`, so it is on by default. */
  centeredMinimap: boolean;
  /** OPCIONES/CenteredMinimapZoom: the zoom of the centred minimap, -50..50 (frmMain.ApplyMinimapZoom). */
  centeredMinimapZoom: number;
}
export const DEFAULT_OPTIONS: GameOptions = { showFps: false, moveWhileTyping: false, copyDialogToConsole: true, centeredMinimap: true, centeredMinimapZoom: 0 };
export const OPTIONS_KEY = 'ao.options.v1';

/** Read a stored object defensively: unknown keys are dropped, non-booleans fall back to the default. */
export function sanitizeOptions(raw: unknown): GameOptions {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const flag = (key: 'showFps' | 'moveWhileTyping' | 'copyDialogToConsole' | 'centeredMinimap') => typeof o[key] === 'boolean' ? o[key] as boolean : DEFAULT_OPTIONS[key];
  const zoom = typeof o.centeredMinimapZoom === 'number' && Number.isFinite(o.centeredMinimapZoom) ? Math.round(o.centeredMinimapZoom) : DEFAULT_OPTIONS.centeredMinimapZoom;
  return {
    showFps: flag('showFps'), moveWhileTyping: flag('moveWhileTyping'), copyDialogToConsole: flag('copyDialogToConsole'),
    centeredMinimap: flag('centeredMinimap'), centeredMinimapZoom: Math.min(50, Math.max(-50, zoom)),
  };
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const browserStore = (): Store | undefined => { try { return globalThis.localStorage; } catch { return undefined; } };

export class OptionsSettings {
  private current: GameOptions;
  private readonly listeners = new Set<(options: GameOptions) => void>();
  constructor(private readonly store: Store | undefined = browserStore()) {
    let raw: unknown;
    try { const text = this.store?.getItem(OPTIONS_KEY); raw = text ? JSON.parse(text) : undefined; } catch { raw = undefined; }
    this.current = sanitizeOptions(raw);
  }
  get value(): Readonly<GameOptions> { return this.current; }
  update(patch: Partial<GameOptions>) {
    this.current = sanitizeOptions({ ...this.current, ...patch });
    try { this.store?.setItem(OPTIONS_KEY, JSON.stringify(this.current)); } catch { /* the option still applies this session */ }
    for (const listener of this.listeners) listener(this.current);
  }
  subscribe(listener: (options: GameOptions) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
}
