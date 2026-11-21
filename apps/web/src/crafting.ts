/*
 * Crafting and work state, adapted 2026-11-20 from the classic client's Protocol.bas
 * (HandleShowBlacksmithForm, HandleBlacksmithWeapons/Armors/ExtraObjects, HandleCarpenterObjects,
 * HandleAlquimiaObjects, HandleSastreObjects, HandleMacroTrabajoToggle, HandleOpenCrafting,
 * HandleCraftingItem/Catalyst/Result, HandlePelearConPezEspecial), frmMain.MacroLadder_Timer,
 * ModUtils.ResetearUserMacro and the frmHerrero/frmCarp build buttons. Copyright (C) 2022-2026
 * Noland Studios. AGPL-3.0-or-later; no warranty. See NOTICE.
 *
 * None of these client packets carries a sequence counter, so nothing here touches PacketCounters.
 * Extraction clicks (chop, mine, fish, smelt) are sent by SpellState.click through the shared WorkRequestTarget flow.
 */
import { CraftingClientPacketId as CC, CraftingServerPacketId as CS, ServerPacketId as S } from '@ao/protocol';
import type { ClientPacket, ServerPacket } from '@ao/protocol';
import { MSG_FISH_BROKE, MSG_SUPER_FISH, SpecialFishing } from './fishing.js';

export type CraftingWindow = 'smith' | 'carpenter' | 'alchemy' | 'tailor' | 'crafting';
/** UserMacro.TIPO values (frmMain.MacroLadder_Timer): 1 alchemy, 3 tailor, 4 smith, 6 server-driven work. */
export const MacroType = { Alchemy: 1, Tailor: 3, Smith: 4, Work: 6 } as const;
/** AddtoRichTextBox colours of the client's own work prompts: build start / quantity (2,51,223 bold italic), server work start (2,223,51 bold), stop (223,51,2 bold). */
export const WORK_COLOR = { build: [2, 51, 223], start: [2, 223, 51], stop: [223, 51, 2] } as const;
/** MENSAJE_PEZ_ROMPIO_LINEA_PESCA is printed in 255,0,0 bold. */
export const MSG_FISH_BROKE_LINE = 'El pez ha roto tu línea de pesca.';
/** Languages/1.json, Spanish. */
export const MSG_START_WORK = 'Has comenzado a trabajar...';
export const MSG_BEGIN_WORK = 'Comienzas a trabajar.';
export const MSG_QUANTITY_ZERO = 'La cantidad debe ser mayor a 0.';
export const MSG_STOP_WORK = 'Has dejado de trabajar...';
/** frmCrafteo MAX_SLOTS_CRAFTEO (Declares.bas). */
export const MAX_CRAFT_SLOTS = 5;

export interface CraftingResultView { object: number; percent: number; price: number }
export interface CraftingCatalystView { object: number; amount: number }

/** The server's lists of what this character may build, and the server-driven windows. */
export class CraftingState {
  revision = 0;
  smithWeapons: number[] = [];
  /** DefensasHerrero as sent: armours, shields, rings and helmets together; the window splits them by object type. */
  smithDefenses: number[] = [];
  smithRunes: number[] = [];
  carpenter: number[] = [];
  alchemy: number[] = [];
  tailor: number[] = [];
  /** The window the server asked for; the UI mounts it. */
  open: CraftingWindow | undefined;
  /** frmCrafteo: which crafting station (OpenCrafting type), its slots, catalyst and the predicted result. */
  craftingType = 0;
  craftItems = new Map<number, number>();
  catalyst: CraftingCatalystView | undefined;
  catalystPercent = 0;
  result: CraftingResultView | undefined;
  /** HandleMacroTrabajoToggle: the server turned the work macro on or off. */
  workActive = false;
  /** The special-fish fight (PescandoEspecial and the bar of RenderScreen). */
  readonly fishing = new SpecialFishing();
  get specialFish() { return this.fishing.active; }
  /** Clock of the host, for the fight's 20 s limit; the controller sets it. */
  now: () => number = () => 0;
  /** gIntervals.BuildWork from the Intervals packet; the macro timer period. */
  buildWork = 0;
  /** Server-driven work macro and ModUtils.ResetearUserMacro, reported to the controller. */
  onWorkToggle: (active: boolean) => void = () => {};
  /** HandlePelearConPezEspecial: the overhead line MENSAJE_SUPER_PEZ over the player. */
  onSuperFish: () => void = () => {};

