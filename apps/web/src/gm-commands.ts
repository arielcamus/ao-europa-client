/*
 * GM slash commands (wp12), 2026-11-21, from the classic client ProtocolCmdParse.bas (ParseUserCommand, the GM half) and the
 * Write* procedures of Protocol_Writes.bas. No DOM and no session here: `parseGmCommand` returns the packets and console lines
 * the VB6 parser would produce, so it is tested without a socket. Copyright (C) 2022-2026 Noland Studios.
 * AGPL-3.0-or-later; see NOTICE.
 *
 * Faithful quirks kept on purpose: commands guarded by EsGM do nothing at all for a normal player (no console line);
 * /TELEP with 3 arguments does nothing; /TELEP NICK MAPA defaults to 50,50; /CI with one argument creates 1.
 */
import { GmClientPacketId as G, WorldClientPacketId as W } from '@ao/protocol';
import type { ClientPacket } from '@ao/protocol';
import { FONTTYPE } from './chat-fonts.js';

/** What `ParseUserCommand` does besides sending packets. */
export type GmWindow = 'gmHelp' | 'objects';
export interface GmOutcome {
  packets: ClientPacket[];
  notes: { text: string; font: number }[];
  /** A client-side form the command opens (/GM -> FrmGmAyuda, /CO -> FrmObjetos). */
  open?: GmWindow;
}
export interface GmArgs {
  /** ArgumentosRaw: everything after the first space (untrimmed). */
  raw: string;
  /** Split(ArgumentosRaw, " "): at least one element when there are arguments. */
  all: string[];
  /** CantidadArgumentos: 0 without arguments. */
  count: number;
  /** notNullArguments: LenB(Trim$(ArgumentosRaw)) <> 0. */
  filled: boolean;
}
export interface GmContext { isGM: boolean }

/** Spanish JsonLanguage (Languages/1.json) texts the parser prints. */
export const GM_TEXT = {
  missing: 'Faltan parámetros',
  missingDot: 'Faltan parámetros.',
  writeMessage: 'Escriba un mensaje.',
  writeComment: 'Escriba un comentario.',
  writeQuestion: 'Escriba una pregunta.',
  badMap: 'Mapa incorrecto. Utilice /nene MAPA.',
  badValue: 'Valor incorrecto. Utilice /telep NICKNAME MAPA X Y.',
  badFormat: 'Formato incorrecto. Utilice /SILENCIAR NICKNAME@MOTIVO.',
  badTime: 'Tiempo incorrecto. Utilice /carcel NICKNAME@MOTIVO@TIEMPO.',
  badCommand: 'Comando incorrecto.',
  badAmount: 'Cantidad incorrecta. Utilice /depositar CANTIDAD.',
  badIp: 'IP incorrecta. Utilice /ip2nick IP.',
  onclan: 'Utilice /onclan nombre del clan.',
  badMidi: 'Midi incorrecto. Utilice /forcemidimap MIDI MAPA, siendo el mapa opcional.',
  useMidiMap: 'Utilice /forcemidimap MIDI MAPA, siendo el mapa opcional.',
  useWavMap: 'Utilice /forcewavmap WAV MAP X Y, siendo los últimos 3 opcionales.',
  badWav: 'Wav incorrecto. Utilice /forcew/acc NPCav WAV.',
  badTrigger: 'Numero incorrecto. Utilice /trigger NUMERO.',
  badNpc: 'Npc incorrecto. Utilice .',
  giveName: 'Ingrese el nombre del usuario. Utilice /DAR NOMBRE@MOTIVO@OBJETO[@CANTIDAD=1].',
  giveReason: 'Ingrese el motivo para dar. Utilice /DAR NOMBRE@MOTIVO@OBJETO[@CANTIDAD=1].',
  giveAmount: 'Cantidad inválida. Utilice /DAR NOMBRE@MOTIVO@OBJETO[@CANTIDAD=1].',
  giveObject: 'Número de objeto inválido. Utilice /DAR NOMBRE@MOTIVO@OBJETO[@CANTIDAD=1].',
  notSupported: 'Not supported.',
  badParameters: 'Parámetros incorrectos.',
  mapOptions: 'Faltan parámetros. Opciones: SEGURO, BACKUP, RESTRINGIR, MAGIASINEFECTO, INVISINEFECTO, RESUSINEFECTO, TERRENO, ZONA',
} as const;

