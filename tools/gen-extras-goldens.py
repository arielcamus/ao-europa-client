#!/usr/bin/env python3
"""Independent golden generator for packages/protocol/test/extras-goldens.json: reads the VB6 Write*/Handle* procedures and writes
one sample frame per flat packet (Int8 7, Int16 1234, Int32 100000, String8 "Ab c", Bool true) without touching the TypeScript codecs."""
import json, re, struct, sys, os
CLIENT = os.path.expanduser('~/Projects/ao-reference/argentum-online-client-classic/CODIGO')
SERVER = os.path.expanduser('~/Projects/ao-reference/argentum-online-server-classic/Codigo')
def src(d, f): return open(os.path.join(d, f), encoding='latin1').read().replace('\r', '')
def body(text, name):
    m = re.search(r'^\s*(?:Public |Private )?Sub ' + re.escape(name) + r'\(.*?^\s*End Sub', text, re.S | re.M | re.I)
    return m.group(0) if m else None
def varint(n):
    out = bytearray()
    while True:
        b = n & 0x7f; n >>= 7
        if n: out.append(b | 0x80)
        else: out.append(b); return bytes(out)
SAMPLE = {'Int8': bytes([7]), 'Int16': struct.pack('<h', 1234), 'Int32': struct.pack('<i', 100000), 'String8': varint(4) + b'Ab c', 'Bool': bytes([1])}
TYPES = {'Int8': 'i8', 'Int16': 'i16', 'Int32': 'i32', 'String8': 's8', 'Bool': 'bool'}
cw, cp, sw, sp = src(CLIENT, 'Protocol_Writes.bas'), None, src(SERVER, 'Protocol_Writes.bas'), src(SERVER, 'Protocol.bas')
cp = src(CLIENT, 'Protocol.bas')
sp = sp + src(SERVER, 'Protocol_GmCommands.bas')
# (direction, id, name, source text, sub name, regex of the field calls)
jobs = []
def add(d, i, n, text, sub, pat): jobs.append((d, i, n, text, sub, pat))
W = r'Writer\.Write(Int8|Int16|Int32|String8|Bool)\('
R = r'[Rr]eader\.Read(Int8|Int16|Int32|String8|Bool)\b'
for i, n in [(64, 'ChangeDescription'), (67, 'Gamble'), (68, 'MapPriceEntrance'), (69, 'LeaveFaction'), (185, 'Participar'), (213, 'OfertaInicial'),
             (216, 'CuentaRegresiva'), (218, 'Duel'), (219, 'AcceptDuel'), (220, 'CancelDuel'), (221, 'QuitDuel'), (240, 'SubastaInfo'),
             (244, 'EventoInfo'), (245, 'CrearEvento'), (247, 'CancelarExit'), (249, 'ComenzarTorneo'), (250, 'CancelarTorneo'),
             (251, 'BusquedaTesoro'), (267, 'FinEvento'), (272, 'CreateEvent'), (274, 'LogMacroClickHechizo'), (292, 'CancelarEvento'),
             (295, 'EventoFaccionario'), (297, 'LobbyCommand'), (310, 'AntiMacroMessage'), (311, 'ModifyCastleWhiteList')]:
    add('c2s', i, n, cw, 'Write' + n, W)
add('c2s', 227, 'Casarse', cw, 'WriteCasamiento', W)
for i, n, h in [(214, 'OfertaDeSubasta', 'HandleOfertaDeSubasta'), (239, 'MacroPossent', 'HandleMacroPos'), (248, 'CrearTorneo', 'HandleCrearTorneo'),
                (290, 'BuyShopItem', 'HandleBuyShopItem'), (291, 'StartEvent', 'HandleStartEvent'), (294, 'PublicarPersonajeMAO', 'HandlePublicarPersonajeMAO'),
                (298, 'FeatureToggle', 'HandleFeatureToggle')]:
    add('c2s', i, n, sp, h, R)
for i, n in [(165, 'InvasionInfo'), (189, 'ShopPjsInit'), (197, 'AntiCheatStartSeassion')]:
    add('s2c', i, n, sw, 'Write' + n, W)
add('s2c', 179, 'UpdateShopClienteCredits', sw, 'writeUpdateShopClienteCredits', W)
add('s2c', 183, 'NotificarClienteSeguido', cp, 'HandleNotificarClienteSeguido', R)
out = []
for d, i, n, text, sub, pat in jobs:
    b = body(text, sub)
    if b is None: sys.exit('missing ' + d + sub)
    b = re.sub(r"'.*", '', b)
    # the discarded eXxx id write is the packet id, never a field
    types = [t for t in re.findall(pat, b, re.I) ]
    types = [t if t in SAMPLE else {'int8': 'Int8', 'int16': 'Int16', 'int32': 'Int32', 'string8': 'String8', 'bool': 'Bool'}[t.lower()] for t in types]
    if pat == W: types = types[1:]  # first Write is the packet id Int16
    # the RemortState writer uses a conditional expression in WriteBool: still one Bool
    frame = struct.pack('<H', i) + b''.join(SAMPLE[t] for t in types)
    out.append({'dir': d, 'id': i, 'name': n if n != 'AntiCheatStartSeassion' else 'AntiCheatStartSession', 'types': [TYPES[t] for t in types], 'hex': frame.hex()})
json.dump(out, open(os.path.join(os.path.dirname(__file__), '..', 'packages', 'protocol', 'test', 'extras-goldens.json'), 'w'), indent=1)
print(len(out), 'goldens')