  receive(packet: ServerPacket): void {
    switch (packet.id) {
      case S.Intervals: this.buildWork = packet.buildWork; return;
      case S.ChangeMap: this.closeWindow(); return;
      case CS.BlacksmithWeapons: this.smithWeapons = [...packet.objects]; break;
      case CS.BlacksmithArmors: this.smithDefenses = [...packet.objects]; break;
      case CS.BlacksmithExtraObjects: this.smithRunes = [...packet.objects]; break;
      case CS.CarpenterObjects: this.carpenter = [...packet.objects]; break;
      case CS.AlquimistaObj: this.alchemy = [...packet.objects]; break;
      case CS.SastreObj: this.tailor = [...packet.objects]; break;
      case CS.ShowBlacksmithForm: this.open = 'smith'; break;
      case CS.ShowCarpenterForm: this.open = 'carpenter'; break;
      case CS.ShowAlquimiaForm: this.open = 'alchemy'; break;
      case CS.ShowSastreForm: this.open = 'tailor'; break;
      case CS.MacroTrabajoToggle: this.workActive = packet.active; this.onWorkToggle(packet.active); break;
      case CS.PelearConPezEspecial: this.fishing.start(this.now()); this.onSuperFish(); break;
      case CS.OpenCrafting:
        // HandleOpenCrafting: every crafting slot, the catalyst and the result start empty.
        this.craftingType = packet.type; this.craftItems.clear(); this.catalyst = undefined; this.catalystPercent = 0; this.result = undefined;
        this.open = 'crafting'; break;
      case CS.CraftingItem:
        // The VB6 handler indexes a fixed array and would raise; a stray slot is logged and dropped instead of closing the session.
        if (packet.slot < 1 || packet.slot > MAX_CRAFT_SLOTS) { console.warn(`CraftingItem: slot ${packet.slot} outside 1..${MAX_CRAFT_SLOTS} ignored`); return; }
        if (packet.object !== 0) this.craftItems.set(packet.slot, packet.object); else this.craftItems.delete(packet.slot);
        break;
      case CS.CraftingCatalyst:
        this.catalyst = packet.object !== 0 ? { object: packet.object, amount: packet.amount } : undefined;
        this.catalystPercent = packet.percent; break;
      case CS.CraftingResult:
        this.result = packet.object > 0 ? { object: packet.object, percent: packet.percent ?? 0, price: packet.price ?? 0 } : undefined; break;
      default: return;
    }
    this.revision++;
  }
  closeWindow() {
    if (this.open === undefined && this.craftItems.size === 0) return;
    this.open = undefined; this.craftItems.clear(); this.catalyst = undefined; this.result = undefined; this.revision++;
  }
}

/** frmMain's UserMacro: repeats a build packet every BuildWork ms until the amount is spent or stamina runs out. */
export interface UserMacro { active: boolean; type: number; object: number; remaining: number; intervalMs: number; lastTick: number }

export interface CraftingDeps {
  send: (packet: ClientPacket) => void;
  ready: () => boolean;
  now: () => number;
  stamina: () => number | undefined;
  message: (text: string, font?: number) => void;
  /** Char_Dialog_Set over the player (HandlePelearConPezEspecial). */
  overhead?: (text: string, color: readonly [number, number, number]) => void;
  /** AddtoRichTextBox with explicit RGB; falls back to the plain console when the host has none. */
  colored?: (text: string, color: readonly [number, number, number], bold: boolean, italic: boolean) => void;
}

