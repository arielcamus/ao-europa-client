/*
 * The key-binding editor's model (frmCustomKeys / frmBindKey, modBindKeys.LoadBindedKeys / SaveBindedKeys / LoadDefaultBinds /
 * LoadDefaultBinds2): the player's bindings are saved in localStorage (the VB6 client saves Teclas.ini) and fall back to
 * DefaultKey.ini [DEFAULTSMODERN]. AGPL-3.0-or-later; no warranty. See ../../../LICENSE.
 */
import { DEFAULTS_CLASSIC, DEFAULTS_MODERN, KeyAction, setActiveBindings } from './keymap.js';

export const BINDINGS_KEY = 'ao.keys.v1';
export type Preset = 'modern' | 'classic';
export type Bindings = Record<number, number>;

/** frmCustomKeys.txConfig_KeyUp: the printed name of a key code. */
export function keyName(code: number): string {
  const fixed: Record<number, string> = {
    16: 'Shift', 37: 'Flecha Izquierda', 38: 'Flecha Arriba', 39: 'Flecha Derecha', 40: 'Flecha Abajo', 17: 'Control', 34: 'Page Down', 33: 'Page Up',
    32: 'Barra Espaciadora', 46: 'Delete', 35: 'Fin', 36: 'Inicio', 45: 'Insert', 44: 'Impr. Pant', 106: '*', 107: 'Numerico +', 110: 'Numerico .',
    226: '<', 189: '-', 109: '-', 188: ',', 190: '.', 13: 'Enter', 8: 'Borrar', 9: 'Tab',
  };
  if (fixed[code]) return fixed[code];
  if (code >= 112 && code <= 123) return `F${code - 111}`;
  if (code >= 96 && code <= 105) return `Numerico ${code - 96}`;
  return String.fromCharCode(code);
}
/** modBindKeys.GetHotkeyLabel: the 4-character label drawn on a hotkey slot. */
export function hotkeyLabel(code: number): string {
  const short: Record<number, string> = { 46: 'Supr', 45: 'Ins', 36: 'Ini', 35: 'Fin', 33: 'RPg', 34: 'APg', 32: 'Esp', 9: 'Tab', 8: 'Bor', 16: 'Shf', 17: 'Ctrl', 18: 'Alt' };
  if (code === 0) return '';
  if (short[code]) return short[code];
  if (code >= 96 && code <= 105) return `N${code - 96}`;
  return keyName(code).slice(0, 4);
}
/** Spanish captions of the 34 bindings, in e_KeyAction order (frmCustomKeys lblSalirDel / lblHotKeys). */
export const ACTION_LABELS: Readonly<Record<KeyAction, string>> = {
  1: 'Atacar', 2: 'Tomar objeto', 3: 'Tirar objeto', 4: 'Usar objeto', 5: 'Equipar objeto', 6: 'Seguro', 7: 'Mostrar/ocultar nombres',
  8: 'Seguro de grupo', 9: 'Robar', 10: 'Actualizar posición', 11: 'Ocultarse', 12: 'Mostrar usuarios online', 13: 'Tomar screenshot',
  14: 'Moverse hacia arriba', 15: 'Moverse hacia abajo', 16: 'Moverse hacia la izquierda', 17: 'Moverse hacia la derecha',
  18: '(Clan) Llamada de clan', 19: 'Estadísticas del juego', 20: '(Clan) Marca de clan', 21: 'Meditar', 22: 'Salir del juego', 23: 'Domar',
  24: 'Atajo 1', 25: 'Atajo 2', 26: 'Atajo 3', 27: 'Atajo 4', 28: 'Atajo 5', 29: 'Atajo 6', 30: 'Atajo 7', 31: 'Atajo 8', 32: 'Atajo 9', 33: 'Atajo 10',
  34: 'Enviar texto',
};
export const NUM_BINDS = 34;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const browserStore = (): Store | undefined => { try { return globalThis.localStorage; } catch { return undefined; } };

/** Read what the player saved; anything malformed (a hostile or half-written value) falls back to the modern defaults. */
export function parseBindings(raw: string | null | undefined): Bindings {
  const table: Bindings = { ...DEFAULTS_MODERN };
  if (!raw) return table;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return table;
    for (let action = 1; action <= NUM_BINDS; action++) {
      const code = (parsed as Record<string, unknown>)[String(action)];
      if (typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 255) table[action] = code;
    }
  } catch { /* keep the defaults */ }
  // Two bindings on one key can only come from a corrupt or hand-edited value (the editor refuses duplicates): use the defaults.
  const codes = Object.values(table);
  return new Set(codes).size === codes.length ? table : { ...DEFAULTS_MODERN };
}

export class KeyBindings {
  table: Bindings;
  constructor(private readonly store: Store | undefined = browserStore()) {
    let raw: string | null = null;
    try { raw = this.store?.getItem(BINDINGS_KEY) ?? null; } catch { /* storage unavailable */ }
    this.table = parseBindings(raw);
    setActiveBindings(this.table);
  }
  /** frmCustomKeys.AlreadyBinded over the edit buffer. */
  static taken(table: Bindings, code: number, except?: number): boolean {
    for (let action = 1; action <= NUM_BINDS; action++) if (action !== except && table[action] === code) return true;
    return false;
  }
  /** cmdAccion(0): Guardar (GuardaConfigEnVariables + SaveBindedKeys). */
  save(table: Bindings) {
    this.table = { ...table }; setActiveBindings(this.table);
    try { this.store?.setItem(BINDINGS_KEY, JSON.stringify(this.table)); } catch { /* the bindings still apply this session */ }
  }
  /** cmdAccion(1) / Option1 / Option2: a preset (LoadDefaultBinds / LoadDefaultBinds2), saved at once. */
  preset(kind: Preset): Bindings {
    const table: Bindings = { ...(kind === 'classic' ? DEFAULTS_CLASSIC : DEFAULTS_MODERN) };
    this.save(table); return table;
  }
  /** Back to the shipped layout and forget the saved one. */
  restore(): Bindings {
    try { this.store?.removeItem(BINDINGS_KEY); } catch { /* ignore */ }
    this.table = { ...DEFAULTS_MODERN }; setActiveBindings(this.table); return this.table;
  }
}
