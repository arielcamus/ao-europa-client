import { describe, expect, it } from 'vitest';
import { ChatInput } from '../src/chat-input.js';
import { parseGmLine, validNumber } from '../src/gm-commands.js';
import { GmState } from '../src/gm-state.js';
import { spawnRows, tilde } from '../src/gm-ui.js';

const gm = { isGM: true }, player = { isGM: false };
const sent = (line: string, ctx = gm) => parseGmLine(line, ctx)!;

describe('ValidNumber (ProtocolCmdParse)', () => {
  it('uses VB ranges', () => {
    expect(validNumber('255', 'byte')).toBe(true); expect(validNumber('256', 'byte')).toBe(false); expect(validNumber('-1', 'byte')).toBe(false);
    expect(validNumber('32767', 'integer')).toBe(true); expect(validNumber('32768', 'integer')).toBe(false); expect(validNumber('abc', 'long')).toBe(false);
  });
});

describe('GM slash commands encode what ParseUserCommand writes', () => {
  it('/TELEP with 4 args, 2 args (50,50) and 3 args (nothing)', () => {
    expect(sent('/TELEP Bob 1 20 30').packets).toEqual([{ id: 110, userName: 'Bob', map: 1, x: 20, y: 30 }]);
    expect(sent('/telep Bob 34').packets).toEqual([{ id: 110, userName: 'Bob', map: 34, x: 50, y: 50 }]);
    expect(sent('/TELEP Bob 1 20')).toEqual({ packets: [], notes: [] });
    expect(sent('/TELEP Bob 1 20 300').notes[0]!.text).toContain('Valor incorrecto');
  });
  it('/IRA, /SUM, /REVIVIR, /INVISIBLE, /ECHAR', () => {
    expect(sent('/IRA Bob').packets).toEqual([{ id: 114, userName: 'Bob' }]);
    expect(sent('/SUM Bob').packets).toEqual([{ id: 139, userName: 'Bob' }]);
    expect(sent('/REVIVIR Bob').packets).toEqual([{ id: 130, userName: 'Bob' }]);
    expect(sent('/INVISIBLE').packets).toEqual([{ id: 115 }]);
    expect(sent('/ECHAR Bob').packets).toEqual([{ id: 134, userName: 'Bob' }]);
    expect(sent('/REVIVIR').notes[0]!.text).toBe('Faltan parámetros');
  });
  it('GM-only commands do nothing for a player', () => {
    for (const line of ['/IRA Bob', '/SUM Bob', '/CI 38 5', '/CC', '/GO 1']) expect(sent(line, player)).toEqual({ packets: [], notes: [] });
    expect(sent('/ONLINE', player).notes[0]!.text).toContain('steamcharts');
    expect(sent('/ONLINE').packets).toEqual([{ id: 38 }]);
  });
  it('item and NPC spawn: /CI, /ACC, /RACC, /CC, /DAR', () => {
    expect(sent('/CI 38').packets).toEqual([{ id: 168, itemIndex: 38, cantidad: 1 }]);
    expect(sent('/CI 38 100').packets).toEqual([{ id: 168, itemIndex: 38, cantidad: 100 }]);
    expect(sent('/CI x').notes).toHaveLength(1);
    expect(sent('/ACC 500').packets).toEqual([{ id: 181, npcIndex: 500 }]);
    expect(sent('/RACC 500').packets).toEqual([{ id: 182, npcIndex: 500 }]);
    expect(sent('/CC').packets).toEqual([{ id: 140 }]);
    expect(sent('/DAR Bob@prueba@38@3').packets).toEqual([{ id: 212, userName: 'Bob', objIndex: 38, cantidad: 3, motivo: 'prueba' }]);
    expect(sent('/DAR Bob@prueba@38').packets).toEqual([{ id: 212, userName: 'Bob', objIndex: 38, cantidad: 1, motivo: 'prueba' }]);
  });
  it('set stats /MOD keeps the 4th word as arg2', () => {
    expect(sent('/MOD yo ORO 5000').packets).toEqual([{ id: 123, userName: 'yo', editOption: 1, arg1: '5000', arg2: '' }]);
    expect(sent('/MOD Bob Skills 3 20').packets).toEqual([{ id: 123, userName: 'Bob', editOption: 9, arg1: '3', arg2: '20' }]);
    expect(sent('/MOD Bob NOPE 1').notes[0]!.text).toBe('Comando incorrecto.');
  });
  it('kick, ban, jail, mute, warn, messages', () => {
    expect(sent('/BAN Bob@spam').packets).toEqual([{ id: 136, userName: 'Bob', reason: 'spam' }]);
    expect(sent('/BAN Bob').notes[0]!.text).toContain('Formato incorrecto');
    expect(sent('/CARCEL Bob@motivo@30').packets).toEqual([{ id: 120, userName: 'Bob', reason: 'motivo', time: 30 }]);
    expect(sent('/SILENCIAR Bob@5').packets).toEqual([{ id: 111, userName: 'Bob', minutos: 5 }]);
    expect(sent('/ADVERTENCIA Bob@mal').packets).toEqual([{ id: 122, userName: 'Bob', reason: 'mal' }]);
    expect(sent('/GMSG hola gms').packets).toEqual([{ id: 101, message: 'hola gms' }]);
    expect(sent('/RMSG hola mundo').packets).toEqual([{ id: 144, message: 'hola mundo' }]);
    expect(sent('/SMSG sistema').packets).toEqual([{ id: 180, message: 'sistema' }]);
    expect(sent('/TALKAS hola').packets).toEqual([{ id: 156, message: 'hola' }]);
  });
  it('misc: /PANELGM two packets, /TRIGGER, /MODMAPINFO, /IP2NICK, /CHATCOLOR, /REQDEBUG', () => {
    expect(sent('/PANELGM').packets).toEqual([{ id: 112 }, { id: 116 }]);
    expect(sent('/TRIGGER').packets).toEqual([{ id: 165 }]);
    expect(sent('/TRIGGER 5').packets).toEqual([{ id: 164, trigger: 5 }]);
    expect(sent('/MODMAPINFO SEGURO 1').packets).toEqual([{ id: 190, isPK: true }]);
    expect(sent('/MODMAPINFO RESTRINGIR SINMAGIA').packets).toEqual([{ id: 192, restrict: 'SINMAGIA' }]);
    expect(sent('/IP2NICK 10.0.0.1').packets).toEqual([{ id: 146, ip: [10, 0, 0, 1] }]);
    expect(sent('/IP2NICK 10.0.0').notes[0]!.text).toContain('IP incorrecta');
    expect(sent('/CHATCOLOR').packets).toEqual([{ id: 203, r: 0, g: 255, b: 0 }]);
    expect(sent('/REQDEBUG connection Bob Ruiz').packets).toEqual([{ id: 296, debugType: 1, argument: 'Bob Ruiz' }]);
    expect(sent('/CT 1 50 50 5 @salida').packets).toEqual([{ id: 148, map: 1, x: 50, y: 50, radio: 5, motivo: 'salida' }]);
    expect(sent('/GM').open).toBe('gmHelp'); expect(sent('/CO').open).toBe('objects');
  });
  it('weather commands reuse the world feature ids', () => {
    expect(sent('/LLUVIA').packets).toEqual([{ id: 150 }]);
  });
});