export class CraftingController {
  readonly macro: UserMacro = { active: false, type: 0, object: 0, remaining: 0, intervalMs: 0, lastTick: 0 };
  /** frmMain.macrotrabajo (the work-macro key) and MacroBltIndex: while on, opening a station re-sends the last build instead of the window. */
  macroEnabled = false;
  macroBuildObject = 0;

  constructor(private readonly deps: CraftingDeps, readonly state: CraftingState) {
    state.onWorkToggle = active => this.serverWorkToggle(active);
    state.now = () => deps.now();
    // &H1FFFF is the VB long 0x01FFFF: red 255, green 255, blue 1.
    state.onSuperFish = () => deps.overhead?.(MSG_SUPER_FISH, [255, 255, 1]);
  }

  /** The state first, then the VB6 handlers that act on it: a station form shown while the work macro is on re-sends the last build. */
  receive(packet: ServerPacket) {
    this.state.receive(packet);
    if (packet.id === CS.ShowBlacksmithForm && this.repeatsBuild) { this.state.closeWindow(); this.deps.send({ id: CC.CraftBlacksmith, object: this.macroBuildObject }); }
    else if (packet.id === CS.ShowAlquimiaForm && this.repeatsBuild) { this.state.closeWindow(); this.deps.send({ id: CC.CraftAlquimista, object: this.macroBuildObject }); }
  }

  /** HandleMacroTrabajoToggle: off is ResetearUserMacro (which tells the server FlagTrabajar); on starts the type 6 macro. */
  private serverWorkToggle(active: boolean) {
    if (!active) { this.reset(); return; }
    this.colored(MSG_START_WORK, WORK_COLOR.start, true, false);
    Object.assign(this.macro, { active: true, type: MacroType.Work, remaining: 999, intervalMs: this.state.buildWork, lastTick: this.deps.now() });
  }
  /** ModUtils.ResetearUserMacro. */
  reset() {
    this.deps.send({ id: CC.FlagTrabajar });
    Object.assign(this.macro, { active: false, type: 0, object: 0, remaining: 0, intervalMs: 0, lastTick: 0 });
    this.colored(MSG_STOP_WORK, WORK_COLOR.stop, true, false);
  }
  private colored(text: string, color: readonly [number, number, number], bold: boolean, italic: boolean) {
    if (this.deps.colored) this.deps.colored(text, color, bold, italic); else this.deps.message(text);
  }
  /** frmMain.MacroLadder_Timer, called from the UI loop. */
  tick() {
    const macro = this.macro;
    // A Timer with Interval 0 is disabled in VB6: BuildWork 0 (not yet received) never sends.
    if (!macro.active || macro.intervalMs <= 0) return;
    const now = this.deps.now();
    if (now - macro.lastTick < macro.intervalMs) return;
    macro.lastTick = now;
    if (macro.remaining > 0 && (this.deps.stamina() ?? 0) > 0) {
      switch (macro.type) {
        case MacroType.Alchemy: this.deps.send({ id: CC.CraftAlquimista, object: macro.object }); macro.remaining--; break;
        case MacroType.Tailor: this.deps.send({ id: CC.CraftSastre, object: macro.object }); macro.remaining--; break;
        case MacroType.Smith: this.deps.send({ id: CC.CraftBlacksmith, object: macro.object }); macro.remaining--; break;
        default: break; // type 6: the server drives the work; the VB6 timer body is commented out
      }
    } else this.reset();
  }

