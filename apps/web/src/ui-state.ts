// AGPL-3.0-or-later. UI state follows the classic Handle* procedures; see NOTICE.
import { ServerPacketId as S } from '@ao/protocol';
import type { InventorySlot, ServerPacket, SpellSlot, UserStats } from '@ao/protocol';
import { ChatState } from './chat-state.js';
import { formatLine, plainText } from './chat-console.js';
import type { ChatLine } from './chat-console.js';

export class ClassicState {
  revision = 0;
  /** frmMain ChatCombate = 1: the INFO tab of the console is on (the default); no tab switch exists in this client yet. */
  chatCombate = true;
  stats: Partial<UserStats> = {};
  food: { maxWater: number; water: number; maxFood: number; food: number } | undefined;
  inventory = new Map<number, InventorySlot>();
  spells = new Map<number, SpellSlot>();
  unlockedRows = 0;
  /** Console history. `line` is the raw server line; it is formatted when drawn, once locale data is loaded. */
  messages: { text: string; font: number; line?: ChatLine }[] = [];
  readonly chat = new ChatState(line => this.line(line));

  message(text: string, font = 0) {
    this.messages.push({ text, font });
    if (this.messages.length > 200) this.messages.shift();
    this.revision++;
  }
  /** AddtoRichTextBox with explicit RGB (the client's own work prompts). */
  messageRgb(text: string, color: readonly [number, number, number], bold = false, italic = false) {
    this.line({ kind: 'rgb', message: text, color, bold, italic });
  }
  private line(line: ChatLine) {
    const segments = formatLine(line, this.chat.locale);
    this.messages.push({ text: plainText(segments), font: line.kind === 'console' || line.kind === 'locale' ? line.font : 0, line });
    if (this.messages.length > 200) this.messages.shift();
    this.revision++;
  }
  receive(packet: ServerPacket) {
    switch (packet.id) {
      case S.UpdateUserStats: this.stats = { ...packet }; break;
      case S.UpdateHP: this.stats = { ...this.stats, hp: packet.hp, shield: packet.shield }; break;
      case S.UpdateMana: this.stats = { ...this.stats, mana: packet.mana }; break;
      case S.UpdateSta: this.stats = { ...this.stats, stamina: packet.stamina }; break;
      case S.UpdateGold: this.stats = { ...this.stats, gold: packet.gold, goldPerLevel: packet.goldPerLevel }; break;
      case S.UpdateExp: this.stats = { ...this.stats, experience: packet.experience }; break;
      case S.UpdateHungerAndThirst: this.food = packet; break;
      case S.InventoryUnlockSlots: this.unlockedRows = Math.min(3, packet.rows); break;
      case S.ChangeInventorySlot:
        if (packet.slot < 1 || packet.slot > 42) throw new Error('Invalid inventory slot');
        if (packet.object > 0 && packet.amount > 0) this.inventory.set(packet.slot, packet);
        else this.inventory.delete(packet.slot);
        break;
      case S.ChangeSpellSlot:
        if (packet.slot < 1 || packet.slot > 40) throw new Error('Invalid spell slot');
        this.spells.set(packet.slot, packet);
        break;
      default: this.chat.receive(packet); return;
    }
    this.revision++;
  }
}
