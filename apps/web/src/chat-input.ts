/*
 * Chat input rules, 2026-11-20, from the classic client ModGameplayUI.bas
 * (HandleChatMsg), ProtocolCmdParse.bas (ParseUserCommand, chat commands only),
 * frmMain.frm (CompletarEnvioMensajes, SendTxt_Change/KeyPress).
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 * GM and gameplay slash commands belong to other features: they get an explicit "not available" line.
 */
import { PetsTravelClientPacketId as PT, CombatClientPacketId as CC, ClientPacketId as C, BankTradeClientPacketId as BC, KeysClientPacketId as K, SkillsClientPacketId as SC } from '@ao/protocol';
import type { ClientPacket } from '@ao/protocol';
import { FONTTYPE } from './chat-fonts.js';
import { parseGmCommand } from './gm-commands.js';
import type { GmWindow } from './gm-commands.js';

/** frmMain SendingType: what the next opened input box starts with. */
export enum SendingType { Talk = 1, Yell = 2, Whisper = 3, Guild = 4, Group = 5, GroupAlt = 6, Server = 8, Faction = 9 }
/** frmMain.SendTxt MaxLength. */
export const CHAT_MAX_LENGTH = 160;

export interface ChatOutcome {
  /** Say text goes through the paced `Session.talk`; every other packet is sent as is. */
  talk?: string;
  packet?: ClientPacket;
  /** Packets after `packet` (/PANELGM writes two). */
  more?: ClientPacket[];
  /** A client-side form the command opens (/GM, /CO). */
  open?: GmWindow;
  /** A local console line instead of (or before) sending, with its FontTypeNames index. */
  notes: { text: string; font: number }[];
}
export interface ChatContext {
  /** UserStats.Lvl, when known. */
  level?: number | undefined;
  /** UserStats.estado = 1. */
  dead?: boolean;
  /** Comerciando: a shop, the vault or a trade window holds the player. */
  trading?: boolean;
  /** UserStats.minman = maxman: /MEDITAR refuses with the full-mana line. */
  manaFull?: boolean;
  /** EsGM: HandlePrivilegios said this character is a GM. */
  isGM?: boolean;
}

/** SendTxt_Change: keep only characters the VB6 box accepts (space..250). */
export const filterChatText = (text: string) => [...text].filter(ch => { const c = ch.codePointAt(0)!; return c >= 32 && c <= 250; }).join('').slice(0, CHAT_MAX_LENGTH);

const readCommand = (raw: string) => {
  const cut = raw.indexOf(' ');
  const word = (cut < 0 ? raw : raw.slice(0, cut)).trim().toUpperCase();
  return { command: word === '' ? ' ' : word, hasArguments: cut >= 0, raw: cut < 0 ? '' : raw.slice(cut + 1) };
};
/** ParseUserCommand pet commands (both languages) and the empty packet each writes. */
const PET_COMMANDS: Readonly<Record<string, number>> = {
  '/QUIETO': PT.PetStand, '/STILL': PT.PetStand, '/ACOMPAÑAR': PT.PetFollow, '/ACCOMPANY': PT.PetFollow,
  '/ACOMPAÑARTODOS': PT.PetFollowAll, '/ACCOMPANYALL': PT.PetFollowAll, '/LIBERAR': PT.PetLeave, '/RELEASE': PT.PetLeave,
  '/LIBERARTODOS': PT.PetLeaveAll, '/LIBERARTODAS': PT.PetLeaveAll, '/LIBERARTALL': PT.PetLeaveAll,
};
const MESSAGES = {
  empty: 'Escriba un mensaje.',
  dead: '¡¡Estás muerto!!',
  deadGlobal: '¡¡Estás muerto!! No puedes comunicarte con el mundo de los vivos.',
  level: '¡¡Debes ser nivel 5 o superior para usar el global!!!',
  unsupported: 'Ese comando aún no está disponible.',
  alreadyTrading: 'Ya estás comerciando',
  withdrawAmount: 'Ingrese la cantidad que desea retirar',
  badDepositAmount: 'Cantidad incorrecta. Utilice /depositar CANTIDAD.',
  missingParameters: 'Faltan parámetros. Utilice /depositar CANTIDAD.',
  fullMana: '¡Tu maná está completo!',
};

/** Holds what the VB6 client keeps between messages: SendingType and sndPrivateTo. The guild counter is the session's (PacketCounters). */
export class ChatInput {
  sendingType = SendingType.Talk;
  whisperTarget = '';

