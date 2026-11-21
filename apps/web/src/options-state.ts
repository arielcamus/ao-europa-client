/*
 * Options feature state and actions, following the classic client Protocol.bas HandleBindKeys / HandleSendClientToggles,
 * modBindKeys.DoHotKey, ModGameplayUI.SetHotkey / ClearHotkeys, ModSettings.LoadHotkeys / SaveHotkey and frmGoliath.cmdAceptar (Transferir).
 * None of these client packets carries a sequence counter, so nothing here touches PacketCounters. AGPL-3.0-or-later; see NOTICE.
 */
import { HOTKEY_COUNT, HOTKEY_TOGGLE, HotkeyType, KeysClientPacketId as K, OptionsClientPacketId as OC, OptionsServerPacketId as OS } from '@ao/protocol';
import type { ClientPacket, ServerPacket } from '@ao/protocol';

/** t_HotkeyEntry; Index <= 0 is an empty slot (ClearHotkeys uses -1). */
export interface HotkeyEntry { index: number; lastKnownSlot: number; type: number }
export const emptyHotkey = (): HotkeyEntry => ({ index: -1, lastKnownSlot: -1, type: HotkeyType.Unknown });

export class OptionsState {
  revision = 0;
  /** FeatureToggles & eEnableHotkeys: set by SendClientToggles when the server lists "hotokey-enabled". */
  hotkeysEnabled = false;
  /** Every active server feature toggle (names, as sent). */
  toggles: string[] = [];
  /** HandleBindKeys: the chat-combat / chat-global icon states. */
  chatCombat = 0;
  chatGlobal = 0;
  hotkeys: HotkeyEntry[] = Array.from({ length: HOTKEY_COUNT }, emptyHotkey);
  /** HideHotkeys: the arrow button collapses the bar. */
  hideHotkeys = false;

  receive(packet: ServerPacket) {
    switch (packet.id) {
      case OS.SendClientToggles:
        this.toggles = [...packet.toggles]; this.hotkeysEnabled = packet.toggles.includes(HOTKEY_TOGGLE); break;
      case OS.BindKeys: this.chatCombat = packet.chatCombat; this.chatGlobal = packet.chatGlobal; break;
      default: return;
    }
    this.revision++;
  }
}

export interface Store { getItem(key: string): string | null; setItem(key: string, value: string): void }
const browserStore = (): Store | undefined => { try { return globalThis.localStorage; } catch { return undefined; } };
/** ModSettings reads Hotkeys.ini per character name; here one localStorage key per character. */
export const hotkeysKey = (name: string) => `ao.hotkeys.v1.${name}`;
const hideKey = 'ao.hotkeys.hide.v1';

/** Defensive read of the saved hotkeys: anything out of range is an empty slot. */
export function parseHotkeys(raw: string | null | undefined): HotkeyEntry[] {
  const list = Array.from({ length: HOTKEY_COUNT }, emptyHotkey);
  if (!raw) return list;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return list;
    parsed.slice(0, HOTKEY_COUNT).forEach((entry: unknown, i) => {
      const e = (entry ?? {}) as Record<string, unknown>;
      const int = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
      if (int(e.index, 1, 32767) && int(e.lastKnownSlot, -1, 32767) && (e.type === HotkeyType.Item || e.type === HotkeyType.Spell)) {
        list[i] = { index: e.index as number, lastKnownSlot: e.lastKnownSlot as number, type: e.type as number };
      }
    });
  } catch { /* keep empty */ }
  return list;
}

export interface OptionsDeps {
  send: (packet: ClientPacket) => void;
  ready: () => boolean;
  /** Session.sendAction-equivalent is not needed: UseHKeySlot has no counter. */
  dead: () => boolean;
  message: (text: string) => void;
  /** UsaLanzar = False / UsingSkill = 0 (DoHotKey cancels a pending spell target first). */
  cancelTargeting: () => void;
  store?: Store | undefined;
}

export class OptionsController {
  private character = '';
  private readonly store: Store | undefined;
  constructor(private readonly deps: OptionsDeps, private readonly state: OptionsState) { this.store = deps.store ?? browserStore(); }

  /**
   * ModSettings.LoadHotkeys, run when the character enters the game: read the saved slots and send every one with WriteSetHotkeySlot so
   * the server's copy matches (the server keeps its HotkeyList only for the connection).
   */
  loadHotkeys(character: string) {
    this.character = character;
    let raw: string | null = null, hide: string | null = null;
    try { raw = this.store?.getItem(hotkeysKey(character)) ?? null; hide = this.store?.getItem(hideKey) ?? null; } catch { /* no storage */ }
    this.state.hotkeys = parseHotkeys(raw); this.state.hideHotkeys = hide === '1';
    for (let slot = 0; slot < HOTKEY_COUNT; slot++) this.sendSlot(slot);
    this.state.revision++;
  }
  private sendSlot(slot: number) {
    const entry = this.state.hotkeys[slot]!;
    if (this.deps.ready()) this.deps.send({ id: OC.SetHotkeySlot, slot, index: entry.index, lastKnownSlot: entry.lastKnownSlot, type: entry.type });
  }
  /** ModGameplayUI.SetHotkey: remember it, save it, tell the server. */
  setHotkey(slot: number, index: number, lastKnownSlot: number, type: number) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= HOTKEY_COUNT || index < 1) return false;
    this.state.hotkeys[slot] = { index, lastKnownSlot, type };
    try { if (this.character) this.store?.setItem(hotkeysKey(this.character), JSON.stringify(this.state.hotkeys)); } catch { /* still applies this session */ }
    this.sendSlot(slot); this.state.revision++; return true;
  }
  toggleHide() {
    this.state.hideHotkeys = !this.state.hideHotkeys;
    try { this.store?.setItem(hideKey, this.state.hideHotkeys ? '1' : '0'); } catch { /* ignore */ }
    this.state.revision++;
  }
  /** modBindKeys.DoHotKey: dead players are told so; otherwise, with the server feature on, cancel a pending target and send UseHKeySlot. */
  useHotkey(slot: number) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= HOTKEY_COUNT) return;
    if (this.deps.dead()) { this.deps.message('¡¡Estás muerto!!'); return; }
    if (!this.state.hotkeysEnabled || !this.deps.ready()) return;
    if (this.state.hotkeys[slot]!.index > 0) this.deps.cancelTargeting();
    this.deps.send({ id: K.UseHKeySlot, slot });
  }
  /** frmGoliath.cmdAceptar case 3 (Transferir): WriteTransFerGold(amount, name). The server checks the banker, distance and the target. */
  transferGold(amount: number, username: string) {
    if (!this.deps.ready() || !(amount >= 1) || !username.trim()) return false;
    this.deps.send({ id: OC.TransFerGold, amount: Math.min(Math.trunc(amount), 2147483647), username: username.trim() });
    return true;
  }
}
