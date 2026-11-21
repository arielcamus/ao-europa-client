import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ServerPacketId as S, KeyringClientPacketId as KC, KeyringServerPacketId as KS, MAX_KEYS,
  FrameDecoder, decodeClientPacket, decodeServerPacket, encodeServerFrame,
} from '@ao/protocol';
import type { ClientPacket, ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { Session } from '../src/session.js';
import { KeyringState } from '../src/keyring.js';
import { ObjectCatalog } from '../src/object-catalog.js';
import { parseIni } from '../src/assets.js';
import { elementalTagsText, labelFontPx, objectLabel } from '../src/inventory-extras.js';
import { PAPIRO_LINKS } from '../src/papiro-ui.js';

const catalog = new ObjectCatalog(parseIni([
  '[OBJ1]', 'Name=Manzana Roja', 'GrhIndex=10', 'ObjType=1', 'Texto=Restaura 5 puntos de hambre',
  '[OBJ2]', 'Name=Espada Larga', 'GrhIndex=11', 'ObjType=2', 'MinHit=6', 'MaxHit=12', 'ElementalTags=1',
  '[OBJ4]', 'Name=Armadura', 'GrhIndex=13', 'ObjType=3', 'MinDef=4', 'MaxDef=8',
  '[OBJ54]', 'Name=Llave casa Ullathorpe Nro: 01', 'GrhIndex=99', 'ObjType=9',
].join('\n')));
const slot = (n: number, object: number, amount: number) => ({ ...f.ChangeInventorySlot, slot: n, object, amount });

function playing() {
  let now = 1000;
  const sent: Uint8Array[] = [];
  const session = new Session({ email: 'a', password: 'b' }, bytes => sent.push(bytes), () => now);
  session.catalog = catalog;
  // The real server sends UpdateUserKey BEFORE Logged (tests/fixtures/vb6/items-2/login-keys.jsonl), so they are fed first here too.
  for (const packet of [f.Connected, f.AccountCharacterList, { ...f.Intervals, useItemClick: 100 }, f.ChangeMap, f.CharacterCreate, f.UserCharIndexInServer,
    { id: KS.UpdateUserKey, slot: 1, key: 54 }, { id: KS.UpdateUserKey, slot: 2, key: 65 }, f.Logged]) session.receive(encodeServerFrame(packet as ServerPacket));
  sent.length = 0;
  const feed = (...packets: ServerPacket[]) => { for (const packet of packets) session.receive(encodeServerFrame(packet)); };
  const out = (): ClientPacket[] => { const decoder = new FrameDecoder(), p = sent.flatMap(b => decoder.push(b)).map(decodeClientPacket) as ClientPacket[]; sent.length = 0; return p; };
  return { session, feed, out, advance: (ms: number) => { now += ms; } };
}

describe('key ring state', () => {
  it('keeps the keys the server sent before Logged, replaces a slot, clears it with object 0 and ignores slots outside 1..MAX_KEYS', () => {
    const { session, feed } = playing();
    expect([...session.keyring.keys]).toEqual([[1, 54], [2, 65]]);
    feed({ id: KS.UpdateUserKey, slot: 2, key: 70 }, { id: KS.UpdateUserKey, slot: 1, key: 0 }, { id: KS.UpdateUserKey, slot: MAX_KEYS + 1, key: 9 }, { id: KS.UpdateUserKey, slot: 0, key: 9 });
    expect([...session.keyring.keys]).toEqual([[2, 70]]);
    expect(session.keyring.empty).toBe(false);
    feed({ id: KS.UpdateUserKey, slot: 2, key: 0 });
    expect(session.keyring.empty).toBe(true);
  });
  it('a Disconnect resets the ring (HandleDisconnect clears InvKeys)', () => {
    const { session, feed } = playing();
    expect(() => feed({ id: S.Disconnect, fullLogout: false })).toThrow('disconnected'); // the session ends, after the stores have reset
    expect(session.keyring.empty).toBe(true);
  });
  it('ShowPapiro opens the papyrus form and closing it is local', () => {
    const state = new KeyringState();
    state.receive({ id: KS.ShowPapiro });
    expect(state.papiroOpen).toBe(true);
    state.closePapiro();
    expect(state.papiroOpen).toBe(false);
  });
});

describe('UseKey (FrmKeyInv.interface_DblClick)', () => {
  it('sends WriteUseKey for a key in the ring, paced by the double-click interval', () => {
    const { session, out, advance } = playing();
    expect(session.inventoryActions.useKey(1, session.keyring)).toBe(true);
    expect(out()).toEqual([{ id: KC.UseKey, slot: 1 }]);
    expect(session.inventoryActions.useKey(2, session.keyring)).toBe(false); // inside the interval
    advance(150);
    expect(session.inventoryActions.useKey(2, session.keyring)).toBe(true);
    expect(out()).toEqual([{ id: KC.UseKey, slot: 2 }]);
  });
  it('sends nothing for an empty ring slot', () => {
    const { session, out } = playing();
    expect(session.inventoryActions.useKey(5, session.keyring)).toBe(false);
    expect(out()).toEqual([]);
  });
});

describe('Moveitem (Inventario_ItemDropped)', () => {
  it('sends the dragged and dropped slots; the same slot and slot 0 send nothing', () => {
    const { session, out } = playing();
    expect(session.inventoryActions.move(3, 17)).toBe(true);
    expect(out()).toEqual([{ id: KC.Moveitem, from: 3, to: 17 }]);
    expect(session.inventoryActions.move(3, 3)).toBe(false); // the real server would merge the stack into itself and empty the slot
    expect(session.inventoryActions.move(3, 0)).toBe(false);
    expect(session.inventoryActions.move(0, 4)).toBe(false);
    expect(session.inventoryActions.move(3, 43)).toBe(false);
    expect(out()).toEqual([]);
  });
});

describe('DeleteItem (imgDeleteItem_Click)', () => {
  it('needs a selected item and a yes; then sends isSkin False and the slot', () => {
    const { session, feed, out } = playing();
    feed(slot(16, 1, 20) as ServerPacket);
    expect(session.inventoryActions.deleteSelected(0, true)).toBe('no-selection');
    expect(session.inventoryActions.deleteSelected(20, true)).toBe('no-selection'); // empty slot
    expect(session.inventoryActions.deleteSelected(16, false)).toBe('cancelled');
    expect(out()).toEqual([]);
    expect(session.inventoryActions.deleteSelected(16, true)).toBe('sent');
    expect(out()).toEqual([{ id: 285, skin: false, slot: 16 }]);
  });
});

describe('the item info label (picInv_MouseMove)', () => {
  it('weapons show damage and elemental tags, armours show defence, other objects show their text', () => {
    expect(objectLabel(catalog.get(2), 2, 1, 0)).toBe('Espada Larga (1)\nDaño: 6/12 [Fuego]');
    expect(objectLabel(catalog.get(2), 2, 1, 2 | 4)).toBe('Espada Larga (1)\nDaño: 6/12 [Fuego][Agua][Tierra]');
    expect(objectLabel(catalog.get(4), 4, 1, 0)).toBe('Armadura (1)\nDefensa: 4/8');
    expect(objectLabel(catalog.get(1), 1, 95, 0)).toBe('Manzana Roja (95)\nRestaura 5 puntos de hambre');
  });
  it('ElementalTagsToTxtParser and the label font size', () => {
    expect(elementalTagsText(0)).toBe('[Normal]');
    expect(elementalTagsText(15)).toBe('[Fuego][Agua][Tierra][Viento]');
    expect(labelFontPx(50)).toBeCloseTo(9.33, 1);
    expect(labelFontPx(120)).toBe(8);
  });
});

describe('follow-ups from #20', () => {
  it('a shop slot outside 1..42 is ignored instead of closing the session (item 2)', () => {
    const { session, feed } = playing();
    expect(() => feed({ id: 77, slot: 43, object: 1, amount: 1, value: 1, elementalTags: 0, canUse: 0 } as ServerPacket)).not.toThrow();
    expect(session.items.shopSlots.size).toBe(0);
  });
});

describe('papyrus form links (frmMensajePapiro.frm)', () => {
  it('has the nine label controls with the form positions (twips / 15)', () => {
    expect(PAPIRO_LINKS).toHaveLength(9);
    expect(PAPIRO_LINKS.find(l => l.id === 'news')).toMatchObject({ box: [219, 215, 81, 17], url: 'https://steamcommunity.com/app/1956740/allnews/' });
    expect(PAPIRO_LINKS.find(l => l.id === 'stream2')).toMatchObject({ box: [448, 264, 105, 17], center: true });
  });
});

// The recorded login: the server's keys reach the session through the real wire format.
describe('real recording: login-keys.jsonl', () => {
  it('fills the ring from UpdateUserKey and keeps it after Logged', () => {
    const lines = readFileSync(new URL('../../../tests/fixtures/vb6/items-2/login-keys.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l) as { dir: string; hex: string });
    const state = new KeyringState();
    for (const line of lines.filter(l => l.dir === 's2c')) { const p = decodeServerPacket(Uint8Array.from(Buffer.from(line.hex, 'hex'))); if (!('unknown' in p)) state.receive(p); }
    expect([...state.keys]).toEqual([[1, 54], [2, 65]]);
  });
});
