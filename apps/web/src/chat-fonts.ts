/*
 * Console font and name-colour tables, 2026-11-20, from the classic client
 * Recursos.bas (InitFontTypes, FontTypeNames) and init/colores.dat.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 * The server's e_FontTypeNames (Protocol.bas:66) has the same 44 entries in the same order.
 */
export interface TextStyle { r: number; g: number; b: number; bold: boolean; italic: boolean }

/** [red, green, blue, bold, italic] per FontTypeNames index. Unset VB6 fields default to 0. */
const FONT_ROWS: readonly (readonly [number, number, number, number, number])[] = [
  /*  0 FONTTYPE_TALK */ [255, 255, 255, 0, 0],
  /*  1 FONTTYPE_FIGHT */ [255, 0, 0, 1, 0],
  /*  2 FONTTYPE_WARNING */ [255, 0, 0, 0, 1],
  /*  3 FONTTYPE_INFO */ [65, 190, 156, 0, 0],
  /*  4 FONTTYPE_INFOBOLD */ [65, 190, 156, 1, 0],
  /*  5 FONTTYPE_EJECUCION */ [130, 130, 130, 1, 0],
  /*  6 FONTTYPE_PARTY */ [255, 180, 250, 0, 0],
  /*  7 FONTTYPE_VENENO */ [0, 255, 0, 0, 0],
  /*  8 FONTTYPE_GUILD */ [255, 255, 255, 1, 0],
  /*  9 FONTTYPE_SERVER */ [0, 185, 0, 0, 0],
  /* 10 FONTTYPE_GUILDMSG */ [228, 199, 27, 0, 0],
  /* 11 FONTTYPE_CONSEJO */ [120, 220, 255, 1, 0],
  /* 12 FONTTYPE_CONSEJOCAOS */ [160, 15, 0, 1, 0],
  /* 13 FONTTYPE_CONSEJOVesA */ [120, 220, 255, 1, 0],
  /* 14 FONTTYPE_CONSEJOCAOSVesA */ [160, 15, 0, 1, 0],
  /* 15 FONTTYPE_CENTINELA */ [0, 255, 0, 1, 0],
  /* 16 FONTTYPE_GMMSG */ [255, 255, 255, 0, 1],
  /* 17 FONTTYPE_GM */ [2, 161, 38, 1, 0],
  /* 18 FONTTYPE_DIOS */ [217, 164, 32, 1, 0],
  /* 19 FONTTYPE_CITIZEN */ [0, 130, 255, 1, 0],
  /* 20 FONTTYPE_CITIZEN_ARMADA */ [0, 100, 255, 1, 0],
  /* 21 FONTTYPE_CRIMINAL */ [240, 75, 70, 1, 0],
  /* 22 FONTTYPE_CRIMINAL_CAOS */ [255, 0, 0, 1, 0],
  /* 23 FONTTYPE_EXP */ [42, 169, 222, 1, 0],
  /* 24 FONTTYPE_SUBASTA */ [188, 192, 103, 0, 0],
  /* 25 FONTTYPE_GLOBAL */ [255, 102, 204, 0, 1],
  /* 26 FONTTYPE_MP */ [157, 226, 20, 0, 0],
  /* 27 FONTTYPE_ROSA */ [255, 0, 128, 0, 0],
  /* 28 FONTTYPE_VIOLETA */ [99, 0, 198, 0, 0],
  /* 29 FONTTYPE_INFOIAO */ [204, 193, 115, 0, 1],
  /* 30 FONTTYPE_New_Amarillo_Oscuro */ [150, 100, 20, 0, 0],
  /* 31 FONTTYPE_New_Verde_Oscuro */ [0, 120, 70, 0, 0],
  /* 32 FONTTYPE_New_Naranja */ [255, 80, 0, 0, 0],
  /* 33 FONTTYPE_New_Celeste */ [0, 200, 255, 0, 0],
  /* 34 FONTTYPE_New_Amarillo_Verdoso */ [150, 150, 0, 0, 0],
  /* 35 FONTTYPE_New_Gris */ [128, 128, 128, 1, 0],
  /* 36 FONTTYPE_New_Blanco */ [255, 255, 255, 0, 0],
  /* 37 FONTTYPE_New_Rojo_Salmon */ [200, 50, 50, 0, 0],
  /* 38 FONTTYPE_New_DONADOR */ [100, 180, 200, 1, 0],
  /* 39 FONTTYPE_New_GRUPO */ [250, 200, 0, 0, 1],
  /* 40 FONTTYPE_New_Eventos */ [0, 200, 250, 1, 1],
  /* 41 FONTTYPE_PROMEDIO_IGUAL */ [255, 255, 0, 1, 0],
  /* 42 FONTTYPE_PROMEDIO_MENOR */ [255, 0, 0, 1, 0],
  /* 43 FONTTYPE_PROMEDIO_MAYOR */ [0, 255, 0, 1, 0],
  /* 44 party safe notices (HandlePartySafeOn/Off: AddtoRichTextBox 250,250,0 italic), not a FontTypeNames entry */ [250, 250, 0, 0, 1],];

/** FontTypes(index). VB6 would raise on an out-of-range index; fall back to FONTTYPE_TALK. */
export function fontStyle(index: number): TextStyle {
  const row = FONT_ROWS[index] ?? FONT_ROWS[0]!;
  return { r: row[0], g: row[1], b: row[2], bold: row[3] === 1, italic: row[4] === 1 };
}
export const FONTTYPE = { TALK: 0, INFO: 3, GUILDMSG: 10, GLOBAL: 25 } as const;

/** ColoresPJ(i) from init/colores.dat; only the entries chat names use are kept. */
const NAME_COLORS: Record<number, readonly [number, number, number]> = {
  1: [0, 136, 0], 2: [0, 136, 0], 3: [0, 225, 0], 4: [217, 164, 32], 5: [217, 164, 32],
  20: [6, 128, 255], 21: [60, 163, 255], 22: [66, 201, 255], 23: [255, 0, 0], 24: [255, 51, 51], 25: [255, 102, 102],
};
/** Faction status (server Faccion.Status) to the ColoresPJ index, TextRenderer.bas INDICE_COLOR_*. */
const STATUS_COLOR_INDEX: Record<number, number> = { 0: 23, 1: 20, 2: 24, 3: 21, 4: 25, 5: 22 };

/** The wire sends a privilege BIT MASK; the client indexes ColoresPJ with log2 (HandleCharacterCreate, HandleConsoleCharText). */
export const privilegeLevel = (mask: number) => (mask > 0 ? Math.round(Math.log2(mask)) : 0);

/** Colour of a "[Name]" prefix. WriteConsoleUserChat: a privilege colour wins over the faction colour. */
export function nameColor(status: number, level: number): readonly [number, number, number] {
  if (level > 0) return NAME_COLORS[level] ?? [0, 0, 0];
  return NAME_COLORS[STATUS_COLOR_INDEX[status] ?? -1] ?? [0, 0, 0];
}
/** HandleGuildChat: status 0..5 uses the faction colour, 10 marks the guild leader (no colour; font style). */
export function guildStatusColor(status: number): readonly [number, number, number] | undefined {
  const index = STATUS_COLOR_INDEX[status];
  return index === undefined ? undefined : NAME_COLORS[index];
}
