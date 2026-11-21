import { describe, expect, it } from 'vitest';
import { ExtrasClientPacketId as X, ExtrasServerPacketId as XS, ServerPacketId as S } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { ExtrasState, INVASION_MS, MARKET_MESSAGE, SHOP_MESSAGE } from '../src/extras.js';
import { EXTRAS_TEXT, LobbyCommandId, parseExtrasCommand } from '../src/extras-commands.js';
import { validName, validateDuel } from '../src/extras-ui.js';

const run = (line: string, ctx: { dead?: boolean; isGM?: boolean } = {}) => {
  const cut = line.indexOf(' ');
  return parseExtrasCommand((cut < 0 ? line : line.slice(0, cut)).toUpperCase(), cut < 0 ? '' : line.slice(cut + 1), { dead: false, isGM: false, ...ctx });
};

describe('extras slash commands (ProtocolCmdParse.ParseUserCommand)', () => {
  it('bare commands write only their packet', () => {
    expect(run('/EVENTO')?.packets).toEqual([{ id: X.EventoInfo }]);
    expect(run('/subasta')?.packets).toEqual([{ id: X.SubastaInfo }]);
    expect(run('/EVENTOFACCIONARIO')?.packets).toEqual([{ id: X.EventoFaccionario }]);
    expect(run('/CANCELAR')?.packets).toEqual([{ id: X.CancelDuel }]);
    expect(run('/ABANDONAR')?.packets).toEqual([{ id: X.QuitDuel }]);
  });
  it('/OFERTAINICIAL needs a positive Long, /APOSTAR an Integer, and the dead cannot bet', () => {
    expect(run('/OFERTAINICIAL 5000')?.packets).toEqual([{ id: X.OfertaInicial, offer: 5000 }]);
    expect(run('/OFERTAINICIAL 0')?.notes[0]?.text).toBe(EXTRAS_TEXT.badAmount);
    expect(run('/OFERTAINICIAL')?.notes[0]?.text).toBe(EXTRAS_TEXT.missing);
    expect(run('/APOSTAR 100')?.packets).toEqual([{ id: X.Gamble, amount: 100 }]);
    expect(run('/APOSTAR 99999')?.notes[0]?.text).toBe(EXTRAS_TEXT.badAmount);
    expect(run('/APOSTAR 100', { dead: true })?.notes[0]?.text).toBe(EXTRAS_TEXT.dead);
    expect(run('/ARENA', { dead: true })?.packets).toEqual([]);
  });
  it('/DESC refuses long text and dashes; /RETIRARFACCION only without arguments', () => {
    expect(run('/DESC hola')?.packets).toEqual([{ id: X.ChangeDescription, description: 'hola' }]);
    expect(run(`/DESC ${'x'.repeat(51)}`)?.notes[0]?.text).toBe(EXTRAS_TEXT.descLong);
    expect(run('/DESC a-b')?.notes[0]?.text).toBe(EXTRAS_TEXT.descDash);
    expect(run('/RETIRARFACCION')?.packets).toEqual([{ id: X.LeaveFaction }]);
    expect(run('/RETIRARFACCION algo')?.packets).toEqual([]);
  });
  it('/PARTICIPAR defaults the room to -1', () => {
    expect(run('/PARTICIPAR')?.packets).toEqual([{ id: X.Participar, roomId: -1, password: '' }]);
    expect(run('/PARTICIPAR 4 clave')?.packets).toEqual([{ id: X.Participar, roomId: 4, password: 'clave' }]);
  });
  it('/RETAR opens the duel form and pre-fills the names split at @', () => {
    expect(run('/RETAR')?.open).toEqual({ window: 'duel' });
    expect(run('/RETAR Ana@Beto@Cleo')?.open).toEqual({ window: 'duel', names: ['Ana', 'Beto', 'Cleo'] });
  });
  it('/CE only works for a GM, /FEATURETOGGLE too', () => {
    expect(run('/CE fiesta')?.packets).toEqual([]);
    expect(run('/CE fiesta', { isGM: true })?.packets).toEqual([{ id: X.CreateEvent, eventName: 'fiesta' }]);
    expect(run('/FEATURETOGGLE hotokey-enabled 1', { isGM: true })?.packets).toEqual([{ id: X.FeatureToggle, value: 1, name: 'hotokey-enabled' }]);
    expect(run('/FEATURETOGGLE x', { isGM: true })?.notes[0]?.text).toBe(EXTRAS_TEXT.badParams);
  });
  it('/CREAREVENTO builds the StartEvent packet of each scenario', () => {
    const start = (line: string) => run(line)?.packets[0] as unknown as Record<string, number | string>;
    expect(start('/CREAREVENTO LOBBY 10 15 40')).toMatchObject({ id: X.StartEvent, scenarioType: 0, maxPlayers: 10, minLevel: 15, maxLevel: 40, inscriptionFee: 0 });
    expect(start('/CREAREVENTO CAPTURA 10 3 15 40 500')).toMatchObject({ scenarioType: 1, maxPlayers: 10, roundNumber: 3, minLevel: 15, maxLevel: 40, inscriptionFee: 500 });
    expect(start('/CREAREVENTO DEATHMATCH 8 1 47 100 2')).toMatchObject({ scenarioType: 3, maxPlayers: 8, minLevel: 1, maxLevel: 47, inscriptionFee: 100, teamSize: 2 });
    expect(start('/CREAREVENTO NAVALCONQUEST 8 1 47')).toMatchObject({ scenarioType: 4, teamSize: 1 });
    expect(run('/CREAREVENTO FOO')?.notes[0]?.text).toBe(EXTRAS_TEXT.invalidEvent);
    expect(run('/CREAREVENTO DEATHMATCH 8')?.notes[0]?.text).toBe(EXTRAS_TEXT.eventUsage('DEATHMATCH'));
  });
  it('/CONFIGLOBBY writes LobbyCommand with the e_LobbyCommandId of each sub command', () => {
    const lobby = (line: string) => run(line)?.packets as unknown as { command: number; params: string }[];
    expect(lobby('/CONFIGLOBBY START')).toEqual([{ id: X.LobbyCommand, command: LobbyCommandId.StartEvent, params: '' }]);
    expect(lobby('/CONFIGLOBBY LIST')[0]).toMatchObject({ command: LobbyCommandId.ListPlayers });
    expect(lobby('/CONFIGLOBBY MAXLVL 40')[0]).toMatchObject({ command: LobbyCommandId.SetMaxLevel, params: '40' });
    expect(lobby('/CONFIGLOBBY CLASS mago')[0]).toMatchObject({ command: LobbyCommandId.SetClassLimit, params: '1' });
    expect(lobby('/CONFIGLOBBY OPEN PRIVATE').map(p => p.params)).toEqual(['0', '1']);
    expect(lobby('/CONFIGLOBBY SETTEAMSIZE 3 PREMADE')[0]).toMatchObject({ command: LobbyCommandId.SetTeamSize, params: '3 0' });
    expect(run('/CONFIGLOBBY nada')?.notes[0]?.text).toBe(EXTRAS_TEXT.badLobby);
  });
  it('anti-macro and castle commands', () => {
    expect(run('/MENSAJEANTIMACRO Ana@estas ahi')?.packets).toEqual([{ id: X.AntiMacroMessage, userName: 'Ana', message: 'estas ahi' }]);
    expect(run('/CASTLE ADD Ana')?.packets).toEqual([{ id: X.ModifyCastleWhiteList, command: 'ADD Ana' }]);
    expect(run('/CASTLE')?.notes[0]?.text).toBe(EXTRAS_TEXT.castle);
  });
  it('leaves other commands to their owners', () => { expect(run('/SALIR')).toBeUndefined(); expect(run('/GM')).toBeUndefined(); });
});

