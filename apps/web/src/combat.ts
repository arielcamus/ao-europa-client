/*
 * Melee combat state adapted from client Protocol.bas (HandleCharSwing, HandleNPCHitUser,
 * HandleUserHittedByUser/User, HandleCharAtaca, HandleCreateFX, HandleTextOverChar,
 * HandleCharacterRemove side effects), Protocol_Writes.bas (WriteAttack) and modBindKeys.bas.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty. See NOTICE.
 */
import { BodyPart, CombatServerPacketId as CS, NpcsServerPacketId as NS } from '@ao/protocol';
import type { CharacterCreate, ServerPacket } from '@ao/protocol';
import type { ClassicState } from './ui-state.js';

/** FontTypeNames indexes used by the combat messages (client Recursos.bas). */
export const FONT = { FIGHT: 1, INFO: 3, PROMEDIO_MAYOR: 43 } as const;
/** CHAR_DIALOG_EFFECT_LIFE_MS, DIALOG_EFFECT_LINE_HEIGHT, MAX_STACKED_DIALOG_EFFECTS (TileEngine.bas). */
export const TEXT_LIFE_MS = 1300, TEXT_LINE_HEIGHT = 14, TEXT_STACK_MAX = 5;
/** Blood splash the client plays on a victim when a creature lands a hit (HandleCharAtaca). */
export const BLOOD_FX = 14;
/** Languages/1.json (Spanish), the keys the combat handlers read. */
const GOLPE: Record<number, string> = {
  [BodyPart.Head]: 'La criatura te ha pegado en la cabeza por ',
  [BodyPart.LeftArm]: 'La criatura te ha pegado el brazo izquierdo por ',
  [BodyPart.RightArm]: 'La criatura te ha pegado el brazo derecho por ',
  [BodyPart.LeftLeg]: 'La criatura te ha pegado la pierna izquierda por ',
  [BodyPart.RightLeg]: 'La criatura te ha pegado la pierna derecha por ',
  [BodyPart.Torso]: 'La criatura te ha pegado en el torso por ',
};
const RECIBE: Record<number, string> = {
  [BodyPart.Head]: ' te ha pegado en la cabeza por ',
  [BodyPart.LeftArm]: ' te ha pegado el brazo izquierdo por ',
  [BodyPart.RightArm]: ' te ha pegado el brazo derecho por ',
  [BodyPart.LeftLeg]: ' te ha pegado la pierna izquierda por ',
  [BodyPart.RightLeg]: ' te ha pegado la pierna derecha por ',
  [BodyPart.Torso]: ' te ha pegado en el torso por ',
};
const PRODUCE: Record<number, string> = {
  [BodyPart.Head]: ' en la cabeza por ',
  [BodyPart.LeftArm]: ' en el brazo izquierdo por ',
  [BodyPart.RightArm]: ' en el brazo derecho por ',
  [BodyPart.LeftLeg]: ' en la pierna izquierda por ',
  [BodyPart.RightLeg]: ' en la pierna derecha por ',
  [BodyPart.Torso]: ' en el torso por ',
};
export const MSG_DEAD = '¡¡Estás muerto!!', MSG_MISS_SELF = 'Fallo';

/** ModUtils.PonerPuntos: thousands separated by dots, no grouping below 1,000. */
export const ponerPuntos = (value: number) => String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** VB RGB() long (0x00BBGGRR) to a CSS colour, as RGBA_From_vbColor does. */
export const vbColor = (value: number) => `rgb(${value & 255}, ${(value >> 8) & 255}, ${(value >> 16) & 255})`;
export interface FloatingText { text: string; color: string; charIndex: number; start: number; slide: number }
type Source = { ui: ClassicState; characters: Map<number, CharacterCreate>; charIndex: number | undefined; clock(): number; bleed?: (charIndex: number, fx: number) => void };

export class CombatState {
  floating: FloatingText[] = [];
  /** charIndex -> start of the weapon swing (ArmaMov); drawing the swing needs weapon art, not rendered yet. */
  swings = new Map<number, number>();
  attacksSent = 0;
  lastAttack = 0;
  hitsDealt = 0;
  hitsTaken = 0;
  misses = 0;
  revision = 0;

