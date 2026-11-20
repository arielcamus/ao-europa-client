/*
 * Other characters and NPCs: create/remove/move/change, overhead dialogs. Adapted
 * 2026-11-20 from client TileEngine_Chars.bas (MakeChar, Char_Move_by_Pos,
 * Char_Dialog_Set) and Protocol.bas HandleCharacter*. Copyright (C) 2022-2026
 * Noland Studios. AGPL-3.0-or-later; no warranty. See ../../../LICENSE and NOTICE.
 */
import { NpcsServerPacketId as N, ServerPacketId as S, Heading } from '@ao/protocol';
import type { CharacterCreate, ServerPacket } from '@ao/protocol';
import { splitName } from './character-data.js';
import type { LocaleData } from './character-data.js';
import { localeText } from './look-at.js';

export interface CharMotion { from: { x: number; y: number }; to: { x: number; y: number }; started: number; duration: number }
export interface CharDialog { text: string; color: number; started: number; lifeMs: number }
export interface Character {
  charIndex: number; name: string; alias: string; clan: string;
  body: number; head: number; weapon: number; shield: number; helmet: number;
  heading: Heading; x: number; y: number; status: number; privileges: number;
  npc: number; npcNumber: number; speeding: number; idle: boolean; sailing: boolean;
  groupIndex: number; clanIndex: number;
  motion?: CharMotion | undefined; dialog?: CharDialog | undefined;
}
export type NpcDescription = { npcNumber: number; charIndex: number };

/** ScrollPixelsPerFrameX 8.5 px at engineBaseSpeed 0.018 per ms: 32 px take ~209 ms at speed 1. */
export const TILE_MS = 32 / (8.5 * 0.018);
const MS_PER_CHAR = 60;
const headingOf = (dx: number, dy: number): Heading | undefined =>
  dy > 0 ? Heading.South : dy < 0 ? Heading.North : dx > 0 ? Heading.East : dx < 0 ? Heading.West : undefined;
/** vbColor_2_Long: VB colours are 0x00BBGGRR. */
export const vbColor = (value: number) => ({ r: value & 255, g: (value >> 8) & 255, b: (value >> 16) & 255 });

type ChangePacket = { body: number; head: number; heading: number; weapon: number; shield: number; helmet: number };
/**
 * HandleCharacterChange, the ONE appearance rule for every character, self included (death: ghost body 829; revival; equipping).
 * VB6 ignores weapon/shield/helmet 0 on change ("TempInt <> 0") and keeps the previous set. Used by the tracker (what the
 * renderer draws) and by Session for its own character copy, so both always agree.
 */
export function characterChange<T extends ChangePacket>(previous: T, packet: ChangePacket): Pick<T, keyof ChangePacket> {
  return {
    body: packet.body, head: packet.head,
    heading: (packet.heading >= 1 && packet.heading <= 4 ? packet.heading : previous.heading) as T['heading'],
    weapon: (packet.weapon !== 0 ? packet.weapon : previous.weapon) as T['weapon'],
    shield: (packet.shield !== 0 ? packet.shield : previous.shield) as T['shield'],
    helmet: (packet.helmet !== 0 ? packet.helmet : previous.helmet) as T['helmet'],
  } as Pick<T, keyof ChangePacket>;
}

export class CharacterTracker {
  readonly chars = new Map<number, Character>();
  /** Fires once per NPCDESC overhead message (the VB6 mostrarCartel NPC dialog window). */
  onNpcDescription: ((description: NpcDescription) => void) | undefined;
  locale: LocaleData | undefined;
  revision = 0;

  clear() { this.chars.clear(); this.revision++; }