  /** CompletarEnvioMensajes: the text an opened box starts with. */
  prefill(): string {
    switch (this.sendingType) {
      case SendingType.Yell: return '-';
      case SendingType.Whisper: return `\\${this.whisperTarget} `;
      case SendingType.Group: return '/GRUPO ';
      case SendingType.GroupAlt: return '/GRMG ';
      case SendingType.Server: return '/RMSG ';
      case SendingType.Faction: return '/FMSG ';
      default: return '';
    }
  }
  /** RecTxt_MouseUp: clicking a "[Name]" line starts a whisper to that name. */
  whisperTo(name: string) { this.whisperTarget = name.replaceAll(' ', '+'); this.sendingType = SendingType.Whisper; }

  /** SendTxtCmsg_KeyUp: the guild box calls ParseUserCommand directly, so SendingType is left alone. */
  guildMessage(text: string): ChatOutcome {
    const outcome: ChatOutcome = { notes: [] };
    if (text !== '') this.command(`/CMSG ${text}`, {}, outcome);
    return outcome;
  }

  /** HandleChatMsg. */
  submit(input: string, context: ChatContext = {}): ChatOutcome {
    const outcome: ChatOutcome = { notes: [] };
    if (input === '') { this.sendingType = SendingType.Talk; this.whisperTarget = ''; return outcome; }
    const first = input[0];
    if (first === '/') {
      const upper = input.toUpperCase();
      this.sendingType = upper.startsWith('/GRUPO ') ? SendingType.Group : upper.startsWith('/CMSG ') ? SendingType.Guild
        : upper.startsWith('/GRMG ') ? SendingType.GroupAlt : upper.startsWith('/RMSG ') ? SendingType.Server : SendingType.Talk;
      this.command(input, context, outcome);
    } else if (first === '-') {
      if (input.length > 1) this.command(input, context, outcome);
      this.sendingType = SendingType.Yell;
    } else if (first === '\\') {
      const rest = input.slice(1), cut = rest.indexOf(' ');
      const name = cut < 0 ? rest : rest.slice(0, cut);
      this.whisperTarget = name; this.sendingType = SendingType.Whisper;
      // VB6 raises on "\name" with no text; there is nothing to send either way.
      if (rest !== '' && cut >= 0 && rest.slice(cut + 1) !== '') outcome.packet = { id: C.Whisper, name, message: rest.slice(cut + 1) };
    } else {
      this.command(input, context, outcome);
      this.sendingType = SendingType.Talk; this.whisperTarget = '';
    }
    return outcome;
  }

