/*
 * Console line formatting, 2026-11-20, from the classic client Protocol.bas
 * (HandleConsoleMessage, HandleLocaleMsg, HandleGuildChat, HandleConsoleFactionMessage,
 * HandleConsoleCharText), ModUtils.bas (WriteConsoleUserChat) and General.bas
 * (AddtoRichTextBox). Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 */
import { FONTTYPE, fontStyle, guildStatusColor, nameColor } from './chat-fonts.js';
import type { TextStyle } from './chat-fonts.js';
import type { ChatLocale } from './chat-locale.js';

export interface Segment extends TextStyle { text: string }

/** One console line as received, kept raw so text that needs locale data can be built once that data has loaded. */
export type ChatLine =
  | { kind: 'console'; message: string; font: number }
  | { kind: 'locale'; id: number; extra: string; font: number }
  | { kind: 'faction'; message: string; font: number; label: string }
  | { kind: 'guild'; status: number; message: string }
  /** WriteConsoleUserChat: a bold "[Name] " in the speaker's colour, then the text in `color`. */
  | { kind: 'user'; name: string; text: string; color: readonly [number, number, number]; status: number; level: number };

/** VB6 `ReadField(n, text, Asc(sep))`: 1-based; an absent field is empty. */
export const readField = (n: number, text: string, separator: string) => text.split(separator)[n - 1] ?? '';
/** VB6 `Val`: the leading number, otherwise 0. */
export const vbVal = (text: string) => { const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)/.exec(text); return m ? Number(m[0]) : 0; };
const clamp255 = (value: number) => Math.max(0, Math.min(255, Math.trunc(value)));
const segment = (text: string, style: TextStyle): Segment => ({ text, ...style });
const rgb = (color: readonly [number, number, number], bold = false, italic = false): TextStyle => ({ r: color[0], g: color[1], b: color[2], bold, italic });

/** The `text~r~g~b~bold~italic` suffix used by server text, or the font table when absent. */
function styled(chat: string, font: TextStyle): Segment {
  const cut = chat.indexOf('~');
  if (cut < 0) return segment(chat, font);
  return segment(chat.slice(0, cut), {
    r: clamp255(vbVal(readField(2, chat, '~'))), g: clamp255(vbVal(readField(3, chat, '~'))), b: clamp255(vbVal(readField(4, chat, '~'))),
    bold: vbVal(readField(5, chat, '~')) !== 0, italic: vbVal(readField(6, chat, '~')) !== 0,
  });
}

/** HandleConsoleMessage: special "KEY*arg*arg" prefixes are expanded from local data. */
export function expandConsoleText(chat: string, locale: ChatLocale): string {
  const key = readField(1, chat, '*');
  switch (key) {
    case 'NPCNAME': return locale.npcName(vbVal(readField(2, chat, '*'))) + readField(3, chat, '*');
    case 'O': return `${locale.objectName(vbVal(readField(2, chat, '*')))} ${readField(3, chat, '*')}`;
    case 'HECINF': {
      // Protocol.HandleConsoleMessage HECINF, with the requirement lines from HechizoData (ported from spells #10).
      const spell = locale.spell(vbVal(readField(2, chat, '*')));
      const stamina = spell.staminaPercent > 0 ? `${spell.staminaPercent}% de stamina total.` : `${spell.stamina} puntos.`;
      return [`------------< Información del hechizo >------------`, `Nombre: ${spell.name}`, `Descripción: ${spell.desc}`,
        `Skill requerido: ${spell.minSkill} de magia.`, `Mana necesario: ${spell.mana} puntos.`, `Stamina necesaria: ${stamina}`].join('\n');
    }
    case 'ProMSG': return locale.spell(vbVal(readField(2, chat, '*'))).ownMessage;
    case 'HecMSG': return `${locale.spell(vbVal(readField(2, chat, '*'))).casterMessage} la criatura.`;
    case 'HecMSGU': return `${locale.spell(vbVal(readField(2, chat, '*'))).casterMessage} ${readField(3, chat, '*')}.`;
    case 'HecMSGA': return `${readField(3, chat, '*')} ${locale.spell(vbVal(readField(2, chat, '*'))).targetMessage}`;
    case 'ID': return locale.message(vbVal(readField(2, chat, '*')), readField(3, chat, '*'));
    default: return chat;
  }
}

export function formatLine(line: ChatLine, locale: ChatLocale): Segment[] {
  switch (line.kind) {
    case 'console': return [styled(expandConsoleText(line.message, locale), fontStyle(line.font))];
    case 'locale': return [styled(locale.message(line.id, line.extra), fontStyle(line.font))];
    case 'faction': return [segment(factionLabel(line.label) + line.message, fontStyle(line.font))];
    case 'guild': {
      let chat = line.message;
      if (chat.startsWith('Msg')) { // "Msg####¬Name": a locale id, then its parameters
        const prefix = readField(1, chat, '¬');
        chat = locale.message(vbVal(prefix.slice(3)), chat.slice(prefix.length + 1));
      }
      if (!chat.includes('~')) return [segment(chat, fontStyle(FONTTYPE.GUILDMSG))];
      const text = styled(chat, fontStyle(FONTTYPE.GUILDMSG)), color = guildStatusColor(line.status);
      // The sender's faction colour replaces the colour the server wrote.
      return [color ? { ...text, r: color[0], g: color[1], b: color[2] } : text];
    }
    case 'user': {
      const name = nameColor(line.status, line.level), text = line.text.trim();
      if (!line.name || !text) return [];
      // WriteConsoleUserChat strips a "<clan>" suffix from the speaker name.
      const clan = line.name.indexOf('<');
      const shown = clan === 0 ? '' : clan < 0 ? line.name : line.name.slice(0, clan - 1);
      return [segment(`[${shown}] `, rgb(name, true)), segment(text, rgb(line.color))];
    }
  }
}
/** Languages/1.json (Spanish) MENSAJE_* labels the server names in ConsoleFactionMessage. */
const FACTION_LABELS: Record<string, string> = {
  MENSAJE_CONSEJO: '[Consejo Real]', MENSAJE_ARMADA: '[Armada Real]', MENSAJE_CONCILIO: '[Concilio de las Sombras]', MENSAJE_LEGION: '[Legión Oscura]',
};
const factionLabel = (label: string) => FACTION_LABELS[label] ?? '';

export const plainText = (segments: readonly Segment[]) => segments.map(s => s.text).join('');

/** Build the DOM for one console row. Text is always inserted as text, never as HTML. */
export function renderRow(segments: readonly Segment[]): HTMLDivElement {
  const row = document.createElement('div');
  for (const part of segments) {
    const span = document.createElement('span');
    span.textContent = part.text;
    span.style.color = `rgb(${part.r}, ${part.g}, ${part.b})`;
    if (part.bold) span.style.fontWeight = 'bold';
    if (part.italic) span.style.fontStyle = 'italic';
    row.append(span);
  }
  return row;
}

/** One console history entry as a row: raw server lines are formatted now, local notes use their font (0 keeps the console default). */
export function renderMessage(message: { text: string; font: number; line?: ChatLine }, locale: ChatLocale): HTMLDivElement {
  if (message.line) return renderRow(formatLine(message.line, locale));
  if (message.font === 0) { const row = document.createElement('div'); row.textContent = message.text; return row; }
  return renderRow([segment(message.text, fontStyle(message.font))]);
}