  receive(packet: ServerPacket, now: number): void {
    switch (packet.id) {
      case S.CharacterCreate: {
        const parts = splitName(packet.name);
        const previous = this.chars.get(packet.charIndex);
        this.chars.set(packet.charIndex, {
          charIndex: packet.charIndex, ...parts, body: packet.body, head: packet.head,
          weapon: packet.weapon, shield: packet.shield, helmet: packet.helmet,
          heading: packet.heading as Heading, x: packet.x, y: packet.y, status: packet.status,
          privileges: packet.privileges, npc: packet.npc, npcNumber: packet.npcNumber,
          speeding: packet.speeding > 0 ? packet.speeding : 1, idle: (packet.flags & 1) !== 0, sailing: (packet.flags & 2) !== 0,
          groupIndex: packet.groupIndex, clanIndex: packet.clanIndex,
          // A re-create (area change) keeps a pending dialog, nothing else.
          ...(previous?.dialog ? { dialog: previous.dialog } : {}),
        });
        this.revision++;
        break;
      }
      case N.CharacterRemove:
        if (this.chars.delete(packet.charIndex)) this.revision++;
        break;
      case N.CharacterChange: {
        const char = this.chars.get(packet.charIndex);
        if (!char) break;
        Object.assign(char, characterChange(char, packet), { idle: (packet.flags & 1) !== 0, sailing: (packet.flags & 2) !== 0 });
        this.revision++;
        break;
      }
      case S.CharacterMove: this.move(packet.charIndex, packet.x, packet.y, now); break;
      case S.PosUpdateChar:
      case S.PosUpdateUserChar: {
        const char = this.chars.get(packet.charIndex);
        if (char) { char.x = packet.x; char.y = packet.y; char.motion = undefined; }
        break;
      }
      case N.ChatOverHead: this.say(packet.chat, packet.charIndex, packet.color, packet.isSpell, now); break;
      case N.LocaleChatOverHead:
        this.say(this.locale ? localeText(packet.chatId, packet.params, this.locale) : packet.params, packet.charIndex, packet.color, packet.isSpell, now);
        break;
      case N.RemoveCharDialog: { const char = this.chars.get(packet.charIndex); if (char) char.dialog = undefined; break; }
      case N.RemoveDialogs: for (const char of this.chars.values()) char.dialog = undefined; break;
      case S.ChangeMap: this.clear(); break;
    }
  }

  /** Char_Move_by_Pos: heading from the delta, then slide one tile (teleports snap). */
  private move(charIndex: number, x: number, y: number, now: number) {
    const char = this.chars.get(charIndex);
    if (!char) return;
    const dx = x - char.x, dy = y - char.y;
    const heading = headingOf(dx, dy);
    if (!heading) return;
    const from = { x: char.x, y: char.y }; // VB6 restarts the offset from the previous tile
    char.heading = heading; char.idle = false;
    char.x = x; char.y = y;
    char.motion = Math.abs(dx) + Math.abs(dy) > 2 ? undefined
      : { from, to: { x, y }, started: now, duration: TILE_MS / char.speeding };
  }

  private say(raw: string, charIndex: number, color: number, isSpell: boolean, now: number) {
    const kind = raw.split('*')[0];
    let text = raw;
    if (kind === 'NPCDESC') {
      const npcNumber = Number(raw.split('*')[1]);
      text = this.locale?.npcs.get(npcNumber)?.desc ?? '';
      this.onNpcDescription?.({ npcNumber, charIndex });
    } else if (kind === 'LOCMSG') {
      const parts = raw.split('*');
      text = this.locale ? localeText(Number(parts[1]), parts.slice(2).join('*'), this.locale) : '';
    } else if (kind === 'NOCONSOLA') text = raw.split('*')[1] ?? '';
    else if (kind === 'PMAG') return; // spell words need Hechizos.dat; owned by the spells feature
    const char = this.chars.get(charIndex);
    if (!char || !text) return;
    char.dialog = { text, color, started: now, lifeMs: isSpell ? 3500 : 3000 + MS_PER_CHAR * text.length };
    this.revision++;
  }

  /** Position to draw: the in-flight slide of a mover, else the tile. */
  visualPosition(char: Character, now: number): { x: number; y: number; moving: boolean; elapsed: number } {
    const motion = char.motion;
    if (!motion) return { x: char.x, y: char.y, moving: false, elapsed: 0 };
    const elapsed = now - motion.started;
    if (elapsed >= motion.duration) { char.motion = undefined; return { x: char.x, y: char.y, moving: false, elapsed: 0 }; }
    const t = Math.max(0, elapsed) / motion.duration;
    return { x: motion.from.x + (motion.to.x - motion.from.x) * t, y: motion.from.y + (motion.to.y - motion.from.y) * t, moving: true, elapsed: Math.max(0, elapsed) };
  }

  /** Drop dialogs past their lifetime (Char_Dialog_Remove). */
  expireDialogs(now: number) {
    for (const char of this.chars.values()) if (char.dialog && now - char.dialog.started > char.dialog.lifeMs) char.dialog = undefined;
  }

  /** The character whose sprite covers tile x,y; the server also checks y+1 first, mirroring LookatTile. */
  at(x: number, y: number): Character | undefined {
    let found: Character | undefined;
    for (const char of this.chars.values()) if (char.x === x && char.y === y) found = char;
    return found;
  }
}
export type { CharacterCreate };
