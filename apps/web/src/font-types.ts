/*
 * Console font table, generated 2026-11-20 from client Recursos.bas InitFontTypes
 * (enum FontTypeNames order = the font index the server sends). AGPL-3.0-or-later.
 */
export interface FontType { name: string; red: number; green: number; blue: number; bold: boolean; italic: boolean }
const rows: [string, number, number, number, number, number][] = [
  ['TALK', 255, 255, 255, 0, 0],
  ['FIGHT', 255, 0, 0, 1, 0],
  ['WARNING', 255, 0, 0, 0, 1],
  ['INFO', 65, 190, 156, 0, 0],
  ['INFOBOLD', 65, 190, 156, 1, 0],
  ['EJECUCION', 130, 130, 130, 1, 0],
  ['PARTY', 255, 180, 250, 0, 0],
  ['VENENO', 0, 255, 0, 0, 0],
  ['GUILD', 255, 255, 255, 1, 0],
  ['SERVER', 0, 185, 0, 0, 0],
  ['GUILDMSG', 228, 199, 27, 0, 0],
  ['CONSEJO', 120, 220, 255, 1, 0],
  ['CONSEJOCAOS', 160, 15, 0, 1, 0],
  ['CONSEJOVesA', 120, 220, 255, 1, 0],
  ['CONSEJOCAOSVesA', 160, 15, 0, 1, 0],
  ['CENTINELA', 0, 255, 0, 1, 0],
  ['GMMSG', 255, 255, 255, 0, 1],
  ['GM', 2, 161, 38, 1, 0],
  ['DIOS', 217, 164, 32, 1, 0],
  ['CITIZEN', 0, 130, 255, 1, 0],
  ['CITIZEN_ARMADA', 0, 100, 255, 1, 0],
  ['CRIMINAL', 240, 75, 70, 1, 0],
  ['CRIMINAL_CAOS', 255, 0, 0, 1, 0],
  ['EXP', 42, 169, 222, 1, 0],
  ['SUBASTA', 188, 192, 103, 0, 0],
  ['GLOBAL', 255, 102, 204, 0, 1],
  ['MP', 157, 226, 20, 0, 0],
  ['ROSA', 255, 0, 128, 0, 0],
  ['VIOLETA', 99, 0, 198, 0, 0],
  ['INFOIAO', 204, 193, 115, 0, 1],
  ['New_Amarillo_Oscuro', 150, 100, 20, 0, 0],
  ['New_Verde_Oscuro', 0, 120, 70, 0, 0],
  ['New_Naranja', 255, 80, 0, 0, 0],
  ['New_Celeste', 0, 200, 255, 0, 0],
  ['New_Amarillo_Verdoso', 150, 150, 0, 0, 0],
  ['New_Gris', 128, 128, 128, 1, 0],
  ['New_Blanco', 255, 255, 255, 0, 0],
  ['New_Rojo_Salmon', 200, 50, 50, 0, 0],
  ['New_DONADOR', 100, 180, 200, 1, 0],
  ['New_GRUPO', 250, 200, 0, 0, 1],
  ['New_Eventos', 0, 200, 250, 1, 1],
  ['PROMEDIO_IGUAL', 255, 255, 0, 1, 0],
  ['PROMEDIO_MENOR', 255, 0, 0, 1, 0],
  ['PROMEDIO_MAYOR', 0, 255, 0, 1, 0],
];
export const fontTypes: FontType[] = rows.map(([name, red, green, blue, bold, italic]) => ({ name, red, green, blue, bold: bold === 1, italic: italic === 1 }));
export const fontCss = (index: number): { color: string; bold: boolean; italic: boolean } | undefined => {
  const font = fontTypes[index];
  return font ? { color: `rgb(${font.red}, ${font.green}, ${font.blue})`, bold: font.bold, italic: font.italic } : undefined;
};