type NumberType = 'byte' | 'integer' | 'long' | 'trigger';
const RANGES: Record<NumberType, readonly [number, number]> = { byte: [0, 255], integer: [-32768, 32767], long: [-2147483648, 2147483647], trigger: [0, 255] };
/** VB6 IsNumeric on a trimmed string (digits, sign, one point, optional exponent; also &H hex and &O octal). */
const isNumeric = (text: string) => {
  const t = text.trim();
  return /^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?$/.test(t) || /^&[hH][0-9a-fA-F]+&?$/.test(t) || /^&[oO]?[0-7]+&?$/.test(t);
};
/** VB6 val(): leading number, 0 when the text does not start with one. */
export const vbVal = (text: string): number => {
  const t = text.trim();
  const hex = /^&[hH]([0-9a-fA-F]+)/.exec(t);
  if (hex) return parseInt(hex[1]!, 16);
  const m = /^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?/.exec(t.replace(/\s+/g, ''));
  return m ? Number(m[0].replace(/[dD]/, 'e')) : 0;
};
/** ProtocolCmdParse.ValidNumber. */
export const validNumber = (text: string, type: NumberType): boolean => {
  if (!isNumeric(text)) return false;
  const [min, max] = RANGES[type], n = vbVal(text);
  return n >= min && n <= max;
};
/** CInt / CLng: round half to even. */
const cint = (text: string): number => {
  const n = vbVal(text), floor = Math.floor(n), diff = n - floor;
  return diff < 0.5 ? floor : diff > 0.5 ? floor + 1 : floor % 2 === 0 ? floor : floor + 1;
};
/** CBool of a string: numeric non-zero is True, "True"/"False" text works, anything else raises in VB6 (read here as False). */
const cbool = (text: string) => isNumeric(text) ? vbVal(text) !== 0 : text.trim().toLowerCase() === 'true';
/** str2ipv4l: the four octets of a validated dotted quad. */
const validIp = (text: string) => { const parts = text.split('.'); return parts.length === 4 && parts.every(part => validNumber(part, 'byte')); };

/** ParseUserCommand's tmpArr = Split(text, sep, limit). */
const split = (text: string, separator: string, limit = Infinity): string[] => {
  const parts = text.split(separator);
  return parts.length <= limit ? parts : [...parts.slice(0, limit - 1), parts.slice(limit - 1).join(separator)];
};

/** The /MOD option words (both languages) -> eEditOptions. */
const EDIT_OPTIONS: Readonly<Record<string, number>> = {
  ORO: 1, EXP: 2, BODY: 3, CUERPO: 3, HEAD: 4, CABEZA: 4, CIU: 5, CIUDADANOS: 5, CRI: 6, CRIMINALES: 6,
  LEVEL: 7, LVL: 7, ELV: 7, CLASE: 8, CLASS: 8, SKILLS: 9, SKILLSLIBRES: 10, LIBRES: 10, SEX: 11, SEXO: 11, GENERO: 11, GENDER: 11,
  RAZA: 12, RACE: 12, ARMA: 13, ESCUDO: 14, CASCO: 15, PARTICULA: 16, HP: 17, VIDA: 17, SALUD: 17, MP: 18, MANA: 18, STA: 19, STAMINA: 19, ENERGIA: 19,
  MINHP: 20, MINVIDA: 20, MINMP: 21, MINMANA: 21, HIT: 22, GOLPE: 22, MINHIT: 23, MINGOLPE: 23, MAXHIT: 24, MAXGOLPE: 24,
  DESC: 25, DESCRIPCION: 25, INT: 26, INTERVALO: 26, HOGAR: 27, CIUDAD: 27, CASA: 27, ALIAS: 28,
};
export const EDIT_OPTION_WORDS = Object.keys(EDIT_OPTIONS);

