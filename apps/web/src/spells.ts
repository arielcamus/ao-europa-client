/*
 * Spell casting state, adapted 2026-11-20 from the classic client's frmMain
 * (cmdLanzar_Click, cmdMoverHechi_Click, imgSpellInfo_Click), ModGameplayUI.UseSpell
 * and the left-click path (WriteWorkLeftClick), plus Protocol.HandleWorkRequestTarget,
 * HandleCreateFX and HandleFxPiso. Spell console tokens (HECINF, HecMSG...) are expanded by chat-console.ts.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty. See NOTICE.
 */
import { NpcsServerPacketId as NS, ServerPacketId as S, SpellClientPacketId as SC, SpellServerPacketId as SS, MAGIC_SKILL, CraftingClientPacketId as CC, ExtractionSkill } from '@ao/protocol';
import type { ClientPacket, ServerPacket } from '@ao/protocol';
import { fetchText, parseIni } from './assets.js';
import type { Ini } from './assets.js';
import { sharedLocale } from './chat-locale.js';
import type { PacketFamily } from './packet-counters.js';

/** Plays once for loops=0; the client's Grh test is `Elapsed < frameTime * (Loops + 1)`, -1 repeats forever. */
export interface ActiveFx {
  /** FXs.ini section number (the FX id on the wire). */
  fx: number;
  /** Target character, or undefined for a floor FX. */
  charIndex: number | undefined;
  /** Tile for floor FX, or the fallback tile when the character is not known. */
  x: number; y: number;
  loops: number;
  startedAt: number;
  /** Floor FX carry the Grh directly (FxPiso) instead of an FXs.ini id. */
  grh?: number;
  /** The looping meditation aura (HandleMeditateToggle): drawn at +4 with alpha 180 and normal blend, like engine.bas Draw_Animation. */
  meditation?: boolean;
}
export interface Targeting { skill: number; area: boolean; radius: number }

const EMPTY = '(Vacío)';
/** Languages/1.json MENSAJE_LANZAMIENTO_RAPIDO and MENSAJE_TRABAJO_MAGIA, Spanish. */
export const MSG_TOO_FAST = 'No puedes lanzar hechizos tan rápido.';
export const MSG_CLICK_TARGET = 'Haz click sobre el objetivo...';
/** Languages/1.json MENSAJE_CLICK_DONDE_DESEAS_TRABAJAR and MENSAJE_TRABAJO_FUNDIRMETAL (HandleWorkRequestTarget). */
export const MSG_CLICK_WORK = 'Haz click donde deseas trabajar...';
export const MSG_CLICK_FORGE = 'Haz click sobre la fragua...';
/** Skills whose click is WriteStartAutomatedAction (ModGameplayUI.OnClick), not WorkLeftClick: the server then repeats the work itself. */
const AUTOMATED_SKILLS: readonly number[] = [ExtractionSkill.Talar, ExtractionSkill.Mineria, ExtractionSkill.Pescar, ExtractionSkill.Smelting];
const WORK_PROMPT_SKILLS: readonly number[] = [ExtractionSkill.Talar, ExtractionSkill.Alquimia, ExtractionSkill.Carpinteria, ExtractionSkill.Herreria, ExtractionSkill.Mineria, ExtractionSkill.Pescar];
const MAX_FX = 64;
/** e_Skill.Proyectiles and Languages/1.json MENSAJE_LANZAMIENTO_RAPIDO_FLECHAS / MENSAJE_TRABAJO_PROYECTILES. */
export const PROJECTILE_SKILL = 12;
export const MSG_ARROWS_TOO_FAST = 'No puedes lanzar flechas tan rápido.';
export const MSG_CLICK_VICTIM = 'Haz click sobre la victima...';

/** init/FXs.ini, read from the local resource mount. Dat/Hechizos.dat is `sharedLocale.spellData` (one copy: chat text, the hotkey bar and the list all read it). */
export interface SpellTables { fx: Ini }
export const spellTables: SpellTables = { fx: new Map() };