  /** The chat part of ParseUserCommand. */
  private command(raw: string, context: ChatContext, outcome: ChatOutcome) {
    const { command, hasArguments, raw: args } = readCommand(raw);
    const note = (text: string, font: number = FONTTYPE.TALK) => outcome.notes.push({ text, font });
    if (command.startsWith('/')) {
      const filled = args.trim() !== '';
      switch (command) {
        case '/CMSG':
          if (hasArguments) outcome.packet = { id: C.GuildMessage, message: args, counter: 0 }; // Session.sendChat fills the shared counter
          else note(MESSAGES.empty);
          return;
        case '/GRUPO': case '/CLUSTER':
          if (hasArguments) outcome.packet = { id: C.GroupMessage, message: args }; else note(MESSAGES.empty);
          return;
        case '/ONLINECLAN': outcome.packet = { id: C.GuildOnline }; return;
        // Combat (#11): act on the priest selected with a left click (WriteResucitate / WriteHeal, no fields).
        case '/RESUCITAR': case '/RESURRECT': outcome.packet = { id: CC.Resucitate }; return;
        case '/CURAR': case '/CURE': outcome.packet = { id: CC.Heal }; return;
        // Pets (wp05): ParseUserCommand /QUIETO /ACOMPAÑAR /ACOMPAÑARTODOS /LIBERAR /LIBERARTODOS act on the pet selected with a left click.
        case '/QUIETO': case '/STILL': case '/ACOMPAÑAR': case '/ACCOMPANY': case '/ACOMPAÑARTODOS': case '/ACCOMPANYALL':
        case '/LIBERAR': case '/RELEASE': case '/LIBERARTODOS': case '/LIBERARTODAS': case '/LIBERARTALL':
          if (context.dead) note(MESSAGES.dead, FONTTYPE.INFO); else outcome.packet = { id: PET_COMMANDS[command]! };
          return;
        // Skills (feat/skills): ParseUserCommand /ENTRENAR, /DESCANSAR, /MEDITAR, /EST.
        case '/ENTRENAR': case '/TRAIN': if (context.dead) note(MESSAGES.dead, FONTTYPE.INFO); else outcome.packet = { id: SC.TrainList }; return;
        case '/DESCANSAR': case '/REST': if (context.dead) note(MESSAGES.dead, FONTTYPE.INFO); else outcome.packet = { id: SC.Rest }; return;
        case '/MEDITAR': case '/MEDITATE':
          if (context.manaFull) note(MESSAGES.fullMana, 4); // FONTTYPE_INFOBOLD
          else if (context.dead) note(MESSAGES.dead, FONTTYPE.INFO);
          else outcome.packet = { id: K.Meditate };
          return;
        case '/EST': outcome.packet = { id: SC.RequestStats }; return;
        case '/BMSG':
          if (filled) outcome.packet = { id: C.CouncilMessage, message: args }; else note(MESSAGES.empty);
          return;
        case '/FMSG':
          if (filled) outcome.packet = { id: C.FactionMessage, message: args }; else note(MESSAGES.empty);
          return;
        case '/GLOBAL':
          if (context.dead) note(MESSAGES.deadGlobal, FONTTYPE.INFO);
          else if (context.level !== undefined && context.level < 5) note(MESSAGES.level, FONTTYPE.GLOBAL);
          else if (hasArguments) outcome.packet = { id: C.GlobalMessage, message: args.replaceAll('~', '') };
          else note(MESSAGES.empty);
          return;
        // Bank and trade (feat/bank-trade): ProtocolCmdParse.bas /BALANCE, /COMERCIAR, /BOVEDA, /RETIRAR n, /DEPOSITAR n.
        case '/BALANCE':
          if (context.dead) note(MESSAGES.dead, FONTTYPE.INFO); else outcome.packet = { id: BC.RequestAccountState };
          return;
        case '/COMERCIAR': case '/TRADE':
          if (context.dead) note(MESSAGES.dead, FONTTYPE.INFO);
          else if (context.trading) note(MESSAGES.alreadyTrading, FONTTYPE.INFO);
          else outcome.packet = { id: BC.CommerceStart };
          return;
        case '/BOVEDA': case '/VAULT':
          if (context.dead) note(MESSAGES.dead, FONTTYPE.INFO); else outcome.packet = { id: BC.BankStart };
          return;
        case '/RETIRAR': case '/WITHDRAW':
          if (context.dead) note(MESSAGES.dead, FONTTYPE.INFO);
          else if (!filled) note(MESSAGES.withdrawAmount);
          else if (/^\d{1,10}$/.test(args.trim()) && Number(args.trim()) <= 2147483647) outcome.packet = { id: BC.BankExtractGold, amount: Number(args.trim()) };
          else note(MESSAGES.badDepositAmount.replace('depositar', 'retirar'));
          return;
        case '/DEPOSITAR': case '/DEPOSIT':
          if (context.dead) note(MESSAGES.dead, FONTTYPE.INFO);
          else if (!filled) note(MESSAGES.missingParameters);
          else if (/^\d{1,10}$/.test(args.trim()) && Number(args.trim()) <= 2147483647) outcome.packet = { id: BC.BankDepositGold, amount: Number(args.trim()) };
          else note(MESSAGES.badDepositAmount);
          return;
        default: {
          // GM / admin commands (wp12): ProtocolCmdParse's GM half, in gm-commands.ts.
          const all = hasArguments ? args.split(' ') : [];
          const gm = parseGmCommand(command, { raw: args, all, count: all.length, filled }, { isGM: context.isGM === true });
          if (!gm) { note(MESSAGES.unsupported, FONTTYPE.INFO); return; }
          if (gm.packets[0]) outcome.packet = gm.packets[0];
          if (gm.packets.length > 1) outcome.more = gm.packets.slice(1);
          if (gm.open) outcome.open = gm.open;
          for (const text of gm.notes) outcome.notes.push(text);
          return;
        }
      }
    }
    if (command.startsWith('-')) {
      if (context.dead) note(MESSAGES.dead, FONTTYPE.INFO);
      else outcome.packet = { id: C.Yell, message: raw.slice(1) };
      return;
    }
    outcome.talk = raw;
  }
}