/** Commands that write only their packet id. */
const BARE: Readonly<Record<string, number>> = {
  '/SHOWNAME': G.ShowName, '/ONLINEREAL': G.OnlineRoyalArmy, '/ONLINECAOS': G.OnlineChaosLegion, '/TELEPLOC': G.WarpMeToTarget,
  '/INVISIBLE': G.Invisible, '/GENIO': G.Genio, '/GENIUS': G.Genio, '/TRABAJANDO': G.Working, '/WORKING': G.Working,
  '/OCULTANDO': G.Hiding, '/HIDING': G.Hiding, '/RMATA': G.KillNPC, '/ONLINEGM': G.OnlineGM, '/ONLINEMAP': G.OnlineMap,
  '/PERDON': G.Forgive, '/SORRY': G.Forgive, '/SEGUIR': G.NPCFollow, '/FOLLOW': G.NPCFollow, '/RESETINV': G.ResetNPCInventory,
  '/LIMPIAR': G.CleanWorld, '/CLEAN': G.CleanWorld, '/DT': G.TeleportDestroy, '/LLUVIA': W.RainToggle, '/RAIN': W.RainToggle,
  '/NIEVE': W.NieveToggle, '/SNOW': W.NieveToggle, '/NIEBLA': W.NieblaToggle, '/FOG': W.NieblaToggle,
  '/MASSDEST': G.DestroyAllItemsInArea, '/PISO': G.ItemsInTheFloor, '/FLOOR': G.ItemsInTheFloor, '/DEST': G.DestroyItems,
  '/BLOQ': G.TileBlockedToggle, '/MATA': G.KillNPCNoRespawn, '/MASSKILL': G.KillAllNearbyNPCs, '/MOTDCAMBIA': G.ChangeMOTD,
  '/HABILITAR': G.ServerOpenToUsersToggle, '/ENABLE': G.ServerOpenToUsersToggle, '/DOBACKUP': G.DoBackUp, '/MAPINFO': G.GetMapInfo,
  '/GRABAR': G.SaveChars, '/ECHARTODOSPJS': G.KickAllChars, '/EARTHODOSPJS': G.KickAllChars, '/IGNORADO': G.Ignored, '/IGNORED': G.Ignored,
  '/TOGGLEGLOBAL': G.GlobalOnOff, '/PROMEDIO': G.Promedio, '/AVERAGE': G.Promedio, '/INFORMACION': G.Information, '/INFORMATION': G.Information,
  '/RECOMPENSA': G.Reward, '/REWARD': G.Reward, '/UPTIME': G.UpTime, '/CC': G.SpawnListRequest,
};
/** Commands behind EsGM in VB6 (nothing happens for a player, not even a console line). */
const GM_ONLY = new Set(['/IRA', '/GO', '/SUM', '/CC', '/CI', '/DAR', '/GIVE', '/CO', '/CONSULTA', '/CONSULTATION', '/RESET', '/MAPINFO', '/TOGGLEGLOBAL']);
/** Commands whose only argument is a name or text and that print "Faltan parámetros" when empty. */
const ONE_TEXT: Readonly<Record<string, [number, string]>> = {
  '/GMSG': [G.GMMessage, GM_TEXT.writeMessage], '/IRCERCA': [G.GoNearby, GM_TEXT.missing], '/REM': [G.Comment, GM_TEXT.writeComment], '/ANOTAR': [G.Comment, GM_TEXT.writeComment],
  '/DONDE': [G.Where, GM_TEXT.missing], '/WHERE': [G.Where, GM_TEXT.missing], '/LOG': [G.PossUser, GM_TEXT.missing],
  '/INFO': [G.RequestCharInfo, GM_TEXT.missing], '/STAT': [G.RequestCharStats, GM_TEXT.missing], '/BAL': [G.RequestCharGold, GM_TEXT.missing],
  '/INV': [G.RequestCharInventory, GM_TEXT.missing], '/BOV': [G.RequestCharBank, GM_TEXT.missing], '/SKILLS': [G.RequestCharSkills, GM_TEXT.missing],
  '/REVIVIR': [G.ReviveChar, GM_TEXT.missing], '/REVIVE': [G.ReviveChar, GM_TEXT.missing], '/ECHAR': [G.Kick, GM_TEXT.missing], '/THROW': [G.Kick, GM_TEXT.missing],
  '/EJECUTAR': [G.Execute, GM_TEXT.missing], '/EXECUTE': [G.Execute, GM_TEXT.missing], '/UNBAN': [G.UnbanChar, GM_TEXT.missing],
  '/UNBANCUENTA': [G.UnbanCuenta, GM_TEXT.missing], '/RMSG': [G.ServerMessage, GM_TEXT.writeMessage], '/NICK2IP': [G.NickToIP, GM_TEXT.missing],
  '/REALMSG': [G.RoyalArmyMessage, GM_TEXT.writeMessage], '/CAOSMSG': [G.ChaosLegionMessage, GM_TEXT.writeMessage], '/TALKAS': [G.TalkAsNPC, GM_TEXT.writeMessage],
  '/ACEPTCONSE': [G.AcceptRoyalCouncilMember, GM_TEXT.missing], '/ACEPTCONSECAOS': [G.AcceptChaosCouncilMember, GM_TEXT.missing],
  '/ESTUPIDO': [G.MakeDumb, GM_TEXT.missing], '/IDIOT': [G.MakeDumb, GM_TEXT.missing], '/NOESTUPIDO': [G.MakeDumbNoMore, GM_TEXT.missing], '/NOTSTUDIED': [G.MakeDumbNoMore, GM_TEXT.missing],
  '/KICKCONSE': [G.CouncilKick, GM_TEXT.missing], '/MIEMBROSCLAN': [G.GuildMemberList, GM_TEXT.missing], '/BANCLAN': [G.GuildBan, GM_TEXT.missing],
  '/NOCAOS': [G.ChaosLegionKick, GM_TEXT.missing], '/NOREAL': [G.RoyalArmyKick, GM_TEXT.missing], '/SMSG': [G.SystemMessage, GM_TEXT.writeMessage],
  '/RAJARCLAN': [G.RemoveCharFromGuild, GM_TEXT.missing], '/SLIT': [G.RemoveCharFromGuild, GM_TEXT.missing], '/SHOWCMSG': [G.ShowGuildMessages, GM_TEXT.missing],
  '/ROL': [G.RoleMasterRequest, GM_TEXT.writeQuestion], '/PENAS': [G.Punishments, ''], '/SENTENCE': [G.Punishments, ''],
};
/** The packet field each ONE_TEXT id carries (VB6 parameter names). */
const ONE_TEXT_FIELD: Readonly<Record<number, string>> = {
  [G.GMMessage]: 'message', [G.Comment]: 'message', [G.ServerMessage]: 'message', [G.RoyalArmyMessage]: 'message', [G.ChaosLegionMessage]: 'message',
  [G.TalkAsNPC]: 'message', [G.SystemMessage]: 'message', [G.RoleMasterRequest]: 'message',
  [G.MakeDumb]: 'userName', [G.MakeDumbNoMore]: 'userName', [G.GuildMemberList]: 'guild', [G.GuildBan]: 'guild', [G.ShowGuildMessages]: 'guild',
};
const fieldOf = (id: number) => ONE_TEXT_FIELD[id] ?? 'userName';
/** `NICK@TEXT` commands: two strings, split at the first @. */
const AT_PAIR: Readonly<Record<string, [number, string, string]>> = {
  '/SILENCIAR': [G.Silence, 'userName', 'minutos'], '/MUTE': [G.Silence, 'userName', 'minutos'],
  '/ADVERTENCIA': [G.WarnUser, 'userName', 'reason'], '/WARNING': [G.WarnUser, 'userName', 'reason'],
  '/MENSAJEINFORMACION': [G.MensajeUser, 'userName', 'mensaje'], '/MESSAGEINFORMATION': [G.MensajeUser, 'userName', 'mensaje'],
  '/BAN': [G.BanChar, 'userName', 'reason'], '/BANCUENTA': [G.BanCuenta, 'userName', 'reason'], '/ANAME': [G.AlterName, 'userName', 'newName'],
};

