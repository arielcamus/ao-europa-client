/*
 * Skills, attributes, statistics, trainers, resting and meditation state, adapted 2026-11-20 from client Protocol.bas
 * (HandleSendSkills, HandleAtributes, HandleMiniStats, HandleLevelUp, HandleTrainerCreatureList, HandleRestOK,
 * HandleMeditateToggle, HandleCantUseWhileMeditating), ModGameplayUI.bas RequestSkills, frmMain.frm ImgEstadisticas and
 * FrmEstadisticas.frm / frmStatistics.frm / frmEntrenador.frm. Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later;
 * no warranty. See ../../../LICENSE and NOTICE. No DOM here: skills-window.ts draws it.
 */
import { SkillsServerPacketId as SS, NUM_SKILLS } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { CLASS_NAMES } from './game-text.js';
import { FONTTYPE } from './chat-fonts.js';

/** MAXSKILLPOINTS (client Declares.bas). */
export const MAX_SKILL_POINTS = 100;
/** ListaRazas, eRaza 1..6 (MENSAJE_RAZA_*). */
export const RACE_NAMES: readonly string[] = ['', 'Humano', 'Elfo', 'Elfo Oscuro', 'Gnomo', 'Enano', 'Orco'];
/** frmStatistics.Iniciar_Labels, Select Case Alineacion: caption and colour (MENSAJE_ESTADO_*). 4 and 5 have no JSON key in the shipped file. */
export const ALIGNMENTS: Readonly<Record<number, { text: string; color: string }>> = {
  0: { text: 'Criminal', color: 'rgb(240,75,70)' }, 1: { text: 'Ciudadano', color: 'rgb(0,130,255)' }, 2: { text: 'Legión Oscura', color: 'rgb(255,0,0)' },
  3: { text: 'Armada Real', color: 'rgb(0,100,255)' }, 4: { text: 'Consejo Real', color: 'rgb(120,220,255)' }, 5: { text: 'Concilio de las Sombras', color: 'rgb(160,15,0)' },
};
export const MESSAGES = {
  meditating: '¡Estás meditando! Debes dejar de meditar para usar objetos.',
  startMeditating: 'Comienzas a meditar.', stopMeditating: 'Has dejado de meditar.', fullMana: '¡Tu maná está completo!',
};

export interface Attributes { strength: number; agility: number; intelligence: number; constitution: number; charisma: number }
export interface MiniStats {
  citizensKilled: number; criminalsKilled: number; alignment: number; npcsKilled: number; classId: number;
  jailMinutes: number; deaths: number; gender: number; fishingPoints: number; race: number;
}
export interface SkillsContext {
  charIndex: number | undefined;
  message(text: string, font: number): void;
  /** ChatCombate = 1: the INFO tab of the chat is on (the meditation lines are only shown then). */
  infoChannel(): boolean;
  /** HandleMeditateToggle's StartFx(ActiveAnimation, Fx, -1) / ChangeToClip: a looping effect on a character, or none. */
  meditationFx(charIndex: number, fx: number): void;
}

/** UserEstadisticas text lines shown by frmStatistics (Iniciar_Labels). */
export function statsView(a: Attributes, m: MiniStats) {
  const alignment = ALIGNMENTS[m.alignment] ?? { text: '', color: '#eba40e' };
  return {
    attributes: [a.strength, a.agility, a.intelligence, a.constitution, a.charisma],
    className: CLASS_NAMES[m.classId] ?? '', race: RACE_NAMES[m.race] ?? '', gender: m.gender === 1 ? 'Hombre' : 'Mujer',
    alignment, jail: `${m.jailMinutes} min`, criminalsKilled: m.criminalsKilled, citizensKilled: m.citizensKilled,
    npcsKilled: m.npcsKilled, fishingPoints: m.fishingPoints,
  };
}

export class SkillsState {
  revision = 0;
  /** SkillPoints: the free points (HandleLevelUp, also sent at login). */
  skillPoints = 0;
  /** UserSkills(1..24), index 0 unused. */
  skills: number[] = Array.from({ length: NUM_SKILLS + 1 }, () => 0);
  attributes: Attributes | undefined;
  miniStats: MiniStats | undefined;
  /** FrmEstadisticas / frmStatistics / frmEntrenador are shown. */
  skillsOpen = false; statsOpen = false;
  trainerCreatures: string[] | undefined;
  /** UserDescansar (RestOK toggles it) and UserAvisado (the "stand up" Rest was already sent for this rest). */
  resting = false; standUpSent = false;
  /** UserMeditar. */
  meditating = false;
  /** LlegaronSkills, LlegaronAtrib, LlegaronStats. */
  private wantSkills = false; private gotAttributes = false; private gotStats = false;

