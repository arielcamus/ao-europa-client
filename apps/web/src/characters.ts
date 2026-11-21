/*
 * Other characters and NPCs: create/remove/move/change, overhead dialogs. Adapted
 * 2026-11-20 from client TileEngine_Chars.bas (MakeChar, Char_Move_by_Pos,
 * Char_Dialog_Set) and Protocol.bas HandleCharacter*. Copyright (C) 2022-2026
 * Noland Studios. AGPL-3.0-or-later; no warranty. See ../../../LICENSE and NOTICE.
 */
import { CharValueType, NpcsServerPacketId as N, QuestServerPacketId as Q, ServerPacketId as S, SessionServerPacketId as SS, Heading } from '@ao/protocol';
import type { CharacterCreate, ServerPacket } from '@ao/protocol';
import { splitName } from './character-data.js';

/** `translate`: a CharacterTranslate glide (TranslationActive): any distance, no walking animation. */
export interface CharMotion { from: { x: number; y: number }; to: { x: number; y: number }; started: number; duration: number; translate?: boolean }
export interface Character {
  charIndex: number; name: string; alias: string; clan: string;
  body: number; head: number; weapon: number; shield: number; helmet: number;
  heading: Heading; x: number; y: number; status: number; privileges: number;
  npc: number; npcNumber: number; speeding: number; idle: boolean; sailing: boolean;
  groupIndex: number; clanIndex: number;
  /** eClanType of the character's guild (CharacterCreate / UpdateTagAndStatus): 0 neutral, 1 real, 2 caos, 3 ciudadana, 4 criminal. */
  clanAlignment: number;
  /** Event team (1..10, 0 none) and its flag (banderaIndex: 1 or 2; CharacterCreate, UpdateFlag). */
  team: number; banderaIndex: number;
  /** UpdateCharValue eDontBlockTile: other characters may walk through this one (VB6 LegalPos). */
  dontBlockTile: boolean;
  /** Quest marker over an NPC (HandleCharacterCreate / HandleUpdateNPCSimbolo): 0 none, else grh 5257 + symbol. */
  symbol: number;
  motion?: CharMotion | undefined;
}
export type NpcDescription = { npcNumber: number; charIndex: number };

/** ScrollPixelsPerFrameX 8.5 px at engineBaseSpeed 0.018 per ms: 32 px take ~209 ms at speed 1. */
export const TILE_MS = 32 / (8.5 * 0.018);
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

/**
 * The split HandleUpdateTagAndStatus does: `Pos = InStr(tag, "<")`, else `[`, else `Len + 2`; name = Left$(tag, Pos - 2), clan = Mid$(tag, Pos).
 * undefined when Pos - 2 is negative (a tag that starts with its bracket: Left$ raises, the handler exits before assigning).
 */
export function splitTag(tag: string): { name: string; clan: string } | undefined {
  let pos = tag.indexOf('<') + 1;
  if (pos === 0) pos = tag.indexOf('[') + 1;
  if (pos === 0) pos = tag.length + 2;
  return pos - 2 >= 0 ? { name: tag.slice(0, pos - 2), clan: tag.slice(pos - 1) } : undefined;
}

export class CharacterTracker {
  readonly chars = new Map<number, Character>();
  /** Fires once per NPCDESC overhead message (the VB6 mostrarCartel NPC dialog window). */
  onNpcDescription: ((description: NpcDescription) => void) | undefined;
  revision = 0;

  clear() { this.chars.clear(); this.revision++; }

