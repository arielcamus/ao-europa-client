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
  // Not VB6 text: the classic client has no message for these, it just lands on the login screen (char-create, 21 Nov).
  createClosed: 'El servidor cerró la conexión sin crear el personaje y sin decir por qué. Volvé a entrar e intentá de nuevo.',
  createNoAnswer: 'El servidor no respondió a la creación del personaje y se cerró la conexión. Volvé a entrar e intentá de nuevo.',
  enterClosed: 'El servidor cerró la conexión sin dejar entrar al personaje y sin decir por qué. Volvé a entrar e intentá de nuevo.',
  enterNoAnswer: 'El servidor no respondió al entrar con el personaje y se cerró la conexión. Volvé a entrar e intentá de nuevo.',
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
export function headsFor(race: number, gender: number, drawable: (head: number) => boolean = () => true): number[] {
  const male = [[...range(1, 41), ...range(778, 791)], [...range(101, 132), ...range(531, 545)], [...range(200, 229), ...range(792, 810)], range(400, 429), range(300, 344), range(500, 529)];
  const female = [[...range(50, 80), ...range(187, 190), ...range(230, 246)], [...range(150, 179), ...range(758, 777)], range(250, 279), range(450, 479), range(350, 379), range(550, 579)];
  const all = (gender === 0 ? male : female)[race] ?? [1];
  // Ranges the server accepts but the public art never drew (cabezas.ind holds an all-zero entry, e.g. human male 778-791, elf 531-545,
  // dwarf 330-344): offering them shows a body with no head. They stay valid for the server, they are only not offered.
  const shown = all.filter(drawable);
  return shown.length ? shown : all;
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
/**
 * The home cities a new character may pick, in list order, index 0 (Ullathorpe) selected first.
 * ListaCiudades (General.bas at the pinned client 619e69d) minus Forgat: Ariel hid Forgat for now (2026-11-21), and the server only accepts
 * Ullathorpe, Nix, Banderbill, Lindos and Arghal (Hogar.IsValidCharacterCreationCity, our post-pin backport of upstream 07009f8a; anything else
 * starts in Ullathorpe). Each id is the server's e_City value (Declares.bas), the byte WriteLoginNewChar sends. The pinned client sent
 * lstHogar.ListIndex + 1, which put its Forgat entry on 6 = Arkhein; ids are explicit here so the list order can never shift them.
 */
export const HOME_CITIES = [
  { name: 'Ullathorpe', id: 1 }, { name: 'Nix', id: 2 }, { name: 'Banderbill', id: 3 }, { name: 'Lindos', id: 4 }, { name: 'Arghal', id: 5 },
] as const;
/** The e_City id sent for the city at this list index. */
export function homeCityId(index: number): number { return HOME_CITIES[index]!.id; }

/** What to tell the player when a character request ends with a closed socket and no word from the server (never a silent login screen). */
export function silentLoginText(kind: 'create' | 'enter', timedOut: boolean): string {
  if (kind === 'create') return timedOut ? TEXT.createNoAnswer : TEXT.createClosed;
  return timedOut ? TEXT.enterNoAnswer : TEXT.enterClosed;
}