/** Load the FX table once. `spells` is the already parsed Dat/Hechizos.dat, shared through the locale. */
export async function loadSpellTables(spells: Ini): Promise<void> {
  sharedLocale.spellData = spells;
  spellTables.fx = parseIni(await fetchText('init/FXs.ini'));
}

export class SpellState {
  /** Set by WorkRequestTarget; cleared by a click, by a cancel (skill 0) or by leaving the map. */
  targeting: Targeting | undefined;
  effects: ActiveFx[] = [];
  /** HandleNotificarClienteCasteo: 1 = the cast came from the inventory (frmMain.shapexy turns green), else from the spell list (red). */
  castFrom: 'inventory' | 'spells' = 'spells';
  /** HandleGetInventarioHechizos: the panel a GM-follow asked this client to show (1 inventory, 2 spells + selection + scroll). */
  panelRequest: { value: number; selected: number; scroll: number; seq: number } | undefined;
  /** `Seguido` (NotificarClienteSeguido, not in the client yet): only a followed client reports its panel. */
  followed = false;
  cooldowns = new Map<number, { timeLeft: number; totalTime: number; at: number }>();
  revision = 0;
  private magicInterval = 0;
  private lastMagic = -Infinity;
  private bowInterval = 0;
  private lastArrow = -Infinity;

  constructor(
    private readonly send: (packet: ClientPacket) => void,
    private readonly clock: () => number,
    private readonly message: (text: string, font?: number) => void,
    /** The session's shared counters (PacketCounters): CastSpell and WorkLeftClick never keep their own. */
    private readonly next: (family: PacketFamily) => number,
  ) {}

  /** ModGameplayUI.UseSpell: the slot is 1-based, the server answers with WorkRequestTarget. */
  cast(slot: number, name: string): boolean {
    if (slot < 1 || slot > 40 || name === EMPTY) return false;
    this.send({ id: SC.CastSpell, slot, counter: this.next('castSpell') });
    return true;
  }
  /** WriteWorkLeftClick with skill Magia, only while the server asked for a target. */
  click(x: number, y: number): boolean {
    if (!this.targeting) return false;
    const { skill } = this.targeting;
    if (AUTOMATED_SKILLS.includes(skill)) {
      // No counter: StartAutomatedAction is not sequence checked. UsaLanzar = False, UsingSkill = 0 as for every click.
      this.send({ id: CC.StartAutomatedAction, x, y, skill });
      this.targeting = undefined; this.revision++;
      return true;
    }
    const now = this.clock();
    // SinBloqueo mode (the classic default) still sends but tells the player they are too fast.
    if (skill === MAGIC_SKILL && now - this.lastMagic < this.magicInterval) this.message(MSG_TOO_FAST);
    if (skill === MAGIC_SKILL) this.lastMagic = now;
    // ModGameplayUI.OnClick, UsingSkill = Proyectiles: SinBloqueo still shoots but warns when Intervals.bow has not elapsed (the Arrows timer).
    if (skill === PROJECTILE_SKILL) {
      if (now - this.lastArrow < this.bowInterval) this.message(MSG_ARROWS_TOO_FAST);
      this.lastArrow = now;
    }
    this.send({ id: SC.WorkLeftClick, x, y, skill, counter: this.next('workLeftClick') });
    this.targeting = undefined; this.revision++; // UsaLanzar = False: UsingSkill = 0
    return true;
  }
  /** WriteNotifyInventarioHechizos on a tab click or a spell list click while followed. */
  notifyPanel(value: 1 | 2, selected: number, scroll: number) {
    if (this.followed) this.send({ id: SC.NotifyInventarioHechizos, value, hechiSel: selected, scrollSel: scroll });
  }
  info(slot: number) { if (slot >= 1) this.send({ id: SC.SpellInfo, slot }); }
  move(up: boolean, slot: number) { this.send({ id: SC.MoveSpell, up, slot }); }
  cancel() { if (this.targeting) { this.targeting = undefined; this.revision++; } }
  reset() { this.targeting = undefined; this.effects = []; this.revision++; }

