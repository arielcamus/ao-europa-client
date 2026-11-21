/*
 * Events, duels, battlegrounds, premium shop, remort, anti-cheat and the other small packets of the classic VB6 protocol that no
 * feature area owns, 2026-11-21. Field order is the client Protocol_Writes.bas Write* procedure (client packets) or the server
 * Protocol_Writes.bas Write* procedure / client Protocol.bas Handle* reader (server packets); ids are PacketId.bas (PYMMO=0).
 * Own file so parallel feature branches do not conflict; packets.ts only spreads the two tables.
 * Copyright (C) 2023-2026 Noland Studios LTD. AGPL-3.0-or-later; no warranty. See ../../../../LICENSE.
 *
 * Deliberately NOT here: ChangeSkinSlot (c2s 307) has an id in PacketId.bas but no handler and no writer on either side, so its
 * payload does not exist. Ariel's rule (21 Nov): pre-HOO only. RemortState/RemortResult/RequestRemort and the five Hoo* packets
 * (HooClientCapabilities, HooTargetedSpellCast(+Result), HooHouseDoorAction(+Result)) exist only for the next-gen HOO client (the
 * server gates them behind "hoo-*" capabilities), so they are left uncovered on purpose.
 */
import { ProtocolError } from '../binary.js';
import type { Reader, SafeArrayInt8, Writer } from '../binary.js';

export interface ExtrasCodec<T> { read(reader: Reader): T; write(writer: Writer, value: T): void }
interface Ty { i8: number; i16: number; i32: number; s8: string; bool: boolean }
type Spec = Record<string, keyof Ty>;
type Shape<S extends Spec> = { [K in keyof S]: Ty[S[K]] };

/** A packet that is a flat run of fixed fields, written in the order of the object's keys. */
function flat<const S extends Spec>(spec: S): ExtrasCodec<Shape<S>> {
  return {
    read(r) {
      const out: Record<string, unknown> = {};
      for (const [name, type] of Object.entries(spec)) {
        out[name] = type === 'i8' ? r.readInt8() : type === 'i16' ? r.readInt16() : type === 'i32' ? r.readInt32() : type === 's8' ? r.readString() : r.readBool();
      }
      return out as Shape<S>;
    },
    write(w, v) {
      for (const [name, type] of Object.entries(spec)) {
        const value = (v as Record<string, unknown>)[name];
        if (type === 'i8') w.writeInt8(value as number); else if (type === 'i16') w.writeInt16(value as number);
        else if (type === 'i32') w.writeInt32(value as number); else if (type === 's8') w.writeString(value as string);
        else w.writeBool(value as boolean);
      }
    },
  };
}
const empty = flat({});

export const ExtrasServerPacketId = {
  InvasionInfo: 165, ShopInit: 178, UpdateShopClienteCredits: 179, NotificarClienteSeguido: 183, ShopPjsInit: 189,
  AntiCheatMessage: 196, AntiCheatStartSession: 197, ReportLobbyList: 198, ChangeSkinSlot: 200,
} as const;

export const ExtrasClientPacketId = {
  ChangeDescription: 64, Gamble: 67, MapPriceEntrance: 68, LeaveFaction: 69, Participar: 185, OfertaInicial: 213, OfertaDeSubasta: 214,
  CuentaRegresiva: 216, Duel: 218, AcceptDuel: 219, CancelDuel: 220, QuitDuel: 221, Casarse: 227, MacroPossent: 239, SubastaInfo: 240,
  EventoInfo: 244, CrearEvento: 245, CrearTorneo: 248, ComenzarTorneo: 249, CancelarTorneo: 250, BusquedaTesoro: 251,
  FinEvento: 267, CreateEvent: 272, LogMacroClickHechizo: 274, BuyShopItem: 290, StartEvent: 291, CancelarEvento: 292,
  PublicarPersonajeMAO: 294, EventoFaccionario: 295, LobbyCommand: 297, FeatureToggle: 298, AntiCheatMessage: 302, RequestLobbyList: 303,
  AntiMacroMessage: 310, ModifyCastleWhiteList: 311,
} as const;

export interface ShopItem { objNum: number; value: number; name: string }
export interface LobbyEntry {
  id: number; description: string; scenarioType: string; minLevel: number; maxLevel: number; minPlayers: number; maxPlayers: number;
  registeredPlayers: number; teamSize: number; teamType: number; inscriptionPrice: number; isPrivate: number;
}
export interface SkinSlot { slot: number; objIndex: number; equipped: boolean; grhIndex: number; objType: number; name: string }