  receive(packet: ServerPacket, now: number): void {
    switch (packet.id) {
      case S.CharacterCreate: {
        const parts = splitName(packet.name);
        this.chars.set(packet.charIndex, {
          charIndex: packet.charIndex, ...parts, body: packet.body, head: packet.head,
          weapon: packet.weapon, shield: packet.shield, helmet: packet.helmet,
          heading: packet.heading as Heading, x: packet.x, y: packet.y, status: packet.status,
          privileges: packet.privileges, npc: packet.npc, npcNumber: packet.npcNumber,
          speeding: packet.speeding > 0 ? packet.speeding : 1, idle: (packet.flags & 1) !== 0, sailing: (packet.flags & 2) !== 0,
          groupIndex: packet.groupIndex, clanIndex: packet.clanIndex, symbol: packet.symbol,
          clanAlignment: packet.clanAlignment, team: packet.team, banderaIndex: packet.flag, dontBlockTile: false,
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
      case SS.UpdateTagAndStatus: this.updateTag(packet); break;
      case SS.UpdateFlag: { const char = this.chars.get(packet.charIndex); if (char) { char.banderaIndex = packet.flag; this.revision++; } break; }
      case SS.UpdateCharValue: {
        const char = this.chars.get(packet.charIndex);
        // Only eDontBlockTile is handled by HandleUpdateCharValue; any other value type is read and ignored.
        if (char && packet.valueType === CharValueType.DontBlockTile) { char.dontBlockTile = packet.value !== 0; this.revision++; }
        break;
      }
      case SS.CharacterTranslate: this.translate(packet.charIndex, packet.x, packet.y, packet.time, now); break;
      case Q.UpdateNPCSimbolo: { const char = this.chars.get(packet.charIndex); if (char) { char.symbol = packet.symbol; this.revision++; } break; }
      case S.CharacterMove: this.move(packet.charIndex, packet.x, packet.y, now); break;
      case S.PosUpdateChar:
      case S.PosUpdateUserChar: {
        const char = this.chars.get(packet.charIndex);
        if (char) { char.x = packet.x; char.y = packet.y; char.motion = undefined; }
        break;
      }
      // Overhead speech is drawn once, by ChatBubbles from ChatState (chat #7); here only the NPC description opens the dialog window.
      case N.ChatOverHead: this.describe(packet.chat, packet.charIndex); break;
      case S.ChangeMap: this.clear(); break;
    }
  }

  /**
   * HandleUpdateTagAndStatus: "Name <Clan>" (or "Name [tag]") splits at the first `<`, else `[`; status, group, guild and its alignment
   * change. VB6 assigns clan index and alignment first, so a tag that begins with its bracket (Left$ of a negative length) still keeps those two.
   */
  private updateTag(packet: { charIndex: number; status: number; tag: string; groupIndex: number; clanIndex?: number; clanAlignment?: number }) {
    const char = this.chars.get(packet.charIndex);
    if (!char) return;
    // The pinned server (9ccd7fad) does not send the clan fields; only the HOO-era one does.
    if (packet.clanIndex !== undefined) char.clanIndex = packet.clanIndex;
    if (packet.clanAlignment !== undefined) char.clanAlignment = packet.clanAlignment;
    const parts = splitTag(packet.tag);
    if (parts) { char.name = parts.name; char.clan = parts.clan; char.status = packet.status; char.groupIndex = packet.groupIndex; }
    this.revision++;
  }

  /** TranslateCharacterToPos: the character jumps to the new tile and glides in from the old one over `time` ms; heading and walking animation are untouched. */
  private translate(charIndex: number, x: number, y: number, time: number, now: number) {
    const char = this.chars.get(charIndex);
    if (!char || x < 1 || y < 1 || x > 100 || y > 100 || char.x < 1 || char.y < 1) return;
    const from = { x: char.x, y: char.y };
    char.x = x; char.y = y; char.idle = true;
    char.motion = time > 0 && (from.x !== x || from.y !== y) ? { from, to: { x, y }, started: now, duration: time, translate: true } : undefined;
    this.revision++;
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

  /** HandleChatOverHeadImpl "NPCDESC*<npc number>": the NPC dialog window (mostrarCartel). */
  private describe(raw: string, charIndex: number) {
    const parts = raw.split('*');
    if (parts[0] === 'NPCDESC') this.onNpcDescription?.({ npcNumber: Number(parts[1]), charIndex });
  }

  /** Position to draw: the in-flight slide of a mover, else the tile. */
  visualPosition(char: Character, now: number): { x: number; y: number; moving: boolean; elapsed: number } {
    const motion = char.motion;
    if (!motion) return { x: char.x, y: char.y, moving: false, elapsed: 0 };
    const elapsed = now - motion.started;
    if (elapsed >= motion.duration) { char.motion = undefined; return { x: char.x, y: char.y, moving: false, elapsed: 0 }; }
    const t = Math.max(0, elapsed) / motion.duration;
    return { x: motion.from.x + (motion.to.x - motion.from.x) * t, y: motion.from.y + (motion.to.y - motion.from.y) * t, moving: !motion.translate, elapsed: Math.max(0, elapsed) };
  }

  /** The player's own character is drawn from the session's position, so the session mirrors every step here (the one store for "who stands where"). */
  place(charIndex: number, x: number, y: number, heading?: Heading) {
    const char = this.chars.get(charIndex);
    if (char) { char.x = x; char.y = y; if (heading) char.heading = heading; char.motion = undefined; }
  }

  /** The character whose sprite covers tile x,y; the server also checks y+1 first, mirroring LookatTile. */
  at(x: number, y: number): Character | undefined {
    let found: Character | undefined;
    for (const char of this.chars.values()) if (char.x === x && char.y === y) found = char;
    return found;
  }
}
export type { CharacterCreate };