describe('typed through the chat box rules', () => {
  it('a GM line reaches the outcome, a player gets nothing', () => {
    const input = new ChatInput();
    expect(input.submit('/TELEP Bob 1 20 30', { isGM: true }).packet).toEqual({ id: 110, userName: 'Bob', map: 1, x: 20, y: 30 });
    expect(input.submit('/PANELGM', { isGM: true })).toMatchObject({ packet: { id: 112 }, more: [{ id: 116 }] });
    expect(input.submit('/IRA Bob', { isGM: false }).packet).toBeUndefined();
    expect(input.submit('/NOPE', { isGM: true }).notes[0]!.text).toContain('no está disponible');
  });
});

describe('GmState', () => {
  it('reads the server packets', () => {
    const state = new GmState();
    state.receive({ id: 177, isGM: true });
    state.receive({ id: 111, list: 'Ana\0Beto' });
    state.receive({ id: 108, list: 'AnaØholaØConsulta regularØ01/01/2026' });
    state.receive({ id: 107, listaCompleta: true });
    expect(state).toMatchObject({ isGM: true, userNames: ['Ana', 'Beto'], spawnFull: true, spawnOpened: 1 });
    expect(state.sos).toEqual([{ name: 'Ana', query: 'hola', type: 'Consulta regular', date: '01/01/2026' }]);
  });
});

describe('spawn list filter (frmSpawnList.FillList)', () => {
  const npcs = [{ index: 1, name: 'Vacío', summonable: true }, { index: 500, name: 'Dragón', summonable: true }, { index: 501, name: 'Rata', summonable: false }];
  it('only summonable ones unless the full list, accent-insensitive filter', () => {
    expect(spawnRows(npcs, false, '').map(r => r.text)).toEqual(['500 - Dragón']);
    expect(spawnRows(npcs, true, 'rata').map(r => r.text)).toEqual(['501 - Rata']);
    expect(spawnRows(npcs, true, 'dragon')).toHaveLength(1);
    expect(tilde('Á')).toBe('a');
  });
});