  /** WriteAttack: blocked while gIntervals.Hit has not elapsed since the last accepted attack; first one always passes. */
  attack(now: number, interval: number, dead: boolean, ui: ClassicState, send: () => void): boolean {
    if (dead) { ui.message(MSG_DEAD, FONT.INFO); return false; }
    if (this.lastAttack !== 0 && interval > 0 && now - this.lastAttack < interval) return false;
    send(); // the counter is the session's (PacketCounters 'attack')
    this.lastAttack = Math.max(1, now);
    this.attacksSent++;
    return true;
  }
  private addText(text: string, color: string, charIndex: number, now: number) {
    // SetCharacterDialogFx: older lines of that char slide up one row; at most five stay.
    const mine = this.floating.filter(item => item.charIndex === charIndex && now - item.start <= TEXT_LIFE_MS);
    for (const item of mine) item.slide -= TEXT_LINE_HEIGHT;
    if (mine.length >= TEXT_STACK_MAX) this.floating.splice(this.floating.indexOf(mine[0]!), 1);
    this.floating.push({ text, color, charIndex, start: now, slide: 0 });
  }
  prune(now: number) {
    this.floating = this.floating.filter(item => now - item.start <= TEXT_LIFE_MS);
  }
  private line(source: Source, text: string, font = FONT.FIGHT) {
    source.ui.message(text, font);
    this.revision++;
  }
  private name(source: Source, charIndex: number) {
    const full = source.characters.get(charIndex)?.name ?? '';
    // Names carry a "<clan>" tail; the client keeps the part before it.
    const cut = full.indexOf('<');
    return cut < 0 ? full : full.slice(0, Math.max(0, cut - 1));
  }
  receive(packet: ServerPacket, source: Source): void {
    const now = source.clock();
    switch (packet.id) {
      case CS.CharSwing:
        // HandleCharSwing: a miss prints "Fallo" over the character, only for my own swings in this build.
        this.misses++;
        if (packet.showText && packet.notifyText && packet.charIndex === source.charIndex) this.addText(MSG_MISS_SELF, 'rgb(255, 0, 0)', packet.charIndex, now);
        break;
      case CS.NPCHitUser:
        this.hitsTaken++;
        this.line(source, (GOLPE[packet.place] ?? '') + ponerPuntos(packet.damage));
        break;
      case CS.UserHittedByUser:
        this.hitsTaken++;
        this.line(source, this.name(source, packet.charIndex) + (RECIBE[packet.place] ?? '') + ponerPuntos(packet.damage) + '.');
        break;
      case CS.UserHittedUser:
        this.hitsDealt++;
        this.line(source, 'Le has pegado a ' + this.name(source, packet.charIndex) + (PRODUCE[packet.place] ?? '') + ponerPuntos(packet.damage) + '.');
        break;
      case CS.CharAtaca:
        // Victim bleeds when the hit landed (damage > 0); -1 is a miss.
        // The splash is drawn by the spells FX renderer (CreateFX 60 is the spells codec); combat keeps no FX list.
        if (packet.damage > 0 && packet.victimIndex > 0) source.bleed?.(packet.victimIndex, BLOOD_FX);
        break;
      case CS.TextOverChar:
        this.addText(packet.text, vbColor(packet.color), packet.charIndex, now);
        break;
      case CS.ArmaMov:
        this.swings.set(packet.charIndex, now);
        break;
      case CS.CharUpdateHP: {
        const character = source.characters.get(packet.charIndex);
        if (character) source.characters.set(packet.charIndex, { ...character, minHp: packet.hp, maxHp: packet.maxHp });
        break;
      }
      case NS.CharacterRemove:
        // The npcs tracker owns the character store (CharacterRemove / CharacterChange); combat only drops its own effects.
        this.swings.delete(packet.charIndex);
        this.floating = this.floating.filter(item => item.charIndex !== packet.charIndex);
        break;
    }
  }
}

