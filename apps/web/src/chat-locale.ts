/*
 * Locale and data lookups used by chat text, from the classic client's
 * modLocale.bas (Locale_Parse_ServerMessage) and Recursos.bas (SP_MSG, NPC,
 * HECHIZO, OBJ and QUEST sections of init/sp_localindex.dat).
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 * Game text is read from the user's local resources and never bundled.
 */
import { parseIni } from './assets.js';
import type { Ini } from './assets.js';
import { lookAtFields } from './look-at.js';

/** Server messages use U+00AC (the "not" sign, 0xAC in windows-1252) to separate parameters. */
const SEPARATOR = '¬';

export interface SpellText { name: string; desc: string; ownMessage: string; casterMessage: string; targetMessage: string; words: string }

export class ChatLocale {
  private messages = new Map<number, string>();
  private data: Ini = new Map();
  /** True once the message table is loaded; text built before that is rebuilt on render. */
  ready = false;

  /** `index` is init/sp_localindex.dat (messages and data); `messages` is init/SP_LocalMsg.dat, which has the same [SP_MSG] section. */
  load(index: string, messages?: string) {
    this.data = parseIni(index);
    const tables = [messages === undefined ? undefined : parseIni(messages), this.data];
    for (const table of tables) {
      for (const [key, value] of table?.get('sp_msg') ?? []) {
        const id = /^msg(\d+)$/.exec(key);
        if (id && !this.messages.has(Number(id[1]))) this.messages.set(Number(id[1]), value);
      }
    }
    this.ready = this.messages.size > 0;
  }

  /** Locale_Parse_ServerMessage: fill ¬1, ¬2 ... from the ¬-separated extra. Id 2266 carries the text itself. */
  message(id: number, extra = ''): string {
    if (id === 2266) return extra;
    const template = this.messages.get(id) ?? '';
    if (!extra) return template;
    // Look-at replies (1105 user, 1621/1622 NPC) rewrite their packed fields first, like the VB6 client.
    const fields = lookAtFields(id, extra.split(SEPARATOR), npcNumber => this.npcName(npcNumber) || undefined);
    let text = template;
    // Reverse order so ¬1 never eats the start of ¬10.
    for (let i = fields.length - 1; i >= 0; i--) text = text.split(`${SEPARATOR}${i + 1}`).join(fields[i]!);
    return text;
  }
  private value(section: string, key: string) { return this.data.get(section)?.get(key) ?? ''; }
  npcName(id: number) { return this.value(`npc${id}`, 'name'); }
  npcDescription(id: number) { return this.value(`npc${id}`, 'desc'); }
  objectName(id: number) { return this.value(`obj${id}`, 'name'); }
  questFinalText(id: number) { return this.value(`quest${id}`, 'descfinal'); }
  spell(id: number): SpellText {
    const get = (key: string) => this.value(`hechizo${id}`, key);
    return {
      name: get('nombre'), desc: get('desc'), ownMessage: get('propiomsg'),
      casterMessage: get('hechizeromsg'), targetMessage: get('targetmsg'), words: get('palabrasmagicas'),
    };
  }
}

/** One table for the whole page: the data does not depend on the connection. */
export const sharedLocale = new ChatLocale();
