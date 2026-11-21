/*
 * Chat packet state, 2026-11-20, from the classic client Protocol.bas
 * (HandleChatOverHeadImpl, HandleConsoleMessage, HandleRemoveCharDialog,
 * HandleRemoveDialogs) and TileEngine_Chars.bas (Char_Dialog_Set).
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 */
import { NpcsServerPacketId as NS, ServerPacketId as S, vbColor } from '@ao/protocol';
import type { CharacterCreate, ServerPacket } from '@ao/protocol';
import { privilegeLevel } from './chat-fonts.js';
import { readField, vbVal } from './chat-console.js';
import type { ChatLine } from './chat-console.js';
import { ChatLocale, sharedLocale } from './chat-locale.js';

/** A speech bubble over a character (Char_Dialog_Set). Times are in the session clock's milliseconds. */
export interface Dialog {
  text: string;
  color: readonly [number, number, number];
  start: number;
  /** Visible time before the fade starts. */
  life: number;
  /** A later non-spell line is ignored until this much time has passed (RequiredMinDisplayTime). */
  minTime: number;
}
/** HandleCharacterCreate: the wire name is "Name <Clan> {alias}"; `nombre` is what comes before the alias (else before the clan). */
export function characterName(wire: string): string {
  const alias = wire.indexOf('{'), clan = wire.indexOf('<');
  if (alias >= 0) return wire.slice(0, alias).trim();
  return clan < 0 ? wire : wire.slice(0, clan).trim();
}
/** MS_PER_CHAR, engine.bas. Plain speech lives 3 s plus 60 ms per character. */
export const dialogLife = (text: string, isSpell: boolean, maxTime: number) => (isSpell ? (maxTime > 0 ? maxTime : 3500) : 3000 + 60 * text.length);
/** Time the bubble fades after its life ends, before it is removed. */
export const DIALOG_FADE_MS = 500;

export class ChatState {
  locale: ChatLocale = sharedLocale;
  readonly dialogs = new Map<number, Dialog>();
  /** Set by the owner: the characters the session knows, and its clock. */
  characters: (index: number) => CharacterCreate | undefined = () => undefined;
  clock: () => number = () => performance.now();
  /** Config option CopiarDialogoAConsola (Configuracion.ini default 1): copy bubbles to the console. */
  copyToConsole = true;

  constructor(private readonly push: (line: ChatLine) => void) {}

  /** Locale-dependent bubbles that arrived before init/sp_localindex.dat was loaded; replayed by flushPending(). */
  private pending: ServerPacket[] = [];
  /** Replay what waited for the locale tables (the console needs nothing: it keeps raw lines and formats them when drawn). */
  flushPending() {
    if (!this.locale.ready || !this.pending.length) return;
    const waiting = this.pending; this.pending = [];
    for (const packet of waiting) this.receive(packet);
  }
  /** A bubble whose text is built from the locale tables (an id, or an LOCMSG/NPCDESC/PMAG/QUESTFIN prefix). */
  private needsLocale(packet: ServerPacket): boolean {
    if (packet.id === NS.LocaleChatOverHead) return true;
    return packet.id === NS.ChatOverHead && ['LOCMSG', 'NPCDESC', 'PMAG', 'QUESTFIN'].includes(readField(1, packet.chat, '*'));
  }