describe('duel form validation (frmRetos.Validar, General.ValidarNombre)', () => {
  it('names are 3..18 letters with single inner spaces', () => {
    expect(validName('Ana')).toBe(true); expect(validName('Ana Maria')).toBe(true);
    for (const bad of ['Al', 'Ana1', ' Ana', 'Ana ', 'Ana  Maria', 'x'.repeat(19), 'Ñandú']) expect(validName(bad), bad).toBe(false);
  });
  it('first error wins: empty, invalid, repeated, too much gold', () => {
    expect(validateDuel(['Ana', ''], 1, false, '')).toBe('Complete todos los jugadores');
    expect(validateDuel(['Ana', 'B2b'], 1, false, '')).toBe("Nombre del jugador inválido: 'B2b'");
    expect(validateDuel(['Ana', 'Ana'], 1, false, '')).toBe('No se permiten jugadores repetidos');
    expect(validateDuel(['Ana', 'Beto'], 1, true, '10000001')).toBe('No se permite apostar mas de 10.000.000 monedas de oro');
    expect(validateDuel(['Ana', 'Beto'], 1, true, '5')).toBe('');
  });
});

describe('ExtrasState', () => {
  let now = 0;
  const messages: string[] = [];
  const state = new ExtrasState(() => now, text => messages.push(text));
  it('keeps the invasion bar for 10 s and clears it on a map change', () => {
    state.receive({ id: XS.InvasionInfo, invasion: 1, lifePercent: 80, timePercent: 50 } as ServerPacket);
    expect(state.invasion).toMatchObject({ lifePercent: 80, timePercent: 50 });
    now = INVASION_MS - 1; expect(state.tick()).toBe(false);
    now = INVASION_MS; expect(state.tick()).toBe(true); expect(state.invasion).toBeUndefined();
    state.receive({ id: XS.InvasionInfo, invasion: 1, lifePercent: 10, timePercent: 10 } as ServerPacket);
    state.receive({ id: S.ChangeMap, map: 1, resourceMap: 1 } as ServerPacket);
    expect(state.invasion).toBeUndefined();
  });
  it('the shop and marketplace are one console line, credits are kept, anti-cheat is dropped', () => {
    state.receive({ id: XS.ShopInit, credits: 500, items: [{ objNum: 1, value: 2, name: 'x' }] } as ServerPacket);
    state.receive({ id: XS.ShopPjsInit } as ServerPacket);
    expect(messages).toEqual([SHOP_MESSAGE, MARKET_MESSAGE]); expect(state.credits).toBe(500);
    state.receive({ id: XS.UpdateShopClienteCredits, credits: 450 } as ServerPacket); expect(state.credits).toBe(450);
    state.receive({ id: XS.AntiCheatStartSession } as ServerPacket); expect(state.antiCheatDropped).toBe(1);
  });
  it('lobby lists and skin slots are stored; slot 0 is ignored like the VB6 If Slot > 0', () => {
    state.receive({ id: XS.ReportLobbyList, lobbies: [{ id: 1 }] } as unknown as ServerPacket); expect(state.lobbies).toHaveLength(1);
    state.closeLobbies(); expect(state.lobbies).toBeUndefined();
    state.receive({ id: XS.ChangeSkinSlot, slot: 2, objIndex: 9 } as unknown as ServerPacket); state.receive({ id: XS.ChangeSkinSlot, slot: 0, objIndex: 9 } as unknown as ServerPacket);
    expect([...state.skins.keys()]).toEqual([2]);
  });
});
