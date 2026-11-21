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

/** frmSkills3 shows these as the skill's help text (MENSAJE_SKILL_DESC_*). */
export const SKILL_DESCRIPTIONS: readonly string[] = ['',
  "Los hechizos requieren un cierto número de puntos mágicos para ser usados. Sube lanzando cualquier hechizo.",
  "Aumenta las posibilidades de conseguir objetos u oro mientras robas. Se sube robando. Solo el ladrón puede robar objetos, las otras clases solo pueden robar oro.",
  "Aumenta la posibilidad de esquivar ataques. Cuantos más puntos tengas, mejor será tu evasión. Sube mientras peleas cuerpo a cuerpo.",
  "Aumenta las posibilidades de golpear al enemigo con un arma. Subes peleando cuerpo a cuerpo usando cualquier arma.",
  "Aumenta la cantidad de mana que recuperamos al meditar. Se sube meditando. Al aumentar los puntos de esta habilidad, aumenta la mana que se recupera.",
  "Aumenta la probabilidad de apuñalar y de impactar golpes con armas cortas. Se sube luchando cuerpo a cuerpo con dagas.",
  "Esta habilidad es responsable de aumentar las posibilidades de esconderse. Se sube tratando de esconderse. Mientras más skills, más tiempo oculto.",
  "Permite tomar agua de ríos, comer de árboles y ver la vida de NPCs hostiles. Aumenta la velocidad de recuperación de energía. Sube combatiendo o prendiendo fogatas.",
  "Cuanto más puntos en comerciar tengas más baratas te saldrán las cosas en las tiendas. Sube tanto al comprar como al vender items a NPCs.",
  "Aumenta las chances de defenderte con un escudo. Más puntos significan mayor probabilidad de rechazar el golpe del adversario.",
  "Es la habilidad necesaria para crear un clan. Se sube manualmente.",
  "Aumenta las probabilidades de pegarle al enemigo con un arco.",
  "Aumenta las probabilidades de impactar al enemigo en la lucha sin armas, estupidizar o paralizar.",
  "Necesaria para utilizar traje de baño, barcas, galeras o galeones.",
  "Necesaria para equipar una montura.",
  "Reduce el daño recibido de hechizos. Sube al recibir ataques mágicos.",
  "Aumenta la velocidad a la que recolectas madera.",
  "Aumenta la velocidad a la que capturas peces.",
  "Aumenta la velocidad a la que extraes minerales.",
  "Permite crear mejores objetos de herrería.",
  "Permite crear mejores objetos de carpintería.",
  "Permite crear pociones más poderosas.",
  "Permite confeccionar mejores vestimentas.",
  "Aumenta la habilidad para domar animales.",];
