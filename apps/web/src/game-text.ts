/*
 * Spanish names the classic client takes from its Languages/1.json (JsonLanguage.Item keys MENSAJE_CLASE_*,
 * MENSAJE_SKILL_*, MENSAJE_SKILL_DESC_*), filled in General.bas ListaClases / SkillsNames. Index = VB6 enum value:
 * eClass 1 Mage .. 12 Bandit, eSkill 1 Magia .. 24 Domar (Declares.bas). Copyright (C) 2022-2026 Noland Studios.
 * AGPL-3.0-or-later; no warranty. See NOTICE.
 */
export const CLASS_NAMES: readonly string[] = ['', "Mago", "Clérigo", "Guerrero", "Asesino", "Bardo", "Druida", "Paladín", "Cazador", "Trabajador", "Pirata", "Ladrón", "Bandido"];

export const SKILL_NAMES: readonly string[] = ['', "Magia", "Robar", "Destreza en combate", "Combate con armas largas",
  "Meditar", "Combate con armas cortas", "Ocultarse", "Supervivencia",
  "Comercio", "Defensa con escudo", "Liderazgo", "Armas a distancia",
  "Combate sin armas", "Navegación", "Equitación", "Resistencia mágica",
  "Tala", "Pesca", "Minería", "Herrería",
  "Carpintería", "Alquimia", "Sastrería", "Domar"];