export const extrasServerCodecs = {
  /** HandleInvasionInfo: Invasion Int8, PorcentajeVida Int8, PorcentajeTiempo Int8. */
  [ExtrasServerPacketId.InvasionInfo]: flat({ invasion: 'i8', lifePercent: 'i8', timePercent: 'i8' }),
  /** WriteShopInit: count Int16, credits Int32, then per object ObjNum Int32, Valor Int32, Name String8. */
  [ExtrasServerPacketId.ShopInit]: {
    read: r => {
      const count = r.readInt16(), credits = r.readInt32(), items: ShopItem[] = [];
      for (let i = 0; i < count; i++) items.push({ objNum: r.readInt32(), value: r.readInt32(), name: r.readString() });
      return { credits, items };
    },
    write: (w, v) => { w.writeInt16(v.items.length); w.writeInt32(v.credits); for (const i of v.items) { w.writeInt32(i.objNum); w.writeInt32(i.value); w.writeString(i.name); } },
  } as ExtrasCodec<{ credits: number; items: ShopItem[] }>,
  [ExtrasServerPacketId.UpdateShopClienteCredits]: flat({ credits: 'i32' }),
  /** HandleNotificarClienteSeguido: Seguido Int8 (a GM is following this client). */
  [ExtrasServerPacketId.NotificarClienteSeguido]: flat({ followed: 'i8' }),
  [ExtrasServerPacketId.ShopPjsInit]: empty,
  /** HandleAntiCheatMessage: one SAFEARRAY of bytes for the anti-cheat library. */
  [ExtrasServerPacketId.AntiCheatMessage]: {
    read: r => ({ data: r.readSafeArrayInt8() }),
    write: (w, v) => { w.writeSafeArrayInt8(v.data); },
  } as ExtrasCodec<{ data: SafeArrayInt8 }>,
  [ExtrasServerPacketId.AntiCheatStartSession]: empty,
  /** WriteUpdateLobbyList: count Int16, then per lobby the fields of HandleReportLobbyList. */
  [ExtrasServerPacketId.ReportLobbyList]: {
    read: r => {
      const count = r.readInt16(), lobbies: LobbyEntry[] = [];
      for (let i = 0; i < count; i++) {
        lobbies.push({
          id: r.readInt16(), description: r.readString(), scenarioType: r.readString(), minLevel: r.readInt16(), maxLevel: r.readInt16(),
          minPlayers: r.readInt16(), maxPlayers: r.readInt16(), registeredPlayers: r.readInt16(), teamSize: r.readInt16(), teamType: r.readInt16(),
          inscriptionPrice: r.readInt32(), isPrivate: r.readInt8(),
        });
      }
      return { lobbies };
    },
    write: (w, v) => {
      w.writeInt16(v.lobbies.length);
      for (const l of v.lobbies) {
        w.writeInt16(l.id); w.writeString(l.description); w.writeString(l.scenarioType); w.writeInt16(l.minLevel); w.writeInt16(l.maxLevel);
        w.writeInt16(l.minPlayers); w.writeInt16(l.maxPlayers); w.writeInt16(l.registeredPlayers); w.writeInt16(l.teamSize); w.writeInt16(l.teamType);
        w.writeInt32(l.inscriptionPrice); w.writeInt8(l.isPrivate);
      }
    },
  } as ExtrasCodec<{ lobbies: LobbyEntry[] }>,
  /**
   * WriteChangeSkinSlot: Slot Int8, ObjIndex Int16, Equipped Bool, then GrhIndex Int32, ObjType Int8, Name String8. For an empty or
   * deleted slot the VB6 server writes Int32 0, Int16 0, String8 "" instead: one byte more than the client reads (it reads ObjType
   * and an empty name and leaves the last zero byte). We accept that exact shape and write it back the same way.
   */
  [ExtrasServerPacketId.ChangeSkinSlot]: {
    read: r => {
      const slot = r.readInt8(), objIndex = r.readInt16(), equipped = r.readBool(), grhIndex = r.readInt32();
      if (grhIndex === 0 && r.remaining === 3) {
        if (r.readInt8() !== 0 || r.readInt8() !== 0 || r.readInt8() !== 0) throw new ProtocolError('ChangeSkinSlot: malformed empty-slot tail');
        return { slot, objIndex, equipped, grhIndex: 0, objType: 0, name: '' };
      }
      return { slot, objIndex, equipped, grhIndex, objType: r.readInt8(), name: r.readString() };
    },
    write: (w, v) => {
      w.writeInt8(v.slot); w.writeInt16(v.objIndex); w.writeBool(v.equipped); w.writeInt32(v.grhIndex);
      if (v.grhIndex === 0 && v.objType === 0 && v.name === '') { w.writeInt16(0); w.writeString(''); } else { w.writeInt8(v.objType); w.writeString(v.name); }
    },
  } as ExtrasCodec<SkinSlot>,
} as const;