const outcome = (): GmOutcome => ({ packets: [], notes: [] });

/**
 * The GM half of ParseUserCommand. `command` is the upper-cased first word (with its slash). Returns undefined when the command is not a
 * GM command handled here, so the caller keeps its own answer for it.
 */
export function parseGmCommand(command: string, args: GmArgs, context: GmContext): GmOutcome | undefined {
  const out = outcome();
  const note = (text: string) => { out.notes.push({ text, font: FONTTYPE.TALK }); return out; };
  const send = (packet: Record<string, unknown>) => { out.packets.push(packet as unknown as ClientPacket); return out; };
  const { raw, all, count, filled } = args;
  if (GM_ONLY.has(command) && !context.isGM) return out;

  if (BARE[command] !== undefined) return send({ id: BARE[command] });

  const one = ONE_TEXT[command];
  if (one) {
    const [id, missing] = one;
    // /PENAS writes Punishments(ArgumentosRaw) even with an empty argument.
    if (filled || id === G.Punishments) return send({ id, [fieldOf(id)]: raw });
    return note(missing);
  }
  const pair = AT_PAIR[command];
  if (pair) {
    const [id, first, second] = pair;
    if (!filled) return note(GM_TEXT.missing);
    const parts = split(raw, '@', 2);
    if (parts.length !== 2) return note(GM_TEXT.badFormat);
    return send({ id, [first]: parts[0], [second]: id === G.Silence ? cint(parts[1]!) : parts[1] });
  }

  switch (command) {
    // /ONLINE: a GM asks the server, a player gets the Steam players link.
    case '/ONLINE': return context.isGM ? send({ id: G.Online }) : note('https://steamcharts.com/app/1956740');
    case '/NENE':
      if (!filled) return note(GM_TEXT.missing);
      return validNumber(raw, 'integer') ? send({ id: G.CreaturesInMap, map: cint(raw) }) : note(GM_TEXT.badMap);
    case '/TELEP': {
      if (!filled) return note(GM_TEXT.missing);
      if (count >= 4) {
        if (validNumber(all[1]!, 'integer') && validNumber(all[2]!, 'byte') && validNumber(all[3]!, 'byte')) return send({ id: G.WarpChar, userName: all[0], map: cint(all[1]!), x: cint(all[2]!), y: cint(all[3]!) });
        return note(GM_TEXT.badValue);
      }
      if (count === 2) return validNumber(all[1]!, 'integer') ? send({ id: G.WarpChar, userName: all[0], map: cint(all[1]!), x: 50, y: 50 }) : note(GM_TEXT.badValue);
      return out;
    }
    case '/IRA': return send({ id: G.GoToChar, userName: raw });
    case '/GO':
      return validNumber(raw, 'integer') ? send({ id: G.WarpChar, userName: 'YO', map: cint(raw), x: 50, y: 50 }) : send({ id: G.GoToChar, userName: raw });
    case '/SUM': return send({ id: G.SummonChar, userName: raw });
    case '/PANELGM': send({ id: G.SOSShowList }); return send({ id: G.GMPanel });
    case '/CARCEL': case '/JAIL': {
      if (!filled) return note(GM_TEXT.missing);
      const parts = raw.split('@');
      if (parts.length !== 3) return note(GM_TEXT.badFormat);
      return validNumber(parts[2]!, 'long') ? send({ id: G.Jail, userName: parts[0], reason: parts[1], time: cint(parts[2]!) }) : note(GM_TEXT.badTime);
    }
    case '/MOD': {
      if (!(filled && count >= 3)) return note(GM_TEXT.missingDot);
      const option = EDIT_OPTIONS[all[1]!.toUpperCase()];
      if (option === undefined) return note(GM_TEXT.badCommand);
      // WriteEditChar(name, option, arg1, arg2): the fourth word (and only it) is arg2, the rest of the line is dropped.
      return send({ id: G.EditChar, userName: all[0], editOption: option, arg1: all[2], arg2: count === 3 ? '' : all[3] });
    }
    case '/DONAR': case '/DONATE':
      if (!filled) return note(GM_TEXT.missing);
      return validNumber(raw, 'long') ? send({ id: G.DonateGold, oro: cint(raw) }) : note(GM_TEXT.badAmount);
    case '/SUMALL': return out; // WriteSummonCharMulti is an events packet outside wp12
    case '/CO': out.open = 'objects'; return out;
    case '/GM': out.open = 'gmHelp'; return out;
    case '/IP2NICK':
      if (!filled) return note(GM_TEXT.missing);
      return validIp(raw) ? send({ id: G.IPToNick, ip: raw.split('.').map(Number) }) : note(GM_TEXT.badIp);
    case '/ONCLAN': return filled ? send({ id: G.GuildOnlineMembers, guild: raw }) : note(GM_TEXT.onclan);
    case '/CT': {
      if (!raw.includes('@')) return note(GM_TEXT.missing);
      const tempStr = raw.split('@');
      if (filled && count > 4 && tempStr[1] !== '') {
        if (validNumber(all[0]!, 'integer') && validNumber(all[1]!, 'byte') && validNumber(all[2]!, 'byte') && validNumber(all[3]!, 'byte')) {
          return send({ id: G.TeleportCreate, map: cint(all[0]!), x: cint(all[1]!), y: cint(all[2]!), radio: cint(all[3]!), motivo: tempStr[1] });
        }
        return note(GM_TEXT.badValue);
      }
      return note(GM_TEXT.missing);
    }
    case '/SETDESC': return send({ id: G.SetCharDescription, desc: raw });
    case '/FORCEMIDIMAP': {
      if (!filled) return note(GM_TEXT.useMidiMap);
      if (count === 1) return validNumber(all[0]!, 'byte') ? send({ id: G.ForceMIDIToMap, midiID: cint(all[0]!), map: 0 }) : note(GM_TEXT.badMidi);
      return validNumber(all[0]!, 'byte') && validNumber(all[1]!, 'integer') ? send({ id: G.ForceMIDIToMap, midiID: cint(all[0]!), map: cint(all[1]!) }) : note(GM_TEXT.badValue);
    }
    case '/FORCEWAVMAP': {
      if (!filled) return note(GM_TEXT.useWavMap);
      if (count === 1) return validNumber(all[0]!, 'byte') ? send({ id: G.ForceWAVEToMap, waveID: cint(all[0]!), map: 0, x: 0, y: 0 }) : note(GM_TEXT.useWavMap);
      if (count === 4 && validNumber(all[0]!, 'byte') && validNumber(all[1]!, 'integer') && validNumber(all[2]!, 'byte') && validNumber(all[3]!, 'byte')) {
        return send({ id: G.ForceWAVEToMap, waveID: cint(all[0]!), map: cint(all[1]!), x: cint(all[2]!), y: cint(all[3]!) });
      }
      return note(GM_TEXT.useWavMap);
    }
    case '/FORCEMIDI': if (!filled) return out; return validNumber(all[0]!, 'byte') ? send({ id: G.ForceMIDIAll, midiID: cint(all[0]!) }) : note(GM_TEXT.badMidi);
    case '/FORCEWAV': if (!filled) return out; return validNumber(all[0]!, 'byte') ? send({ id: G.ForceWAVEAll, waveID: cint(all[0]!) }) : note(GM_TEXT.badWav);
    case '/TRIGGER':
      if (!filled) return send({ id: G.AskTrigger });
      return validNumber(raw, 'trigger') ? send({ id: G.SetTrigger, trigger: cint(raw) }) : note(GM_TEXT.badTrigger);
    case '/CI': {
      if (!filled) return note(GM_TEXT.missing);
      if (!validNumber(all[0]!, 'integer')) return note(GM_TEXT.badValue);
      if (count === 1) return send({ id: G.CreateItem, itemIndex: cint(all[0]!), cantidad: 1 });
      return validNumber(all[1]!, 'integer') ? send({ id: G.CreateItem, itemIndex: cint(all[0]!), cantidad: cint(all[1]!) }) : note(GM_TEXT.badValue);
    }
    case '/DAR': case '/GIVE': {
      if (!filled) return note(GM_TEXT.missing);
      const parts = split(raw, '@', 4);
      if (parts.length < 3) return note(GM_TEXT.missing);
      if (parts[0]!.length === 0) return note(GM_TEXT.giveName);
      if (parts[1]!.length === 0) return note(GM_TEXT.giveReason);
      if (!validNumber(parts[2]!, 'integer')) return note(GM_TEXT.giveObject);
      const amount = parts.length === 3 ? '1' : parts[3]!;
      return validNumber(amount, 'integer') ? send({ id: G.GiveItem, userName: parts[0], objIndex: cint(parts[2]!), cantidad: cint(amount), motivo: parts[1] }) : note(GM_TEXT.giveAmount);
    }
    case '/BORRARPENA': {
      if (!filled) return note(GM_TEXT.missing);
      const parts = split(raw, '@', 3);
      return parts.length === 3 ? send({ id: G.RemovePunishment, userName: parts[0], punishment: cint(parts[1]!), newText: parts[2] }) : note(GM_TEXT.badFormat);
    }
    case '/ACC': case '/RACC': {
      if (!filled) return note(GM_TEXT.missing);
      return validNumber(all[0]!, 'integer') ? send({ id: command === '/ACC' ? G.CreateNPC : G.CreateNPCWithRespawn, npcIndex: cint(all[0]!) }) : note(GM_TEXT.badNpc);
    }
    case '/SLOT': {
      if (!filled) return note(GM_TEXT.missing);
      const parts = split(raw, '@', 2);
      return parts.length === 2 && validNumber(parts[1]!, 'byte') ? send({ id: G.CheckSlot, userName: parts[0], slot: cint(parts[1]!) }) : note(GM_TEXT.badFormat);
    }
    case '/MODMAPINFO': {
      if (count <= 1) return out;
      const value = all[1]!;
      switch (all[0]!.toUpperCase()) {
        case 'SEGURO': return send({ id: G.ChangeMapInfoPK, isPK: value === '1' });
        case 'BACKUP': return send({ id: G.ChangeMapInfoBackup, backup: value === '1' });
        case 'RESTRINGIR': return send({ id: G.ChangeMapInfoRestricted, restrict: value });
        case 'MAGIASINEFECTO': return send({ id: G.ChangeMapInfoNoMagic, nomagic: cbool(value) });
        case 'INVISINEFECTO': return send({ id: G.ChangeMapInfoNoInvi, noinvi: cbool(value) });
        case 'RESUSINEFECTO': return send({ id: G.ChangeMapInfoNoResu, noresu: cbool(value) });
        case 'TERRENO': return send({ id: G.ChangeMapInfoLand, lAnd: value });
        case 'ZONA': return send({ id: G.ChangeMapInfoZone, zone: value });
        default: return out;
      }
    }
    case '/MAPSETTING': {
      if (!context.isGM) return out;
      if (count < 2 || !validNumber(all[1]!, 'byte')) return note(GM_TEXT.badParameters);
      const setting = all[0]!.trim().toUpperCase() === 'DROPITEMS' ? 0 : all[0]!.trim().toUpperCase() === 'SAFEPVP' ? 1 : undefined;
      return setting === undefined ? note(GM_TEXT.badParameters) : send({ id: G.ChangeMapSetting, setting, value: cint(all[1]!) });
    }
    case '/BORRAR': case '/DELETE': return filled && all[0]!.toUpperCase() === 'SOS' ? send({ id: G.CleanSOS }) : out;
    case '/SHOW': return filled && all[0]!.toUpperCase() === 'INT' ? send({ id: G.ShowServerForm }) : out;
    case '/CHATCOLOR': {
      if (filled && count >= 3) {
        return validNumber(all[0]!, 'byte') && validNumber(all[1]!, 'byte') && validNumber(all[2]!, 'byte')
          ? send({ id: G.ChatColor, r: cint(all[0]!), g: cint(all[1]!), b: cint(all[2]!) }) : note(GM_TEXT.badValue);
      }
      return filled ? note(GM_TEXT.missing) : send({ id: G.ChatColor, r: 0, g: 255, b: 0 }); // no arguments: back to the default green
    }
    case '/CONSULTA': case '/CONSULTATION': return send({ id: G.Consulta, nick: raw });
    case '/RESET': return filled ? send({ id: G.ResetChar, nick: raw }) : out;
    case '/DENUNCIAR': case '/REPORT': return filled ? send({ id: G.Denounce, name: raw }) : note('Utilice /denunciar NICK, para reportar los mensajes de un usuario.');
    case '/REQDEBUG': {
      if (!context.isGM) return out;
      if (count === 0) return send({ id: G.RequestDebug, debugType: 0 });
      const type = all[0]!.trim().toUpperCase();
      if (type === 'CONNECTION') return send({ id: G.RequestDebug, debugType: 1, argument: all.slice(1).join(' ') });
      if (type === 'USERIDS') return send({ id: G.RequestDebug, debugType: 2 });
      return note(GM_TEXT.badParameters);
    }
    case '/BANIPLIST': case '/BANIPRELOAD': case '/BANIP': case '/UNBANIP': return note(GM_TEXT.notSupported);
    default: return undefined;
  }
}

/** The head of ParseUserCommand: split a typed line into the command word and its arguments, then run the GM half. */
export function parseGmLine(line: string, context: GmContext): GmOutcome | undefined {
  const cut = line.indexOf(' ');
  const command = (cut < 0 ? line : line.slice(0, cut)).trim().toUpperCase();
  const raw = cut < 0 ? '' : line.slice(cut + 1);
  const all = cut < 0 ? [] : raw.split(' ');
  return parseGmCommand(command === '' ? ' ' : command, { raw, all, count: all.length, filled: raw.trim() !== '' }, context);
}