  /** frmHerrero.cmdConstruir_Click: more than one starts the build macro, one is a single request. */
  buildSmith(object: number, quantity: number): boolean { return this.build(MacroType.Smith, CC.CraftBlacksmith, object, quantity); }
  buildAlchemy(object: number, quantity: number): boolean { return this.build(MacroType.Alchemy, CC.CraftAlquimista, object, quantity); }
  buildTailor(object: number, quantity: number): boolean { return this.build(MacroType.Tailor, CC.CraftSastre, object, quantity); }
  private build(type: number, id: typeof CC.CraftBlacksmith | typeof CC.CraftAlquimista | typeof CC.CraftSastre, object: number, quantity: number): boolean {
    if (!this.deps.ready() || object < 1) return false;
    if (quantity > 1) {
      this.colored(MSG_BEGIN_WORK, WORK_COLOR.build, true, true);
      Object.assign(this.macro, { active: true, type, object, remaining: quantity, intervalMs: this.state.buildWork, lastTick: this.deps.now() });
    } else {
      this.deps.send({ id, object });
      if (this.macroEnabled) this.macroBuildObject = object;
    }
    return true;
  }
  /** frmCarp.cmdConstruir_Click: the server owns the repetition (it answers MacroTrabajoToggle). */
  buildCarpenter(object: number, quantity: number): boolean {
    if (!this.deps.ready() || object < 1) return false;
    if (quantity > 0) { this.deps.send({ id: CC.CraftCarpenter, object, amount: quantity }); this.colored(MSG_BEGIN_WORK, WORK_COLOR.build, true, true); }
    else this.colored(MSG_QUANTITY_ZERO, WORK_COLOR.build, true, true);
    return true;
  }
  /** Server forms that find the work macro already on re-send the last build (HandleShowBlacksmithForm / HandleShowAlquimiaForm). */
  get repeatsBuild() { return this.macroEnabled && this.macroBuildObject > 0; }

  /** frmCrafteo. */
  addCraftItem(inventorySlot: number, craftSlot = 0) { this.send({ id: CC.AddItemCrafting, inventorySlot, craftSlot }); }
  removeCraftItem(craftSlot: number, inventorySlot = 0) { this.send({ id: CC.RemoveItemCrafting, craftSlot, inventorySlot }); }
  moveCraftItem(drag: number, drop: number) { this.send({ id: CC.MoveCraftItem, drag, drop }); }
  addCatalyst(inventorySlot: number) { this.send({ id: CC.AddCatalyst, inventorySlot }); }
  removeCatalyst(inventorySlot = 0) { this.send({ id: CC.RemoveCatalyst, inventorySlot }); }
  craft() { this.send({ id: CC.CraftItem }); }
  closeCrafting() { this.send({ id: CC.CloseCrafting }); this.state.closeWindow(); }

  /** Work-related requests with no window. */
  completeAction(action: number) { this.send({ id: CC.CompletarAccion, action }); }
  breakRod() { this.send({ id: CC.RomperCania }); }
  finishSpecialFish() { this.send({ id: CC.FinalizarPescaEspecial }); this.state.fishing.stop(); this.state.revision++; }
  /** General.MoveTo: walking away from the fight breaks the line first (message, WriteRomperCania). */
  onWalk() { if (this.state.fishing.active) this.breakLine(); }
  private breakLine() {
    this.state.fishing.stop(); this.state.revision++;
    this.colored(MSG_FISH_BROKE, [255, 0, 0], true, false);
    this.breakRod();
  }
  /** One frame of the fight (the RenderScreen block); the UI loop calls it with the time since the last frame. */
  tickFishing(elapsed: number) {
    const fishing = this.state.fishing;
    if (fishing.frame(this.deps.now(), elapsed) === 'broke') { this.state.revision++; this.colored(MSG_FISH_BROKE, [255, 0, 0], true, false); this.breakRod(); }
  }
  /** The P key while PescandoEspecial (ModGameplayUI KeyUp). */
  fishingKey() {
    const outcome = this.state.fishing.press();
    if (outcome === 'landed') this.send({ id: CC.FinalizarPescaEspecial });
    else if (outcome === 'broke') { this.colored(MSG_FISH_BROKE, [255, 0, 0], true, false); this.breakRod(); }
    return outcome;
  }
  repeatMacro() { this.send({ id: CC.RepeatMacro }); }
  private send(packet: ClientPacket) { if (this.deps.ready()) this.deps.send(packet); }
}