  /** Returns true when the packet was a chat packet. */
  receive(packet: ServerPacket): boolean {
    // A LocaleMsg-style bubble before the locale file has loaded would be empty: queue it until the locale is ready.
    if (!this.locale.ready && this.needsLocale(packet)) { if (this.pending.length < 200) this.pending.push(packet); return true; }
    if (this.pending.length) this.flushPending();
    switch (packet.id) {
      case S.ConsoleMsg: this.push({ kind: 'console', message: packet.message, font: packet.font }); return true;
      case NS.LocaleMsg: this.push({ kind: 'locale', id: packet.messageId, extra: packet.text, font: packet.font }); return true;
      case S.ConsoleFactionMessage: this.push({ kind: 'faction', message: packet.message, font: packet.font, label: packet.label }); return true;
      case S.GuildChat: this.push({ kind: 'guild', status: packet.status, message: packet.message }); return true;
      case S.ConsoleCharText: {
        const c = vbColor(packet.color);
        this.push({ kind: 'user', name: packet.sourceName, text: packet.message, color: [c.r, c.g, c.b], status: packet.sourceStatus, level: privilegeLevel(packet.privileges) });
        return true;
      }
      case NS.ChatOverHead:
        this.overHead(packet.chat, packet.charIndex, packet.color, packet.isSpell, packet.minChatTime, packet.maxChatTime); return true;
      case NS.LocaleChatOverHead:
        this.overHead(this.locale.message(packet.chatId, packet.params), packet.charIndex, packet.color, packet.isSpell, packet.minChatTime, packet.maxChatTime); return true;
      case NS.RemoveCharDialog: this.dialogs.delete(packet.charIndex); return true;
      case NS.RemoveDialogs: this.dialogs.clear(); return true;
      default: return false;
    }
  }

  /** HandleChatOverHeadImpl: expand the special prefixes, show the bubble, optionally copy it to the console. */
  private overHead(chat: string, charIndex: number, wireColor: number, isSpell: boolean, minTime: number, maxTime: number) {
    const key = readField(1, chat, '*');
    let text = readField(2, chat, '*'), copy = true;
    switch (key) {
      case 'LOCMSG': text = this.locale.message(vbVal(readField(2, chat, '*')), readField(3, chat, '*')); copy = false; break;
      case 'NPCDESC': text = this.locale.npcDescription(vbVal(text)); copy = false; break;
      case 'PMAG': text = this.locale.spell(vbVal(text)).words; copy = false; break;
      case 'QUESTFIN': text = this.locale.questFinalText(vbVal(text)); copy = false; break;
      case 'NOCONSOLA': copy = false; break;
      default: text = chat;
    }
    const c = vbColor(wireColor);
    const character = this.characters(charIndex);
    // "Only add the chat if the character exists": a CharacterRemove may already have arrived.
    if (character) this.setDialog(charIndex, text, [c.r, c.g, c.b], isSpell, minTime, maxTime);
    if (character && !character.npc && this.copyToConsole && copy) {
      // ModUtils.WriteChatOverHeadInConsole hides this one colour; it is the whisper colour with R and B swapped.
      if (c.r === 20 && c.g === 226 && c.b === 157) return;
      this.push({ kind: 'user', name: characterName(character.name), text, color: [c.r, c.g, c.b], status: character.status, level: privilegeLevel(character.privileges) });
    }
  }

  /** Char_Dialog_Set called by the client itself (HandlePelearConPezEspecial); no console copy. */
  showOwnDialog(charIndex: number, text: string, color: readonly [number, number, number]) {
    if (this.characters(charIndex)) this.setDialog(charIndex, text, color, false, 200, 130); // Char_Dialog_Set(.., 200, 130) of HandlePelearConPezEspecial
  }
  /** Char_Dialog_Set. */
  private setDialog(charIndex: number, text: string, color: readonly [number, number, number], isSpell: boolean, minTime: number, maxTime: number) {
    const now = this.clock(), current = this.dialogs.get(charIndex);
    if (!isSpell && current && current.minTime > now - current.start) return;
    this.dialogs.set(charIndex, { text, color, start: now, life: dialogLife(text, isSpell, maxTime), minTime });
  }

  /** Drop bubbles whose fade is over, and return the visible ones with their opacity (0..1). */
  visibleDialogs(): { charIndex: number; dialog: Dialog; opacity: number }[] {
    const now = this.clock(), visible = [];
    for (const [charIndex, dialog] of this.dialogs) {
      const age = now - dialog.start - dialog.life;
      if (age >= DIALOG_FADE_MS) { this.dialogs.delete(charIndex); continue; }
      visible.push({ charIndex, dialog, opacity: age <= 0 ? 1 : 1 - age / DIALOG_FADE_MS });
    }
    return visible;
  }
}
