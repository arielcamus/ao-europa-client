import { describe, expect, it } from 'vitest';
import { ItemsServerPacketId as IS, ServerPacketId as S, decodeServerPacket, encodeServerPacket } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { CharacterTracker } from '../src/characters.js';
import { ItemsState } from '../src/items-state.js';
import { buffColor, pinnedBuffColor } from '../src/items-ui.js';

// What the client does with a packet from the PINNED server (9ccd7fad), which omits the post-pin trailing fields.
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex.replaceAll(' ', ''), 'hex'));

describe('pinned-server packets in the app state', () => {
  it('UpdateTagAndStatus without the clan fields keeps the character\'s clan data (the pinned client never touched it)', () => {
    const t = new CharacterTracker();
    t.receive({ ...f.CharacterCreate, charIndex: 4, name: 'Ana', status: 1, clanIndex: 9, clanAlignment: 3 } as ServerPacket, 0);
    t.receive(decodeServerPacket(bytes('6500 0400 03 07 416e61203c433e 0600')) as ServerPacket, 0);
    expect(t.chars.get(4)).toMatchObject({ name: 'Ana', clan: '<C>', status: 3, groupIndex: 6, clanIndex: 9, clanAlignment: 3 });
  });
  it('a CharacterCreate from the pinned server (no trailing alignment byte) decodes with alignment 0', () => {
    const live = encodeServerPacket(f.CharacterCreate as ServerPacket);
    const decoded = decodeServerPacket(live.slice(0, -1)) as ServerPacket & { clanAlignment: number; npcNumber: number };
    expect(decoded).toMatchObject({ id: S.CharacterCreate, npcNumber: f.CharacterCreate.npcNumber, clanAlignment: 0 });
  });
  it('FYA without base values colours by the pinned thresholds (>= 35 red, >= 25 pink, else white)', () => {
    const state = new ItemsState();
    state.receive({ id: IS.FYA, strength: 36, agility: 26, drugCounter: 5 });
    expect(state.attributes!.strengthBase).toBeUndefined();
    expect([pinnedBuffColor(36), pinnedBuffColor(26), pinnedBuffColor(18)]).toEqual(['rgb(204,0,0)', 'rgb(204,100,100)', '#fff']);
    expect(buffColor(36, state.attributes!.strengthBase)).toBe('rgb(204,0,0)');
    expect(buffColor(26, state.attributes!.agilityBase)).toBe('rgb(204,100,100)');
    state.receive({ id: IS.FYA, strength: 20, agility: 18, drugCounter: 120, strengthBase: 18, agilityBase: 18 }); // live server: relative to the base
    expect(buffColor(18, state.attributes!.agilityBase)).toBe('#fff');
  });
});
