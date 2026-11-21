/*
 * Slash commands of the events, duels, auction, faction and anti-macro features (the part of the classic ParseUserCommand that
 * writes the packets of packets/extras.ts), 2026-11-21, from ProtocolCmdParse.bas. No DOM and no session: `parseExtrasCommand`
 * returns the packets, console lines and windows the VB6 parser would produce, so it is tested without a socket.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 *
 * Faithful quirks: messages are the Spanish Languages/1.json texts, some of them reused with the wrong usage line (CantidadIncorrecta
 * shows the /OFERTAINICIAL hint for /APOSTAR too); GM-only commands do nothing for a player (/CE is behind EsGM, the others are checked
 * by the server); /RETIRARFACCION with arguments does nothing.
 */
import { ExtrasClientPacketId as X } from '@ao/protocol';
import type { ClientPacket } from '@ao/protocol';
import { FONTTYPE } from './chat-fonts.js';
import { validNumber, vbVal } from './gm-commands.js';

export type ExtrasWindow = 'duel' | 'tournament';
export interface ExtrasOutcome {
  packets: ClientPacket[];
  notes: { text: string; font: number }[];
  /** A client-side form the command opens. `names` pre-fills frmRetos.Jugador. */
  open?: { window: ExtrasWindow; names?: string[] };
}
export interface ExtrasContext { dead: boolean; isGM: boolean }

export const EXTRAS_TEXT = {
  dead: '¡¡Estás muerto!!',
  missing: 'Faltan parámetros',
  badAmount: 'Cantidad incorrecta. Utilice /OFERTAINICIAL CANTIDAD.',
  descLong: 'Tu descripción no puede ser tan larga (Max. 50 caracteres).',
  descDash: 'No se permiten guiones en la descripción.',
  invalidEvent: 'Invalid event type.',
  badValue: 'Valor incorrecto. Utilice /telep NICKNAME MAPA X Y.',
  badLobby: 'Parámetro inválido. Utilice /CONFIGLOBBY SETPRICE/SPAWN/MAXLVL/MINLVL/CLASS/SUMPLAYER/SUMALL/RETURNPLAYER/RETALL/OPEN/START/END/LIST/KICK/FORCERESET/SETTEAMSIZE/ADDPLAYER',
  badParams: 'Parámetros incorrectos.',
  castle: 'Uso: /CASTLE ADD <personaje> o /CASTLE REMOVE <personaje>',
  badFormat: 'Formato incorrecto. Utilice /SILENCIAR NICKNAME@MOTIVO.',
  eventUsage: (kind: string) => `Valor incorrecto. Utilice /CREAREVENTO ${kind} PARTICIPANTES NIVEL_MINIMO NIVEL_MAXIMO.`,
} as const;

/** e_LobbyCommandId (ProtocolCmdParse.bas), in declaration order. */
export const LobbyCommandId = {
  SetSpawnPos: 0, SetMaxLevel: 1, SetMinLevel: 2, SetClassLimit: 3, RegisterPlayer: 4, SummonSinglePlayer: 5, SummonAll: 6, ReturnSinglePlayer: 7,
  ReturnAllSummoned: 8, OpenLobby: 9, StartEvent: 10, EndEvent: 11, CancelEvent: 12, ListPlayers: 13, KickPlayer: 14, ForceReset: 15, SetTeamSize: 16,
  AddPlayer: 17, SetInscriptionPrice: 18,
} as const;
/** ConfigLobbyClass: class words (both languages) to the 1-based class number. */
const CLASS_LIMIT: Readonly<Record<string, number>> = {
  MAGE: 1, MAGO: 1, CLERIC: 2, CLERIGO: 2, WARRIOR: 3, GUERRERO: 3, ASSASIN: 4, ASESINO: 4, BARD: 5, BARDO: 5, DRUID: 6, DRUIDA: 6,
  PALADIN: 7, HUNTER: 8, CAZADOR: 8, WORKER: 9, TRABAJADOR: 9, PIRATE: 10, PIRATA: 10, THIEF: 11, LADRON: 11, BANDIT: 12, BANDIDO: 12,
};
const SCENARIO = { CAPTURA: 1, CACERIA: 2, DEATHMATCH: 3, NAVALCONQUEST: 4 } as const;
export const MAX_DUEL_PLAYERS_PER_TEAM = 5;

const num = (text: string) => Math.round(vbVal(text));
const split = (text: string, separator: string, limit = Infinity): string[] => {
  const parts = text.split(separator);
  return parts.length <= limit ? parts : [...parts.slice(0, limit - 1), parts.slice(limit - 1).join(separator)];
};

/** WriteStartLobby: the lobby settings of t_NewScenearioSettings. */
export interface LobbySettings {
  scenarioType: number; minLevel: number; maxLevel: number; minPlayers: number; maxPlayers: number; teamSize: number; teamType: number;
  roundNumber: number; inscriptionFee: number;
}
export const lobbyPacket = (settings: Partial<LobbySettings>, description = '', password = ''): ClientPacket => ({
  id: X.StartEvent, eventType: 0, scenarioType: 0, minLevel: 0, maxLevel: 0, minPlayers: 0, maxPlayers: 0, teamSize: 0, teamType: 0,
  roundNumber: 0, inscriptionFee: 0, description, password, ...settings,
}) as unknown as ClientPacket;