export const extrasClientCodecs = {
  [ExtrasClientPacketId.ChangeDescription]: flat({ description: 's8' }),
  [ExtrasClientPacketId.Gamble]: flat({ amount: 'i16' }),
  [ExtrasClientPacketId.MapPriceEntrance]: empty,
  [ExtrasClientPacketId.LeaveFaction]: empty,
  /** WriteParticipar: RoomId Int16, Password String8. */
  [ExtrasClientPacketId.Participar]: flat({ roomId: 'i16', password: 's8' }),
  [ExtrasClientPacketId.OfertaInicial]: flat({ offer: 'i32' }),
  /** HandleOfertaDeSubasta (server): Oferta Int32. The classic client has no writer for it. */
  [ExtrasClientPacketId.OfertaDeSubasta]: flat({ offer: 'i32' }),
  [ExtrasClientPacketId.CuentaRegresiva]: flat({ seconds: 'i8' }),
  /** WriteDuel: Players String8, Apuesta Int32, PocionesRojas Int16 (-1 = unlimited), CaenItems Bool. */
  [ExtrasClientPacketId.Duel]: flat({ players: 's8', bet: 'i32', redPotions: 'i16', dropItems: 'bool' }),
  [ExtrasClientPacketId.AcceptDuel]: flat({ offerer: 's8' }),
  [ExtrasClientPacketId.CancelDuel]: empty,
  [ExtrasClientPacketId.QuitDuel]: empty,
  /** WriteCasamiento (id eCasarse): userName String8. */
  [ExtrasClientPacketId.Casarse]: flat({ userName: 's8' }),
  /** HandleMacroPos (server): ChatCombate Int8, ChatGlobal Int8. */
  [ExtrasClientPacketId.MacroPossent]: flat({ chatCombat: 'i8', chatGlobal: 'i8' }),
  [ExtrasClientPacketId.SubastaInfo]: empty,
  [ExtrasClientPacketId.EventoInfo]: empty,
  /** WriteCrearEvento: TIPO Int8, duracion Int8, multiplicacion Int8. */
  [ExtrasClientPacketId.CrearEvento]: flat({ type: 'i8', duration: 'i8', multiplier: 'i8' }),
  /** HandleCrearTorneo (server): levels, slots, cost, twelve class flags, map, x, y, name, rules. */
  [ExtrasClientPacketId.CrearTorneo]: flat({
    minLevel: 'i8', maxLevel: 'i8', slots: 'i8', cost: 'i32', mage: 'i8', cleric: 'i8', warrior: 'i8', assassin: 'i8', bard: 'i8', druid: 'i8',
    paladin: 'i8', hunter: 'i8', worker: 'i8', pirate: 'i8', thief: 'i8', bandit: 'i8', map: 'i16', x: 'i8', y: 'i8', name: 's8', rules: 's8',
  }),
  [ExtrasClientPacketId.ComenzarTorneo]: empty,
  [ExtrasClientPacketId.CancelarTorneo]: empty,
  [ExtrasClientPacketId.BusquedaTesoro]: flat({ type: 'i8' }),
  [ExtrasClientPacketId.FinEvento]: empty,
  [ExtrasClientPacketId.CreateEvent]: flat({ eventName: 's8' }),
  /** WriteLogMacroClickHechizo: TIPO Int8, clicks Int32. */
  [ExtrasClientPacketId.LogMacroClickHechizo]: flat({ type: 'i8', clicks: 'i32' }),
  /** HandleBuyShopItem (server): obj_to_buy Int32. */
  [ExtrasClientPacketId.BuyShopItem]: flat({ objNum: 'i32' }),
  /** HandleStartEvent (server): eventType, scenario, levels, players, team, rounds, fee, description, password. */
  [ExtrasClientPacketId.StartEvent]: flat({
    eventType: 'i8', scenarioType: 'i8', minLevel: 'i8', maxLevel: 'i8', minPlayers: 'i8', maxPlayers: 'i8', teamSize: 'i8', teamType: 'i8',
    roundNumber: 'i8', inscriptionFee: 'i32', description: 's8', password: 's8',
  }),
  [ExtrasClientPacketId.CancelarEvento]: empty,
  /** HandlePublicarPersonajeMAO (server): Valor Int32. */
  [ExtrasClientPacketId.PublicarPersonajeMAO]: flat({ price: 'i32' }),
  [ExtrasClientPacketId.EventoFaccionario]: empty,
  /** WriteLobbyCommand: command Int8, Params String8. */
  [ExtrasClientPacketId.LobbyCommand]: flat({ command: 'i8', params: 's8' }),
  /** HandleFeatureToggle (server): value Int8 (0 or 1), name String8. */
  [ExtrasClientPacketId.FeatureToggle]: flat({ value: 'i8', name: 's8' }),
  [ExtrasClientPacketId.AntiCheatMessage]: {
    read: r => ({ data: r.readSafeArrayInt8() }),
    write: (w, v) => { w.writeSafeArrayInt8(v.data); },
  } as ExtrasCodec<{ data: SafeArrayInt8 }>,
  /** eRequestLobbyList has no payload (server HendleRequestLobbyList reads nothing). */
  [ExtrasClientPacketId.RequestLobbyList]: empty,
  /** WriteAntiMacroMessage: userName String8, mensaje String8. */
  [ExtrasClientPacketId.AntiMacroMessage]: flat({ userName: 's8', message: 's8' }),
  [ExtrasClientPacketId.ModifyCastleWhiteList]: flat({ command: 's8' }),
} as const;