  /** RequestSkills: the form opens when the server's SendSkills arrives. */
  expectSkills() { this.wantSkills = true; }
  /** ImgEstadisticas_MouseUp. */
  expectStats() { this.gotAttributes = false; this.gotStats = false; }
  closeSkills() { if (this.skillsOpen) { this.skillsOpen = false; this.revision++; } }
  closeStats() { if (this.statsOpen) { this.statsOpen = false; this.revision++; } }
  closeTrainer() { if (this.trainerCreatures) { this.trainerCreatures = undefined; this.revision++; } }
  /** The Login packet resets it (HandleLogged) and so does leaving the game. */
  reset() { this.resting = false; this.standUpSent = false; this.meditating = false; this.skillsOpen = this.statsOpen = false; this.trainerCreatures = undefined; this.skillPoints = 0; this.revision++; }

  receive(packet: ServerPacket, context: SkillsContext): void {
    switch (packet.id) {
      case SS.SendSkills:
        this.skills = [0, ...packet.skills.map(value => Math.min(100, value))];
        if (this.wantSkills) { this.skillsOpen = true; this.wantSkills = false; }
        break;
      case SS.LevelUp: this.skillPoints = packet.skillPoints; break;
      case SS.Atributes: {
        const { id: _id, ...attributes } = packet; this.attributes = attributes;
        if (this.gotStats) this.statsOpen = true; else this.gotAttributes = true;
        break;
      }
      case SS.MiniStats: {
        const { id: _id, ...stats } = packet; this.miniStats = stats;
        if (this.gotAttributes) this.statsOpen = true; else this.gotStats = true;
        break;
      }
      case SS.TrainerCreatureList: this.trainerCreatures = packet.creatures; break;
      case SS.RestOK: this.resting = !this.resting; this.standUpSent = false; break;
      case SS.CantUseWhileMeditating: context.message(MESSAGES.meditating, 2); break; // AddtoRichTextBox 255,0,0 = FONTTYPE_WARNING
      case SS.MeditateToggle:
        if (packet.charIndex === context.charIndex) {
          this.meditating = packet.fx !== 0;
          if (context.infoChannel()) context.message(this.meditating ? MESSAGES.startMeditating : MESSAGES.stopMeditating, FONTTYPE.INFO);
        }
        context.meditationFx(packet.charIndex, packet.fx);
        break;
      default: return;
    }
    this.revision++;
  }
}

/** The skill window's working copy (FrmEstadisticas): the values on screen, the points still to hand out, and the diff to send. */
export class SkillAllocation {
  readonly values: number[];
  /** Points added to each skill in this session of the form (flags()). */
  readonly added: number[];
  remaining: number;
  constructor(private readonly original: readonly number[], readonly total: number) {
    this.values = [...original]; this.added = original.map(() => 0); this.remaining = total;
  }
  /** Command1_Click, right arrow: Alocados > 0 and the skill below MAXSKILLPOINTS. */
  add(skill: number): boolean {
    if (this.remaining <= 0 || this.values[skill]! >= MAX_SKILL_POINTS) return false;
    this.values[skill]!++; this.added[skill]!++; this.remaining--; return true;
  }
  /** Left arrow: only what this session added, never below the server's value. */
  remove(skill: number): boolean {
    if (this.remaining >= this.total || this.values[skill]! <= 0 || this.added[skill]! <= 0) return false;
    this.values[skill]!--; this.added[skill]!--; this.remaining++; return true;
  }
  /** The VB6 RealizoCambios counter drifts; "something changed" is the intent (a skill differs from the server's). */
  get changed() { return this.values.some((value, i) => value !== this.original[i]); }
  /** skillChanges(i) = Text1(i) - UserSkills(i): the points ADDED per skill, skills 1..24. */
  get delta(): number[] { return this.values.slice(1).map((value, i) => value - this.original[i + 1]!); }
}