/** Returns undefined when `command` (upper case, with the slash) is not one of these. */
export function parseExtrasCommand(command: string, raw: string, context: ExtrasContext): ExtrasOutcome | undefined {
  const out: ExtrasOutcome = { packets: [], notes: [] };
  const note = (text: string, font: number = FONTTYPE.TALK) => { out.notes.push({ text, font }); return out; };
  const send = (packet: Record<string, unknown>) => { out.packets.push(packet as unknown as ClientPacket); return out; };
  const filled = raw.trim() !== '';
  const all = filled ? raw.split(' ') : [];
  const dead = () => note(EXTRAS_TEXT.dead, FONTTYPE.INFO);

  switch (command) {
    case '/EVENTOFACCIONARIO': case '/FACCIONARYEVENT': return send({ id: X.EventoFaccionario });
    case '/SUBASTA': case '/AUCTION': return send({ id: X.SubastaInfo });
    case '/EVENTO': case '/EVENT': return send({ id: X.EventoInfo });
    case '/OFERTAINICIAL': case '/INITIALOFFER':
      if (!filled) return note(EXTRAS_TEXT.missing);
      return validNumber(raw, 'long') && vbVal(raw) > 0 ? send({ id: X.OfertaInicial, offer: num(raw) }) : note(EXTRAS_TEXT.badAmount);
    case '/DESC':
      if (context.dead) return dead();
      if (raw.length > 50) return note(EXTRAS_TEXT.descLong, 29);
      if (raw.includes('-')) return note(EXTRAS_TEXT.descDash, 29);
      return send({ id: X.ChangeDescription, description: raw });
    case '/APOSTAR': case '/BET':
      if (context.dead) return dead();
      if (!filled) return note(EXTRAS_TEXT.missing);
      return validNumber(raw, 'integer') ? send({ id: X.Gamble, amount: num(raw) }) : note(EXTRAS_TEXT.badAmount);
    case '/ARENA': return context.dead ? dead() : send({ id: X.MapPriceEntrance });
    case '/RETIRARFACCION': case '/REMOVEFACTION':
      if (context.dead) return dead();
      return all.length === 0 ? send({ id: X.LeaveFaction }) : out;
    case '/FINALIZAREVENTO': case '/ENDEVENT': return send({ id: X.FinEvento });
    case '/CANCELAREVENTO': case '/CANCELEVENT': return send({ id: X.CancelarEvento });
    case '/PROPONER': case '/PROPOSE': return filled ? send({ id: X.Casarse, userName: raw }) : note(EXTRAS_TEXT.missing);
    case '/CR': return filled ? send({ id: X.CuentaRegresiva, seconds: num(raw) & 255 }) : note(EXTRAS_TEXT.missing);
    case '/PARTICIPAR': case '/PARTICIPATE':
      // -1 is "the open lobby of this map": the Int16 of WriteParticipar.
      if (all.length < 1) return send({ id: X.Participar, roomId: -1, password: '' });
      return send({ id: X.Participar, roomId: num(all[0]!), password: all.length < 2 ? '' : all[1]! });
    case '/RETAR': case '/RETO': case '/CHALLENGE':
      out.open = { window: 'duel', ...(filled ? { names: split(raw, '@', 9) } : {}) };
      return out;
    case '/ACEPTAR': case '/ACCEPT': return filled ? send({ id: X.AcceptDuel, offerer: raw }) : note(EXTRAS_TEXT.missing);
    case '/CANCELAR': case '/CANCEL': return send({ id: X.CancelDuel });
    case '/ABANDONAR': case '/ABANDON': return send({ id: X.QuitDuel });
    case '/CE': return context.isGM ? send({ id: X.CreateEvent, eventName: raw }) : out;
    case '/MENSAJEANTIMACRO': case '/ANTIMACROMESSAGE': {
      if (!filled) return note(EXTRAS_TEXT.missing);
      const parts = split(raw, '@', 2);
      return parts.length === 2 ? send({ id: X.AntiMacroMessage, userName: parts[0], message: parts[1] }) : note(EXTRAS_TEXT.badFormat);
    }
    case '/CASTLE': {
      const parts = split(raw, ' ', 2), action = (parts[0] ?? '').trim().toUpperCase(), name = (parts[1] ?? '').trim();
      return (action === 'ADD' || action === 'REMOVE') && name !== '' ? send({ id: X.ModifyCastleWhiteList, command: `${action} ${name}` }) : note(EXTRAS_TEXT.castle);
    }
    case '/FEATURETOGGLE': {
      if (!context.isGM) return out;
      if (all.length < 2 || !validNumber(all[1]!, 'byte')) return note(EXTRAS_TEXT.badParams);
      return send({ id: X.FeatureToggle, value: num(all[1]!), name: all[0] });
    }
    case '/CREAREVENTO': case '/CREATEVENT': return createEvent(all, out, note);
    case '/CONFIGLOBBY': return configLobby(all, out, note);
    default: return undefined;
  }
}