  receive(packet: ServerPacket) {
    switch (packet.id) {
      case S.Intervals: this.magicInterval = packet.magic; this.bowInterval = packet.bow; break;
      case S.ChangeMap: this.reset(); break;
      // A removed character takes its FX along (they are drawn on that character).
      case NS.CharacterRemove: this.effects = this.effects.filter(fx => fx.charIndex !== packet.charIndex); break;
      case SS.WorkRequestTarget: {
        if (packet.skill === 0) this.targeting = undefined;
        else if (!this.targeting || this.targeting.skill !== packet.skill) {
          this.targeting = { skill: packet.skill, area: packet.area, radius: packet.radius };
          if (packet.skill === MAGIC_SKILL) this.message(MSG_CLICK_TARGET);
          else if (packet.skill === ExtractionSkill.Smelting) this.message(MSG_CLICK_FORGE);
          else if (WORK_PROMPT_SKILLS.includes(packet.skill)) this.message(MSG_CLICK_WORK);
          else if (packet.skill === PROJECTILE_SKILL) this.message(MSG_CLICK_VICTIM, 0);
        }
        this.revision++; break;
      }
      case SS.GetInventarioHechizos: this.panelRequest = { value: packet.value, selected: packet.hechiSel, scroll: packet.scrollSel, seq: (this.panelRequest?.seq ?? 0) + 1 }; this.revision++; break;
      case SS.CreateFX: {
        // SetCharacterFx(charindex, 0, ..) is "no FX": it clears the character's FX instead of starting one.
        if (packet.fx === 0) { this.effects = this.effects.filter(fx => fx.charIndex !== packet.charIndex); this.revision++; break; }
        this.addFx({ fx: packet.fx, charIndex: packet.charIndex, x: packet.x, y: packet.y, loops: packet.loops, startedAt: this.clock() });
        break;
      }
      // HandleNotificarClienteCasteo (NotificarClienteCasteo) only recolours frmMain.shapexy, a PictureBox parked at (1200,1200) of a 1332x928 form (ModGameplayUI.SetupGameplayUI): never visible.
      case SS.NotifyCasting: this.castFrom = packet.value === 1 ? 'inventory' : 'spells'; break;
      // efxpiso (VB6 name Fxpiso): HandleFxPiso -> SetMapFx(x, y, Fx, 0), a floor FX.
      case SS.FxFloor: {
        this.addFx({ fx: 0, grh: packet.grh, charIndex: undefined, x: packet.x, y: packet.y, loops: 0, startedAt: this.clock() });
        break;
      }
      // LocaleMsg (141) is printed once, by chat's console pipeline.
      case SS.SendSkillCdUpdate: {
        this.cooldowns.set(packet.skillId, { timeLeft: packet.timeLeft, totalTime: packet.totalTime, at: this.clock() });
        break;
      }
      default: break;
    }
  }
  /** Also fed by combat: the blood splash on a hit victim (HandleCharAtaca) uses this one FX list and renderer. */
  addFx(fx: ActiveFx) {
    this.effects.push(fx);
    if (this.effects.length > MAX_FX) this.effects.shift();
  }
  /** Drop finished effects; `lengthMs(fx)` is one pass of the animation (0 = unknown, keep a second). */
  prune(now: number, lengthMs: (fx: ActiveFx) => number) {
    this.effects = this.effects.filter(fx => fx.loops < 0 || now - fx.startedAt < (lengthMs(fx) || 1000) * (fx.loops + 1));
  }
}

/**
 * cmdMoverHechi_Click: the client swaps the two list entries itself (the server does not resend
 * them). `slot` is 1-based. Returns the new 1-based slot, or the same one when the move is a no-op.
 */
export function swapSpellSlots<T extends { slot: number }>(spells: Map<number, T>, slot: number, up: boolean): number {
  const other = slot + (up ? -1 : 1);
  if (other < 1 || other > 40 || (!spells.has(slot) && !spells.has(other))) return slot;
  const a = spells.get(slot), b = spells.get(other);
  if (b) spells.set(slot, { ...b, slot }); else spells.delete(slot);
  if (a) spells.set(other, { ...a, slot: other }); else spells.delete(other);
  return other;
}
