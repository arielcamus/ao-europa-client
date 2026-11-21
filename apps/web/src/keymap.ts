/*
 * The classic game keys, from the VB6 client's Recursos/OUTPUT/DefaultKey.ini section [DEFAULTSMODERN] (the layout
 * where W A S D walk; modBindKeys.LoadDefaultBinds2) and modBindKeys.e_KeyAction / Accionar. One table for the whole
 * client: every binding 1..NumBinds (34) is here, keyed by its VB key code (Windows virtual-key code).
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty. See NOTICE.
 */

/** modBindKeys.e_KeyAction, the bindings DefaultKey.ini defines (NumBinds = 34). */
export enum KeyAction {
  Attack = 1, Loot = 2, Drop = 3, UseItem = 4, EquipItem = 5, ChangeSafe = 6, HideNames = 7, PartyToggle = 8, Steal = 9,
  RefreshPosition = 10, Hide = 11, ShowOnline = 12, ScreenShot = 13, MoveUp = 14, MoveDown = 15, MoveLeft = 16, MoveRight = 17,
  ClanCall = 18, GameStats = 19, ClanMark = 20, Meditate = 21, ExitGame = 22, Taming = 23,
  HotKey1 = 24, HotKey2 = 25, HotKey3 = 26, HotKey4 = 27, HotKey5 = 28, HotKey6 = 29, HotKey7 = 30, HotKey8 = 31, HotKey9 = 32, HotKey10 = 33,
  SendText = 34,
}

/** [DEFAULTSMODERN] N= keycode,name, verbatim (binding 22 appears twice in the file with the same value). */
export const DEFAULTS_MODERN: Readonly<Record<KeyAction, number>> = {
  1: 17, 2: 81, 3: 84, 4: 85, 5: 69, 6: 72, 7: 78, 8: 67, 9: 82, 10: 76, 11: 79, 12: 77, 13: 44, 14: 87, 15: 83, 16: 65, 17: 68,
  18: 71, 19: 106, 20: 86, 21: 117, 22: 123, 23: 74, 24: 49, 25: 50, 26: 51, 27: 52, 28: 53, 29: 54, 30: 55, 31: 56, 32: 57, 33: 48,
  34: 13,
};

/** [DEFAULTS] N= keycode, verbatim: the "Clásica" preset of frmCustomKeys (Option1, LoadDefaultBinds). Arrows walk, A attacks/picks up. */
export const DEFAULTS_CLASSIC: Readonly<Record<KeyAction, number>> = {
  1: 17, 2: 65, 3: 84, 4: 85, 5: 69, 6: 83, 7: 78, 8: 67, 9: 82, 10: 76, 11: 79, 12: 77, 13: 44, 14: 38, 15: 40, 16: 37, 17: 39,
  18: 71, 19: 106, 20: 86, 21: 117, 22: 123, 23: 68, 24: 49, 25: 50, 26: 51, 27: 52, 28: 53, 29: 54, 30: 55, 31: 56, 32: 57, 33: 48,
  34: 13,
};

/** The VB key code (vbKeyX) of a browser key, independent of the keyboard layout's printed letters. */
export function vbKeyCode(code: string): number | undefined {
  let m: RegExpExecArray | null;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1]!.charCodeAt(0);
  if ((m = /^Digit([0-9])$/.exec(code))) return 48 + Number(m[1]);
  if ((m = /^F([0-9]{1,2})$/.exec(code))) return 111 + Number(m[1]);
  if ((m = /^Numpad([0-9])$/.exec(code))) return 96 + Number(m[1]);
  return ({
    ControlLeft: 17, ControlRight: 17, ShiftLeft: 16, ShiftRight: 16, Enter: 13, NumpadEnter: 13, PrintScreen: 44, NumpadMultiply: 106,
    NumpadAdd: 107, NumpadDecimal: 110, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46, Insert: 45, Home: 36, End: 35,
    PageUp: 33, PageDown: 34, Space: 32, Tab: 9, Backspace: 8, Minus: 189, Comma: 188, Period: 190, IntlBackslash: 226,
  } as Record<string, number>)[code];
}

/** The live bindings (frmCustomKeys edits them; key-bindings.ts loads and saves them). Defaults are [DEFAULTSMODERN]. */
let active: Record<number, number> = { ...DEFAULTS_MODERN };
const byKeyCode = new Map<number, KeyAction>();
function index() {
  byKeyCode.clear();
  for (const [action, keyCode] of Object.entries(active)) if (!byKeyCode.has(keyCode)) byKeyCode.set(keyCode, Number(action) as KeyAction);
}
index();
export function setActiveBindings(table: Readonly<Record<number, number>>) { active = { ...table }; index(); }
export function getActiveBindings(): Readonly<Record<number, number>> { return active; }

/**
 * The action of a key. The arrow keys also walk (the [DEFAULTS] layout's movement keys) unless the player bound them to something
 * else, so both layouts move the character; everything else is exactly the active binding table.
 */
export function keyAction(code: string): KeyAction | undefined {
  const keyCode = vbKeyCode(code);
  if (keyCode === undefined) return undefined;
  const arrows: Record<number, KeyAction> = { 38: KeyAction.MoveUp, 40: KeyAction.MoveDown, 37: KeyAction.MoveLeft, 39: KeyAction.MoveRight };
  return byKeyCode.get(keyCode) ?? arrows[keyCode];
}
