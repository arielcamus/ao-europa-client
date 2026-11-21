/*
 * Text and rules of the connect screens, adapted 2026-11-21 from the classic client: Languages/1.json (Spanish), General.bas
 * ValidarNombre, ModCabezas.bas DameOpciones, frmConnect.frm Rotacion_boton_*_clase, ModUtils.bas IniciarCrearPj.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 */
export const TEXT = {
  welcome: '¡Bienvenido a Argentum Online! ¿Ya tenes tu cuenta? Logea! sino, toca sobre Cuenta para crearte una.',
  welcomeBack: 'Bienvenido a Argentum Online, disfruta tu aventura!',
  remember: '¡Recordaré la cuenta para la próxima!',
  forget: '¡No recordaré nada!',
  captcha: 'Por favor revise el captcha.',
  connectionError: '¡No me pude conectar! Te recomiendo verificar el estado de los servidores en argentumonline.com.ar y asegurarse de estar conectado a internet.',
  serverError: 'Ha ocurrido un error al conectar con el servidor. Le recomendamos verificar el estado de los servidores en argentumonline.com.ar, y asegurarse de estar conectado directamente a internet.',
  badEmail: 'El email es inválido.',
  pickRace: 'Seleccione la raza del personaje.', pickHead: 'Seleccione una cabeza para el personaje.',
  pickGender: 'Seleccione el sexo del personaje.', pickHome: 'Seleccione el hogar del personaje.', pickClass: 'Seleccione la clase del personaje.',
  nameLength: 'Debes ingresar un nombre entre 3 y 18 caracteres.', nameChars: 'Sólo se permiten letras y espacios.',
  nameSpaces: 'No se permiten espacios consecutivos.', nameEdges: 'No se permiten espacios al inicio o al final.',
  characterLimit: 'Has alcanzado el límite de personajes de la cuenta.',
  deleteAsk: (name: string) => `¿Estás seguro que desea borrar el personaje ${name} de la cuenta?`,
  deleteUnsupported: 'Este servidor no permite borrar personajes: el borrado necesita el servidor de cuentas (DeleteCharacter no hace nada con PYMMO=0).',
  resetAsk: '¿Está seguro que desea resetear el personaje? Los items que no sean depositados se perderán.',
  assistant: [
    'No te olvides de visitar nuestro foro https://steamcommunity.com/app/1956740/discussions/',
    '¡Invitá a tus amigos y disfrutá en grupo tu viaje por Argentum Online!',
    'Si necesitás ayuda dentro del juego podés tipear /GM y escribir tu consulta.',
    '¿Sabías que podés configurar el juego a tu gusto como la respiración, modalidades del Lanzar y teclas?',
  ],
  worldCreator: '<Creador del Mundo>', creation: 'Creación de Personaje',
  name: 'Nombre', class: 'Clase', race: 'Raza', gender: 'Genero', home: 'Hogar', attributes: 'Atributos',
  attribute: ['Fuerza', 'Agilidad', 'Inteligencia', 'Constitución', 'Carisma'],
  classLabel: 'Clase: ', levelLabel: 'Nivel: ',
  genders: ['Hombre', 'Mujer'],
  races: ['Humano', 'Elfo', 'Elfo Oscuro', 'Gnomo', 'Enano', 'Orco'],
  /** ListaClases order (eClass). */
  classes: ['Mago', 'Clérigo', 'Guerrero', 'Asesino', 'Bardo', 'Druida', 'Paladín', 'Cazador', 'Trabajador', 'Pirata', 'Ladrón', 'Bandido'],
} as const;

/** General.ValidarNombre: the text of the first problem, or undefined when the name is valid. */
export function validateCharacterName(name: string): string | undefined {
  if (name.length < 3 || name.length > 18) return TEXT.nameLength;
  const upper = name.toUpperCase();
  let last = 0;
  for (const char of upper) {
    const code = char.charCodeAt(0);
    if ((code < 65 || code > 90) && code !== 32) return TEXT.nameChars;
    if (code === 32 && last === 32) return TEXT.nameSpaces;
    last = code;
  }
  if (upper.startsWith(' ') || upper.endsWith(' ')) return TEXT.nameEdges;
  return undefined;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** ModCabezas.DameOpciones (the same ranges as the server's ValidarCabeza). `race` indexes TEXT.races, `gender` 0 male / 1 female. */
export function headsFor(race: number, gender: number): number[] {
  const male = [[...range(1, 41), ...range(778, 791)], [...range(101, 132), ...range(531, 545)], [...range(200, 229), ...range(792, 810)], range(400, 429), range(300, 344), range(500, 529)];
  const female = [[...range(50, 80), ...range(187, 190), ...range(230, 246)], [...range(150, 179), ...range(758, 777)], range(250, 279), range(450, 479), range(350, 379), range(550, 579)];
  return (gender === 0 ? male : female)[race] ?? [1];
}

/** Rotacion_boton_adelante_clase: the arrow order of the class selector (it is not the list order). Values are 0-based indexes of TEXT.classes. */
export const CLASS_ROTATION = [0, 5, 4, 1, 3, 11, 6, 7, 2, 8] as const; // Mago, Druida, Bardo, Clérigo, Asesino, Bandido, Paladín, Cazador, Guerrero, Trabajador
export function rotateClass(index: number, forward: boolean): number {
  const at = CLASS_ROTATION.indexOf(index as never);
  if (at < 0) return index;
  return CLASS_ROTATION[(at + (forward ? 1 : CLASS_ROTATION.length - 1)) % CLASS_ROTATION.length]!;
}

/** frmCrearPersonaje lstProfesion_Click: the race advice shown with a class is not drawn by the render, so only body ids are needed. */
export const CREATE_BODY = 1, CREATE_BODY_SMALL = 52;
/** RenderUICrearPJ: races 0,1,2,5 are tall (body 1); gnomes and dwarves use body 52 and a 10 px lower head. */
export const isSmallRace = (race: number) => race === 3 || race === 4;

/** ModRaza from the [MODRAZA] section of init/sp_localindex.dat: `HumanoFuerza=+1`. Returns [fuerza, agilidad, inteligencia, constitucion, carisma]. */
export function raceModifiers(ini: Map<string, Map<string, string>>, race: number): number[] {
  const section = ini.get('modraza');
  const key = TEXT.races[race]!.replace(/ /g, '').toLowerCase();
  const value = (suffix: string) => Number(section?.get(`${key}${suffix}`) ?? 0) || 0;
  return ['fuerza', 'agilidad', 'inteligencia', 'constitucion', 'carisma'].map(value);
}
/** The home city id sent by WriteLoginNewChar (CHARACTER_CREATION_HOME_FORGAT) and its name. */
export const HOME_CITY = 7, HOME_CITY_NAME = 'Forgat';