type Note = (text: string, font?: number) => ExtrasOutcome;
function createEvent(args: string[], out: ExtrasOutcome, note: Note): ExtrasOutcome {
  if (args.length === 0) return note(EXTRAS_TEXT.missing);
  const kind = args[0]!.trim().toUpperCase(), numeric = (i: number) => args[i] !== undefined && validNumber(args[i]!, 'long');
  const push = (settings: Partial<LobbySettings>) => { out.packets.push(lobbyPacket(settings)); return out; };
  if (kind === 'CAPTURA') {
    if (args.length < 6 || ![1, 2, 3, 4, 5].every(numeric)) return note(EXTRAS_TEXT.badValue);
    return push({ scenarioType: SCENARIO.CAPTURA, maxPlayers: num(args[1]!), roundNumber: num(args[2]!), minLevel: num(args[3]!), maxLevel: num(args[4]!), inscriptionFee: num(args[5]!) });
  }
  if (kind === 'LOBBY') {
    if (args.length < 3 || ![1, 2, 3].every(numeric)) return note(EXTRAS_TEXT.badValue);
    return push({ scenarioType: 0, maxPlayers: num(args[1]!), minLevel: num(args[2]!), maxLevel: num(args[3]!) });
  }
  const custom = SCENARIO[kind as keyof typeof SCENARIO];
  if (kind === 'CACERIA' || kind === 'DEATHMATCH' || kind === 'NAVALCONQUEST') {
    if (args.length < 3 || ![1, 2, 3].every(numeric)) return note(EXTRAS_TEXT.eventUsage(kind));
    return push({
      scenarioType: custom, maxPlayers: num(args[1]!), minLevel: num(args[2]!), maxLevel: num(args[3]!),
      inscriptionFee: args.length >= 5 && numeric(4) ? num(args[4]!) : 0, teamSize: args.length >= 6 && numeric(5) ? num(args[5]!) : 1,
    });
  }
  return note(EXTRAS_TEXT.invalidEvent);
}

function configLobby(args: string[], out: ExtrasOutcome, note: Note): ExtrasOutcome {
  if (args.length === 0) return note(EXTRAS_TEXT.missing);
  const sub = args[0]!.trim().toUpperCase(), L = LobbyCommandId;
  const lobby = (command: number, params = '') => { out.packets.push({ id: X.LobbyCommand, command, params } as unknown as ClientPacket); return out; };
  const needNumber = (index: number, command: number) => validNumber(args[index] ?? '', 'long') ? lobby(command, args[index]!) : note(EXTRAS_TEXT.badValue);
  switch (sub) {
    case 'SPAWN': return lobby(L.SetSpawnPos);
    case 'MAXLVL': return needNumber(1, L.SetMaxLevel);
    case 'MINLVL': return needNumber(1, L.SetMinLevel);
    case 'SUMPLAYER': return needNumber(1, L.SummonSinglePlayer);
    case 'SUMALL': return lobby(L.SummonAll);
    case 'RETURNPLAYER': return needNumber(1, L.ReturnSinglePlayer);
    case 'RETALL': return lobby(L.ReturnAllSummoned);
    case 'OPEN': return args.length >= 2 && args[1]!.trim().toUpperCase() === 'PRIVATE' ? (lobby(L.OpenLobby, '0'), lobby(L.OpenLobby, '1')) : lobby(L.OpenLobby, '1');
    case 'START': return lobby(L.StartEvent);
    case 'END': return lobby(L.EndEvent);
    case 'LIST': return lobby(L.ListPlayers);
    case 'CLASS': {
      const limit = args.length > 1 ? CLASS_LIMIT[args[1]!.trim().toUpperCase()] : undefined;
      if (args.length <= 1) return note(EXTRAS_TEXT.badValue);
      return limit === undefined ? out : lobby(L.SetClassLimit, String(limit));
    }
    case 'KICK': return args.length >= 2 && validNumber(args[2] ?? '', 'long') ? lobby(L.KickPlayer, args[2]!) : note(EXTRAS_TEXT.badValue);
    case 'FORCERESET': return lobby(L.ForceReset);
    case 'SETTEAMSIZE': {
      if (args.length < 2 || !validNumber(args[1]!, 'long')) return note(EXTRAS_TEXT.badValue);
      return lobby(L.SetTeamSize, `${args[1]} ${args.length >= 3 && args[2]!.trim().toUpperCase() === 'PREMADE' ? 0 : 1}`);
    }
    case 'ADDPLAYER': return args.length >= 2 ? lobby(L.AddPlayer, args.slice(1).join('')) : note(EXTRAS_TEXT.badValue);
    case 'SETPRICE': return args.length >= 2 ? lobby(L.SetInscriptionPrice, args[1]!) : note(EXTRAS_TEXT.badValue);
    default: return note(EXTRAS_TEXT.badLobby);
  }
}
